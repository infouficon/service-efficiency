-- D57: customer types, queue numbers and atomic daily counters. Additive only: nullable columns and new tables, so the
-- previous release keeps working against this schema.
ALTER TABLE `CustomerSession` ADD COLUMN `customerTypeId` VARCHAR(36) NULL,
    ADD COLUMN `queueLetter` VARCHAR(1) NULL,
    ADD COLUMN `queueNo` INTEGER NULL;

CREATE TABLE `CustomerType` (
    `id` VARCHAR(36) NOT NULL,
    `letter` VARCHAR(1) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `description` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerType_letter_key`(`letter`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DailyCounter` (
    `scope` VARCHAR(80) NOT NULL,
    `day` VARCHAR(10) NOT NULL,
    `lastNo` INTEGER NOT NULL,

    PRIMARY KEY (`scope`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CustomerSession` ADD CONSTRAINT `CustomerSession_customerTypeId_fkey` FOREIGN KEY (`customerTypeId`) REFERENCES `CustomerType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- The two types the meeting asked for (A = ordinary, B = takes long). The back office can rename them or add more.
INSERT INTO `CustomerType` (`id`, `letter`, `name`, `description`, `active`, `createdAt`, `updatedAt`) VALUES
    (UUID(), 'A', 'ลูกค้าทั่วไป', NULL, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    (UUID(), 'B', 'ลูกค้าใช้เวลานาน', 'ลูกค้าที่ใช้เวลาบริการนานกว่าปกติ', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

-- Sessions created before D57 keep their old per-day running number as the queue number (without a letter).
UPDATE `CustomerSession` SET `queueNo` = CAST(SUBSTRING_INDEX(`reference`, '-', -1) AS UNSIGNED) WHERE `queueNo` IS NULL;

-- The new reference counter must continue after the references that already exist for a day, otherwise the first walk-in
-- after the deploy would collide with SES-<today>-000001 (the unique key would fail and, since the counter rolls back
-- with the transaction, every later walk-in of that day too).
INSERT INTO `DailyCounter` (`scope`, `day`, `lastNo`)
SELECT 'reference',
       CONCAT(SUBSTRING(`reference`, 5, 4), '-', SUBSTRING(`reference`, 9, 2), '-', SUBSTRING(`reference`, 11, 2)) AS `d`,
       MAX(CAST(SUBSTRING_INDEX(`reference`, '-', -1) AS UNSIGNED))
FROM `CustomerSession`
WHERE `reference` REGEXP '^SES-[0-9]{8}-[0-9]+$'
GROUP BY `d`;
