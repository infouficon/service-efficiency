-- D105 (the shops' team, 2026-11-05): SES gets the payment method "ใบมัดจำ" (paying with a deposit slip, FileMaker type
-- "ใช้มัดจำ"); "Trade In" is an On top item, not a payment; "Partner Mall" is not sold through SES. Data only, idempotent.

-- a deposit method that already exists (ADMIN may have added one) is kept, switched on and typed
UPDATE `PaymentMethod` SET `active` = true, `fmpType` = 'ใช้มัดจำ' WHERE `name` IN ('ใบมัดจำ', 'ใช้มัดจำ');

-- otherwise "ใบมัดจำ" is added at the end of the list
INSERT INTO `PaymentMethod` (`id`, `name`, `active`, `position`, `fmpType`)
SELECT UUID(), 'ใบมัดจำ', true, COALESCE(MAX(`position`), 0) + 1, 'ใช้มัดจำ'
FROM `PaymentMethod`
WHERE NOT EXISTS (SELECT 1 FROM (SELECT `id` FROM `PaymentMethod` WHERE `name` IN ('ใบมัดจำ', 'ใช้มัดจำ') OR `fmpType` = 'ใช้มัดจำ') AS existing);

-- the two FileMaker types SES no longer offers; a method named after them is switched off (ADMIN can switch it back on)
UPDATE `PaymentMethod` SET `fmpType` = NULL WHERE `fmpType` IN ('Trade In', 'Partner Mall');
UPDATE `PaymentMethod` SET `active` = false WHERE `name` IN ('Trade In', 'Partner Mall');
