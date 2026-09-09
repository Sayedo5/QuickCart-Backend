# QuickCart Database

PostgreSQL on Neon, managed by Prisma. Source of truth: `prisma/schema.prisma`.
Migrations live in `prisma/migrations/`; the first is `20260908072134_init`.

## Enums

| Enum | Values |
| --- | --- |
| `Role` | `CUSTOMER`, `RIDER`, `ADMIN` |
| `StoreCategory` | `RESTAURANTS`, `GROCERY`, `PHARMACY` |
| `ApprovalStatus` | `PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED` |
| `OrderStatus` | `PLACED`, `CONFIRMED`, `PREPARING`, `PICKED_UP`, `DELIVERED`, `CANCELLED` |
| `PaymentMethodType` | `CASH`, `CARD`, `WALLET`, `JAZZCASH`, `EASYPAISA` |
| `PaymentStatus` | `PENDING`, `PAID`, `FAILED`, `REFUNDED` |
| `OtpPurpose` | `LOGIN`, `SIGNUP` |
| `DiscountType` | `PERCENT`, `FLAT`, `FREE_DELIVERY` |
| `WalletTxType` | `TOPUP`, `PAYMENT`, `REFUND`, `CASHBACK` |
| `NotificationType` | `ORDER`, `PROMO`, `WALLET`, `SYSTEM` |
| `BannerTarget` | `OFFERS`, `STORE`, `CATEGORY`, `EXTERNAL` |

## Tables

### User
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| name | string | required |
| email | string | **unique**, the login identifier |
| phone | string? | local format without the leading 0 |
| dialCode | string | default `+92` |
| avatarUrl | string? | |
| role | Role | default `CUSTOMER` |
| passwordHash | string? | only set for admin accounts (admin panel login) |
| isVerified | bool | default false, set true after OTP |
| isBlocked | bool | default false; blocking revokes refresh tokens |
| walletBalance | float | default 0 |
| createdAt / updatedAt | datetime | |

Relations: `addresses`, `orders`, `reviews`, `favourites`, `paymentMethods`,
`walletTransactions`, `notifications`, `pushTokens`, `refreshTokens`, `rider?`.
Indexed on `role`.

### RefreshToken
`id`, `token` (unique), `userId` → User (cascade), `expiresAt`, `revokedAt?`, `createdAt`.
Rotated on every refresh; the old row is revoked, never reused.

### Otp
`id`, `email`, `code`, `purpose` (OtpPurpose), `isUsed` (bool), `attempts` (int),
`expiresAt`, `createdAt`. Indexed on `(email, createdAt)`.
Codes live 5 minutes, allow 5 attempts, and a new request is refused within 45 seconds.

### PushToken
`id`, `userId` → User (cascade), `token` (unique), `platform`, `createdAt`.
Tokens Expo reports as `DeviceNotRegistered` are deleted automatically.

### Address
`id`, `userId` → User (cascade), `label` (Home/Work/Other), `street`, `apartment?`,
`city`, `instructions?`, `lat`, `lng`, `isDefault`, `createdAt`. Indexed on `userId`.
Setting one default clears the others in the same transaction.

### Category
`id`, `name`, `slug` (unique), `icon?`, `imageUrl?`, `type` (`store`/`product`),
`sortOrder`, `isActive`, `createdAt`. Drives the app's home-screen chips.

### Store
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| name, area, address | string | |
| category | StoreCategory | |
| description?, imageUrl?, coverImageUrl? | string | |
| lat, lng | float | map position |
| rating, ratingCount | float / int | recomputed from approved reviews |
| deliveryTimeMin / Max | int | minutes |
| deliveryFee, minOrderAmount | float | |
| distanceKm? | float | |
| tags | string[] | default `[]` |
| promoLabel? | string | badge on the store card |
| isOpen | bool | |
| status | ApprovalStatus | new applications start `PENDING` |
| rejectionReason? | string | |
| ownerName?, ownerContact? | string | |

Relations: `menuCategories`, `products`, `orders`, `reviews`, `favourites`.
Indexed on `(category, status)`. Only `APPROVED` stores are visible to customers.

### MenuCategory
`id`, `storeId` → Store (cascade), `name`, `sortOrder`, `products`.
A menu section such as Starters, Karahi or Drinks.

### Product
`id`, `storeId` → Store (cascade), `menuCategoryId?` → MenuCategory (set null),
`name`, `description?`, `price`, `compareAtPrice?`, `discountPercent` (0-90),
`imageUrl?`, `unit?`, `isVeg?`, `isPopular`, `inStock`, `sortOrder`, timestamps.
Indexed on `(storeId, menuCategoryId)`. `discountPercent` is applied server-side at quote time.

