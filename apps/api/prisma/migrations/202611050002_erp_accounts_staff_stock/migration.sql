-- D106 (owner, 2026-11-05): every account that comes from the ERP works the floor and the stock room: STAFF + STOCK, and no
-- CASHIER (the till is U POS, D105). ADMIN / MANAGER (hand-managed) are untouched. The daily ERP import applies the same rule
-- from now on (POSITION_ROLE_RULES; extra people keep what ADMIN picked, reset here once). Idempotent.
INSERT IGNORE INTO `StaffRole` (`staffId`, `roleCode`) SELECT `staffId`, 'STAFF' FROM `Staff` WHERE `erpStaffId` IS NOT NULL;
INSERT IGNORE INTO `StaffRole` (`staffId`, `roleCode`) SELECT `staffId`, 'STOCK' FROM `Staff` WHERE `erpStaffId` IS NOT NULL;
DELETE `sr` FROM `StaffRole` AS `sr` JOIN `Staff` AS `s` ON `s`.`staffId` = `sr`.`staffId`
WHERE `s`.`erpStaffId` IS NOT NULL AND `sr`.`roleCode` = 'CASHIER';
UPDATE `ErpExtraStaff` SET `roles` = 'STAFF,STOCK';
