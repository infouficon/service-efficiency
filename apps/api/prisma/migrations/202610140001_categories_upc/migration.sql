-- D68: product categories become a list ADMIN keeps (and the warroom sync adds to), and a SKU gets a UPC next to its part number.
-- Safe on a live database: a new table seeded with the five categories the enum had, the enum column widened to text with the
-- same values, and one nullable column.
CREATE TABLE `Category` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `position` INTEGER NOT NULL DEFAULT 0,
    `isAccessory` BOOLEAN NOT NULL DEFAULT false,
    `erpManaged` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Category_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `Category` (`id`, `name`, `active`, `position`, `isAccessory`, `erpManaged`, `createdAt`) VALUES
    (UUID(), 'iPhone', true, 1, false, false, CURRENT_TIMESTAMP(3)),
    (UUID(), 'iPad', true, 2, false, false, CURRENT_TIMESTAMP(3)),
    (UUID(), 'Mac', true, 3, false, false, CURRENT_TIMESTAMP(3)),
    (UUID(), 'Watch', true, 4, false, false, CURRENT_TIMESTAMP(3)),
    (UUID(), 'Accessories', true, 5, true, false, CURRENT_TIMESTAMP(3));

ALTER TABLE `Product` MODIFY `category` VARCHAR(100) NOT NULL;
CREATE INDEX `Product_category_idx` ON `Product`(`category`);

ALTER TABLE `ProductSku` ADD COLUMN `upc` VARCHAR(64) NULL;
