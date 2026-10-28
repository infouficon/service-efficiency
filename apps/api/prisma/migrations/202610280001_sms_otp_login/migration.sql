-- D85: SMS OTP login. Additive: a phone number on Staff, the creation time of a login session (a session lasts 12 h from it),
-- and the table of login codes (hash only).
ALTER TABLE `Staff` ADD COLUMN `phone` VARCHAR(20) NULL;

ALTER TABLE `LoginSession` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE TABLE `LoginOtp` (
    `id` VARCHAR(36) NOT NULL,
    `staffId` VARCHAR(64) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `phoneLast4` VARCHAR(4) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `consumedAt` DATETIME(3) NULL,
    `smsStatus` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `smsMessageId` VARCHAR(64) NULL,
    `smsError` VARCHAR(255) NULL,
    `smsReport` JSON NULL,

    INDEX `LoginOtp_staffId_createdAt_idx`(`staffId`, `createdAt`),
    INDEX `LoginOtp_smsMessageId_idx`(`smsMessageId`),
    INDEX `LoginOtp_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
