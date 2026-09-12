-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "city" TEXT NOT NULL DEFAULT 'Lahore';

-- CreateTable
CREATE TABLE "ServiceCity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "province" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "baseDeliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 99,
    "perKmFee" DOUBLE PRECISION NOT NULL DEFAULT 12,
    "minOrderAmount" DOUBLE PRECISION NOT NULL DEFAULT 300,
    "etaBaseMin" INTEGER NOT NULL DEFAULT 20,
    "etaPerKmMin" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCity_name_key" ON "ServiceCity"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCity_slug_key" ON "ServiceCity"("slug");

-- CreateIndex
CREATE INDEX "ServiceCity_isActive_sortOrder_idx" ON "ServiceCity"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Store_city_status_idx" ON "Store"("city", "status");


-- Backfill: every store that existed before multi-city support was in Lahore.
-- The column default already wrote 'Lahore', this makes the intent explicit and
-- covers any row an earlier partial run may have left empty.
UPDATE "Store" SET "city" = 'Lahore' WHERE "city" IS NULL OR "city" = '';
