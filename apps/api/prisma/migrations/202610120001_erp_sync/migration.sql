-- ERP import (D53/D54): additive only. Existing rows keep NULL and are never touched by the import.
ALTER TABLE `Branch` ADD COLUMN `erpBranchId` INTEGER NULL;
ALTER TABLE `Staff` ADD COLUMN `erpStaffId` INTEGER NULL,
    ADD COLUMN `erpSyncedAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `Branch_erpBranchId_key` ON `Branch`(`erpBranchId`);
CREATE UNIQUE INDEX `Staff_erpStaffId_key` ON `Staff`(`erpStaffId`);

CREATE TABLE `ErpSyncRun` (
    `id` VARCHAR(36) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `slot` VARCHAR(40) NOT NULL,
    `trigger` VARCHAR(16) NOT NULL,
    `dryRun` BOOLEAN NOT NULL DEFAULT false,
    `attempts` INTEGER NOT NULL DEFAULT 1,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `ok` BOOLEAN NULL,
    `summary` JSON NULL,
    `error` TEXT NULL,
    `actorStaffId` VARCHAR(64) NULL,

    INDEX `ErpSyncRun_startedAt_idx`(`startedAt`),
    UNIQUE INDEX `ErpSyncRun_kind_slot_key`(`kind`, `slot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
