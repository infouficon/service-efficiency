-- D92: the serial numbers STOCK scans when it sends a main product to the cashier. Additive: a new table (empty until used).
CREATE TABLE `SessionItemSerial` (
    `id` VARCHAR(36) NOT NULL,
    `sessionItemId` VARCHAR(36) NOT NULL,
    `sn` VARCHAR(64) NOT NULL,
    `position` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SessionItemSerial_sn_idx`(`sn`),
    UNIQUE INDEX `SessionItemSerial_sessionItemId_sn_key`(`sessionItemId`, `sn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SessionItemSerial` ADD CONSTRAINT `SessionItemSerial_sessionItemId_fkey` FOREIGN KEY (`sessionItemId`) REFERENCES `SessionItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
