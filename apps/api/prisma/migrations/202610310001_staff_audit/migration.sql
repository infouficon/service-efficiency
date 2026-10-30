-- D92: the audit trail of user-account changes (who created / changed / reset / exported). Additive: a new table.
CREATE TABLE `StaffAudit` (
    `id` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actorStaffId` VARCHAR(64) NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `targetStaffId` VARCHAR(64) NULL,
    `via` VARCHAR(16) NOT NULL,
    `changes` JSON NULL,

    INDEX `StaffAudit_createdAt_idx`(`createdAt`),
    INDEX `StaffAudit_targetStaffId_createdAt_idx`(`targetStaffId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
