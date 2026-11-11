-- D127: card options (banks/issuers and installment months) for payment methods (Full Credit Card, 0% Credit Card)
CREATE TABLE `PaymentCardOption` (
    `id` VARCHAR(36) NOT NULL,
    `paymentMethodId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `position` INTEGER NOT NULL DEFAULT 0,
    `installmentMonths` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PaymentCardOption_paymentMethodId_name_key`(`paymentMethodId`, `name`),
    INDEX `PaymentCardOption_paymentMethodId_idx`(`paymentMethodId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `PaymentCardOption_paymentMethodId_fkey` FOREIGN KEY (`paymentMethodId`) REFERENCES `PaymentMethod`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SessionPayment`
    ADD COLUMN `cardType` VARCHAR(64) NULL,
    ADD COLUMN `installmentMonths` INTEGER NULL;

-- Seed default card options for Full Credit Card
INSERT INTO `PaymentCardOption` (`id`, `paymentMethodId`, `name`, `active`, `position`, `installmentMonths`, `createdAt`)
SELECT UUID(), pm.`id`, c.name, true, c.pos, NULL, CURRENT_TIMESTAMP(3)
FROM `PaymentMethod` pm
CROSS JOIN (
    SELECT 'KBank' AS name, 1 AS pos UNION ALL
    SELECT 'SCB', 2 UNION ALL
    SELECT 'KTC', 3 UNION ALL
    SELECT 'BBL', 4 UNION ALL
    SELECT 'Krungsri', 5 UNION ALL
    SELECT 'TTB', 6 UNION ALL
    SELECT 'UOB', 7 UNION ALL
    SELECT 'CardX', 8
) c
WHERE pm.`name` = 'Full Credit Card';

-- Seed default card options for 0% Credit Card
INSERT INTO `PaymentCardOption` (`id`, `paymentMethodId`, `name`, `active`, `position`, `installmentMonths`, `createdAt`)
SELECT UUID(), pm.`id`, c.name, true, c.pos, CAST('[3, 6, 10]' AS JSON), CURRENT_TIMESTAMP(3)
FROM `PaymentMethod` pm
CROSS JOIN (
    SELECT 'KBank' AS name, 1 AS pos UNION ALL
    SELECT 'SCB', 2 UNION ALL
    SELECT 'KTC', 3 UNION ALL
    SELECT 'BBL', 4 UNION ALL
    SELECT 'Krungsri', 5 UNION ALL
    SELECT 'TTB', 6 UNION ALL
    SELECT 'UOB', 7 UNION ALL
    SELECT 'First Choice', 8
) c
WHERE pm.`name` = '0% Credit Card';
