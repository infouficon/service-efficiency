-- F17 (D60): the bill U POS reports for an order (its number and the real time it was opened). Additive: nullable columns.
ALTER TABLE `CustomerSession` ADD COLUMN `posBillNo` VARCHAR(64) NULL,
    ADD COLUMN `posBillOpenedAt` DATETIME(3) NULL;
