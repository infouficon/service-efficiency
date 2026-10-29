-- D88: the outbox of orders sent to FileMaker. Additive: a new table (empty until FMP_* is configured).
CREATE TABLE `FmpOutbox` (
    `id` VARCHAR(36) NOT NULL,
    `sessionId` VARCHAR(36) NOT NULL,
    `reference` VARCHAR(32) NOT NULL,
    `event` VARCHAR(32) NOT NULL,
    `payload` MEDIUMTEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedAt` DATETIME(3) NULL,
    `fmpRecordId` VARCHAR(32) NULL,
    `scriptResult` VARCHAR(255) NULL,
    `lastError` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,

    INDEX `FmpOutbox_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `FmpOutbox_reference_idx`(`reference`),
    INDEX `FmpOutbox_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
