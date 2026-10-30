-- D90: the admin log of everything between SES and FileMaker, and what FileMaker reports back. Additive: a new table and five
-- nullable columns on FmpOutbox.
CREATE TABLE `FmpLog` (
    `id` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `direction` VARCHAR(3) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `batchId` VARCHAR(36) NULL,
    `outboxId` VARCHAR(36) NULL,
    `reference` VARCHAR(32) NULL,
    `method` VARCHAR(8) NULL,
    `path` VARCHAR(255) NULL,
    `httpStatus` INTEGER NULL,
    `fmCode` VARCHAR(16) NULL,
    `ok` BOOLEAN NOT NULL,
    `durationMs` INTEGER NULL,
    `summary` VARCHAR(255) NOT NULL,
    `request` TEXT NULL,
    `response` TEXT NULL,

    INDEX `FmpLog_createdAt_idx`(`createdAt`),
    INDEX `FmpLog_reference_createdAt_idx`(`reference`, `createdAt`),
    INDEX `FmpLog_outboxId_idx`(`outboxId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `FmpOutbox`
    ADD COLUMN `ackStatus` VARCHAR(16) NULL,
    ADD COLUMN `ackMessage` VARCHAR(255) NULL,
    ADD COLUMN `ackAt` DATETIME(3) NULL,
    ADD COLUMN `ackTimeText` VARCHAR(40) NULL,
    ADD COLUMN `ackReceivedAt` DATETIME(3) NULL;
