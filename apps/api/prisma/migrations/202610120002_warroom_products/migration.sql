-- Products and stock from the warroom database (D52): additive only.
ALTER TABLE `Product` ADD COLUMN `erpManaged` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `ProductModel` ADD COLUMN `erpManaged` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `ProductSku` ADD COLUMN `erpManaged` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `BranchInventory`
    ADD COLUMN `erpReady` INTEGER NULL,
    ADD COLUMN `erpTransfer` INTEGER NULL,
    ADD COLUMN `erpAsOf` DATETIME(3) NULL,
    ADD COLUMN `outOfStockAt` DATETIME(3) NULL;
