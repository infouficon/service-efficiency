-- D87: ERP staff an ADMIN picked by hand for the import (outside its usual scope). Additive: a new table.
CREATE TABLE `ErpExtraStaff` (
    `erpStaffId` INTEGER NOT NULL,
    `roles` VARCHAR(64) NOT NULL,
    `branchId` VARCHAR(36) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdBy` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`erpStaffId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
