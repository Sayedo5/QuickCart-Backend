import { ServiceCity, Store } from '@prisma/client';
import { prisma } from '../config/db';
import { AppError } from '../utils/errors';

/**
 * Per-city service rules.
 *
 * QuickCart used to assume one fixed location (Lahore), so the delivery fee, the
 * ETA and the service radius were all effectively hard-coded. Every one of those
 * is now derived from the ServiceCity row the order belongs to, which is what
 * lets the same build run in Lahore, Islamabad, Rawalpindi, Karachi, Peshawar
 * and Quetta without a rebuild.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const round = (n: number) => Math.round(n * 100) / 100;

/** Great-circle distance in km. Accurate enough for delivery-radius decisions. */
export const distanceKm = (a: LatLng, b: LatLng): number => {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return round(2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h))));
};

export const listActiveCities = (): Promise<ServiceCity[]> =>
  prisma.serviceCity.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });

/**
 * Looks a city up by name or slug, case-insensitively, so "karachi", "Karachi"
 * and "karachi" from a slug all resolve to the same row.
 */
export const findCity = async (nameOrSlug: string | null | undefined): Promise<ServiceCity | null> => {
  const key = (nameOrSlug ?? '').trim();
  if (!key) return null;
  return prisma.serviceCity.findFirst({
    where: { OR: [{ name: { equals: key, mode: 'insensitive' } }, { slug: { equals: key.toLowerCase(), mode: 'insensitive' } }] },
  });
};

/** The active city whose centre is closest to a point, if it is inside that city's radius. */
export const nearestCity = async (point: LatLng): Promise<{ city: ServiceCity; distanceKm: number } | null> => {
  const cities = await listActiveCities();
  let best: { city: ServiceCity; distanceKm: number } | null = null;
  for (const city of cities) {
    const d = distanceKm(point, { latitude: city.lat, longitude: city.lng });
    if (!best || d < best.distanceKm) best = { city, distanceKm: d };
  }
  return best && best.distanceKm <= best.city.radiusKm ? best : null;
};

/**
 * Falls back through: the requested city → the Settings default → the first
 * active city. Throws only when no city is configured at all, which would mean
 * the platform has been switched off entirely.
 */
export const resolveCity = async (requested: string | null | undefined, fallbackName?: string): Promise<ServiceCity> => {
  const city = (await findCity(requested)) ?? (await findCity(fallbackName));
  if (city?.isActive) return city;
  const [first] = await listActiveCities();
  if (!first) throw new AppError('NO_SERVICE_CITY', 'No service city is configured. Please try again later.', 503);
  return first;
};

/** True when a point is inside the city's delivery radius. */
export const isWithinCity = (city: ServiceCity, point: LatLng): boolean =>
  distanceKm(point, { latitude: city.lat, longitude: city.lng }) <= city.radiusKm;

/**
 * Delivery fee for one trip.
 *
 * The city sets the economics (a flat pickup fee plus a per-km rate); the
 * store's own `deliveryFee` acts as the floor a merchant negotiated, so a
 * partner who agreed to Rs 49 delivery never charges less than that even on a
 * long run. Without a drop-off point we fall back to the store's stored
 * distance so browsing still shows a sensible number.
 */
export const deliveryFeeFor = (city: ServiceCity, store: Pick<Store, 'lat' | 'lng' | 'deliveryFee' | 'distanceKm'>, dropOff?: LatLng | null): number => {
  const km = dropOff ? distanceKm({ latitude: store.lat, longitude: store.lng }, dropOff) : (store.distanceKm ?? 0);
  const cityFee = city.baseDeliveryFee + city.perKmFee * km;
  return Math.round(Math.max(store.deliveryFee, cityFee));
};

/** Promised delivery window in minutes, calibrated per city. */
export const etaFor = (city: ServiceCity, store: Pick<Store, 'lat' | 'lng' | 'deliveryTimeMin' | 'deliveryTimeMax' | 'distanceKm'>, dropOff?: LatLng | null): { min: number; max: number } => {
  const km = dropOff ? distanceKm({ latitude: store.lat, longitude: store.lng }, dropOff) : (store.distanceKm ?? 0);
  const travel = km * city.etaPerKmMin;
  const min = Math.max(store.deliveryTimeMin, Math.round(city.etaBaseMin + travel));
  const max = Math.max(store.deliveryTimeMax, min + Math.max(10, Math.round(travel * 0.5)));
  return { min, max };
};

export const cityOut = (c: ServiceCity) => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  province: c.province ?? undefined,
  location: { latitude: c.lat, longitude: c.lng },
  radiusKm: c.radiusKm,
  baseDeliveryFee: c.baseDeliveryFee,
  perKmFee: c.perKmFee,
  minOrderAmount: c.minOrderAmount,
  etaBaseMin: c.etaBaseMin,
  etaPerKmMin: c.etaPerKmMin,
  isActive: c.isActive,
  sortOrder: c.sortOrder,
});
