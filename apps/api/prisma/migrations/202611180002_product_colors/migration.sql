-- D143: ProductColor stores color code mappings (hexCode) for product colors
CREATE TABLE `ProductColor` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `hexCode` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProductColor_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
