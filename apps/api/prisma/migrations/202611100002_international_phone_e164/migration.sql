-- D120: International phone support, Thai 9-digit company numbers, leading 0 strip, stored as E.164.
ALTER TABLE `Customer` MODIFY COLUMN `phone` VARCHAR(32) NOT NULL;
ALTER TABLE `CustomerSession` MODIFY COLUMN `phone` VARCHAR(32) NULL;

-- Migrate existing Thai phone numbers starting with '0' to E.164 (+66...)
UPDATE `Customer`
SET `phone` = CONCAT('+66', SUBSTRING(`phone`, 2))
WHERE `phone` LIKE '0%' AND LENGTH(`phone`) >= 9;

UPDATE `CustomerSession`
SET `phone` = CONCAT('+66', SUBSTRING(`phone`, 2))
WHERE `phone` LIKE '0%' AND LENGTH(`phone`) >= 9;
