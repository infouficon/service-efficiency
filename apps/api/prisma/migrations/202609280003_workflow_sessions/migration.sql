-- CreateTable
CREATE TABLE `Customer` (
    `id` VARCHAR(36) NOT NULL,
    `phone` VARCHAR(10) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Customer_phone_key`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Product` (
    `id` VARCHAR(36) NOT NULL,
    `category` ENUM('iPhone', 'iPad', 'Mac', 'Watch') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductModel` (
    `id` VARCHAR(36) NOT NULL,
    `productId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `ProductModel_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductSku` (
    `id` VARCHAR(36) NOT NULL,
    `modelId` VARCHAR(36) NOT NULL,
    `sku` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(64) NULL,
    `storage` VARCHAR(64) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `ProductSku_sku_key`(`sku`),
    INDEX `ProductSku_modelId_idx`(`modelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerSession` (
    `id` VARCHAR(36) NOT NULL,
    `reference` VARCHAR(32) NOT NULL,
    `branchId` VARCHAR(36) NOT NULL,
    `staffId` VARCHAR(64) NOT NULL,
    `customerId` VARCHAR(36) NULL,
    `phone` VARCHAR(10) NULL,
    `state` ENUM('WALK_IN', 'DEMO', 'DECISION', 'PRODUCT_SELECTION', 'STOCK_REQUESTED', 'SEARCHING', 'FOUND', 'SENT_TO_CASHIER', 'CASHIER_RECEIVED', 'CASHIER_SCAN', 'BILL_OPENED', 'COMPLETED') NOT NULL DEFAULT 'WALK_IN',
    `confirmed` BOOLEAN NOT NULL DEFAULT false,
    `outcome` ENUM('NOT_BUY', 'OUT_OF_STOCK', 'CUSTOMER_CANCELLED') NULL,
    `reason` VARCHAR(191) NULL,
    `otherReason` TEXT NULL,
    `cancelledBy` VARCHAR(64) NULL,
    `productId` VARCHAR(36) NULL,
    `modelId` VARCHAR(36) NULL,
    `skuId` VARCHAR(36) NULL,
    `customerWalkInAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `demoStartAt` DATETIME(3) NULL,
    `demoEndAt` DATETIME(3) NULL,
    `decisionAt` DATETIME(3) NULL,
    `productSelectionStartAt` DATETIME(3) NULL,
    `productSelectionConfirmedAt` DATETIME(3) NULL,
    `stockStartedAt` DATETIME(3) NULL,
    `stockFoundAt` DATETIME(3) NULL,
    `cashierReceivedAt` DATETIME(3) NULL,
    `cashierScanAt` DATETIME(3) NULL,
    `billOpenedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,

    UNIQUE INDEX `CustomerSession_reference_key`(`reference`),
    INDEX `CustomerSession_branchId_idx`(`branchId`),
    INDEX `CustomerSession_staffId_idx`(`staffId`),
    INDEX `CustomerSession_state_idx`(`state`),
    INDEX `CustomerSession_customerWalkInAt_idx`(`customerWalkInAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionAccessory` (
    `id` VARCHAR(36) NOT NULL,
    `sessionId` VARCHAR(36) NOT NULL,
    `accessoryName` VARCHAR(64) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,

    INDEX `SessionAccessory_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionOntop` (
    `id` VARCHAR(36) NOT NULL,
    `sessionId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,

    INDEX `SessionOntop_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionPoint` (
    `id` VARCHAR(36) NOT NULL,
    `sessionId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,

    INDEX `SessionPoint_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionBurnPoint` (
    `id` VARCHAR(36) NOT NULL,
    `sessionId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,

    INDEX `SessionBurnPoint_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionPayment` (
    `id` VARCHAR(36) NOT NULL,
    `sessionId` VARCHAR(36) NOT NULL,
    `method` VARCHAR(64) NOT NULL,

    INDEX `SessionPayment_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionEvent` (
    `id` VARCHAR(36) NOT NULL,
    `sessionId` VARCHAR(36) NOT NULL,
    `eventType` ENUM('SESSION_CREATED', 'DEMO_STARTED', 'DEMO_ENDED', 'DECISION_MADE', 'PRODUCT_SELECTION_STARTED', 'PRODUCT_SELECTION_CONFIRMED', 'STOCK_SEARCHING', 'STOCK_FOUND', 'STOCK_SENT_TO_CASHIER', 'STOCK_OUT_OF_STOCK', 'CUSTOMER_CANCELLED', 'CASHIER_RECEIVED', 'CASHIER_SCANNED', 'BILL_OPENED', 'COMPLETED') NOT NULL,
    `actorStaffId` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `metadata` JSON NULL,

    INDEX `SessionEvent_sessionId_idx`(`sessionId`),
    INDEX `SessionEvent_eventType_idx`(`eventType`),
    INDEX `SessionEvent_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProductModel` ADD CONSTRAINT `ProductModel_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductSku` ADD CONSTRAINT `ProductSku_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `ProductModel`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerSession` ADD CONSTRAINT `CustomerSession_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerSession` ADD CONSTRAINT `CustomerSession_staffId_fkey` FOREIGN KEY (`staffId`) REFERENCES `Staff`(`staffId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerSession` ADD CONSTRAINT `CustomerSession_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerSession` ADD CONSTRAINT `CustomerSession_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerSession` ADD CONSTRAINT `CustomerSession_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `ProductModel`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerSession` ADD CONSTRAINT `CustomerSession_skuId_fkey` FOREIGN KEY (`skuId`) REFERENCES `ProductSku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionAccessory` ADD CONSTRAINT `SessionAccessory_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `CustomerSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionOntop` ADD CONSTRAINT `SessionOntop_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `CustomerSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionPoint` ADD CONSTRAINT `SessionPoint_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `CustomerSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionBurnPoint` ADD CONSTRAINT `SessionBurnPoint_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `CustomerSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionPayment` ADD CONSTRAINT `SessionPayment_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `CustomerSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionEvent` ADD CONSTRAINT `SessionEvent_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `CustomerSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
