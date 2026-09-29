-- CreateTable
CREATE TABLE `Branch` (
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(64) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Staff` (
    `staffId` VARCHAR(64) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `branchCode` VARCHAR(64) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT true,
    `failedAttempts` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,

    PRIMARY KEY (`staffId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `code` ENUM('ADMIN', 'MANAGER', 'STAFF', 'STOCK', 'CASHIER') NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StaffRole` (
    `staffId` VARCHAR(64) NOT NULL,
    `roleCode` ENUM('ADMIN', 'MANAGER', 'STAFF', 'STOCK', 'CASHIER') NOT NULL,

    PRIMARY KEY (`staffId`, `roleCode`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoginSession` (
    `tokenHash` CHAR(64) NOT NULL,
    `staffId` VARCHAR(64) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL,

    INDEX `LoginSession_staffId_idx`(`staffId`),
    INDEX `LoginSession_lastSeenAt_idx`(`lastSeenAt`),
    PRIMARY KEY (`tokenHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountLock` (
    `id` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Staff` ADD CONSTRAINT `Staff_branchCode_fkey` FOREIGN KEY (`branchCode`) REFERENCES `Branch`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffRole` ADD CONSTRAINT `StaffRole_staffId_fkey` FOREIGN KEY (`staffId`) REFERENCES `Staff`(`staffId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffRole` ADD CONSTRAINT `StaffRole_roleCode_fkey` FOREIGN KEY (`roleCode`) REFERENCES `Role`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoginSession` ADD CONSTRAINT `LoginSession_staffId_fkey` FOREIGN KEY (`staffId`) REFERENCES `Staff`(`staffId`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Required security mutex and fixed roles; no sample Branch/Staff data.
INSERT INTO `AccountLock` (`id`) VALUES (1);
INSERT INTO `Role` (`code`) VALUES ('ADMIN'), ('MANAGER'), ('STAFF'), ('STOCK'), ('CASHIER');