### Banner
`id`, `title`, `subtitle?`, `label?`, `imageUrl?`, `targetType` (BannerTarget),
`targetValue?`, `colorFrom`, `colorTo`, `sortOrder`, `isActive`, `startsAt?`,
`endsAt?`, `createdAt`. Only active banners inside their date window are served.

### Coupon
`id`, `code` (unique), `description`, `discountType`, `discountValue`, `maxDiscount?`,
`minOrderAmount`, `expiryDate`, `isActive`, `usageLimit?`, `usedCount`, `createdAt`.
`usedCount` increments inside the order transaction.

### Faq
`id`, `question`, `answer`, `sortOrder`, `isActive`.

### Settings
Single row, `id = "global"`: `currencySymbol`, `taxPercent`, `taxLabel`, `platformFee`,
`baseDeliveryFee`, `minOrderDefault`, `serviceCity`, `supportEmail?`, `supportPhone?`,
`supportWhatsApp?`, `termsUrl?`, `privacyUrl?`, `announcementTitle?`, `announcementBody?`,
`appBannerImages` (string[]), `updatedAt`. Editing it changes the app with no release.

### Order
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| orderNumber | string unique | `QC-48213`, generated server-side |
| userId | → User | |
| storeId | → Store | |
| riderId? | → Rider | assigned by an admin |
| subtotal, deliveryFee, serviceFee, tax, discount, total | float | all computed server-side |
| couponCode? | string | |
| paymentMethodType | PaymentMethodType | |
| paymentMethodLabel | string | snapshot of the label |
| paymentStatus | PaymentStatus | |
| status | OrderStatus | |
| addressLabel / addressLine / addressCity / addressLat / addressLng | snapshot | the address is copied so later edits do not rewrite history |
| note? | string | |
| estimatedDeliveryAt? | datetime | |
| cancelledReason? | string | |

Relations: `items`, `statusHistory`, `review?`.
Indexed on `(userId, createdAt)` and `status`.

### OrderItem
`id`, `orderId` → Order (cascade), `productId?`, `name`, `imageUrl?`, `unit?`,
`price`, `quantity`. Name and price are snapshots, so past orders stay accurate
after a product is edited or deleted.

### StatusLog
`id`, `orderId` → Order (cascade), `status`, `note?`, `timestamp`. Indexed on `orderId`.
One row per transition, written in the same transaction as the status change.

### Rider
`id`, `userId?` → User (unique, set on approval so the rider can sign in), `name`,
`email` (unique), `phone`, `vehicleType?`, `plateNumber?`, `imageUrl?`,
`documentUrls` (string[]), `status` (ApprovalStatus), `rejectionReason?`,
`isAvailable`, `currentLat?`, `currentLng?`, `heading?`, `lastLocationAt?`,
`rating`, `ratingCount`, `completedOrders`, timestamps.
Indexed on `(status, isAvailable)`.

### Review
`id`, `userId` → User (cascade), `storeId` → Store (cascade), `orderId?` → Order
(unique, so one review per order), `rating` (1-5), `comment?`, `tags` (string[]),
`tip`, `isApproved`, `createdAt`. Indexed on `storeId`.
Saving or moderating a review recomputes the store's and rider's average rating.

### Favourite
`id`, `userId` → User (cascade), `storeId` → Store (cascade), `createdAt`.
Unique on `(userId, storeId)`.

### PaymentMethod
`id`, `userId` → User (cascade), `type`, `label`, `brand?`, `last4?`, `expiry?`,
`mobileNumber?`, `isDefault`, `createdAt`. Indexed on `userId`.
**Full card numbers are never stored** — the PAN is Luhn-validated then discarded,
keeping only the brand and last four digits. Tokenise with a gateway before taking
real payments.

### WalletTransaction
`id`, `userId` → User (cascade), `type` (WalletTxType), `amount` (negative for
payments), `title`, `subtitle?`, `orderId?`, `createdAt`. Indexed on `(userId, createdAt)`.

### Notification
`id`, `userId` → User (cascade), `title`, `body`, `type`, `orderId?`, `isRead`,
`createdAt`. Indexed on `(userId, createdAt)`. Written alongside every push.

---

## Transactions and integrity

- **Placing an order** creates the Order, its OrderItems and the first StatusLog,
  debits the wallet and increments the coupon counter in one `prisma.$transaction`.
  Because Neon is remote, the timeout is raised to 30 s and read-back happens outside
  the transaction to keep it short.
- **Status transitions** are validated: an order cannot move backwards, cannot leave a
  final state, and cannot be marked picked up without a rider. Cancelling a paid order
  refunds to the wallet and writes a `REFUND` transaction atomically.
- **Deleting a store** with past orders suspends it instead, so order history survives.
