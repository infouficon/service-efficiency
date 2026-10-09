-- CreateTable
CREATE TABLE `BranchInventory` (
    `id` VARCHAR(36) NOT NULL,
    `branchId` VARCHAR(36) NOT NULL,
    `skuId` VARCHAR(36) NOT NULL,
    `stock` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `BranchInventory_branchId_idx`(`branchId`),
    INDEX `BranchInventory_skuId_idx`(`skuId`),
    UNIQUE INDEX `BranchInventory_branchId_skuId_key`(`branchId`, `skuId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BranchInventory` ADD CONSTRAINT `BranchInventory_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BranchInventory` ADD CONSTRAINT `BranchInventory_skuId_fkey` FOREIGN KEY (`skuId`) REFERENCES `ProductSku`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
