-- F10: the address the receipt's QR code opens (customer registration), one per branch. Additive: a nullable column.
ALTER TABLE `Branch` ADD COLUMN `registrationUrl` VARCHAR(512) NULL;
