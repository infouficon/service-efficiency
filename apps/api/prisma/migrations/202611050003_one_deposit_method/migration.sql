-- D105 fix: 202611050001 inserted "ใบมัดจำ" even where "ใช้มัดจำ" already existed (an INSERT … SELECT with MAX() always yields one
-- row, so the NOT EXISTS guard did not stop it) and put it at the top of the list. Keep one deposit method: "ใบมัดจำ" (the shops'
-- word) takes the older method's place in the list; "ใช้มัดจำ" is switched off (ADMIN can switch it back on). Idempotent; a database
-- with only one of them is not changed.
UPDATE `PaymentMethod` AS `b`
JOIN (SELECT `position` FROM `PaymentMethod` WHERE `name` = 'ใช้มัดจำ') AS `old`
SET `b`.`position` = `old`.`position`
WHERE `b`.`name` = 'ใบมัดจำ';

UPDATE `PaymentMethod` SET `active` = false
WHERE `name` = 'ใช้มัดจำ' AND EXISTS (SELECT 1 FROM (SELECT `id` FROM `PaymentMethod` WHERE `name` = 'ใบมัดจำ') AS `slip`);
