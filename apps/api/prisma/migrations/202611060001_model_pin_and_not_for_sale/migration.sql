-- D109: ADMIN pins a model ("ปักหมุด") to put it first in the staff's model list; the last pinned is on top.
ALTER TABLE `ProductModel` ADD COLUMN `pinnedAt` DATETIME(3) NULL;

-- D109: what the warroom sync created but SES does not sell is switched off the way ADMIN switches a product off (the product or
-- model, its SKUs and its branch rows): service parts and demo units (warroom sub-category, the SES product name) and the
-- AppleCare+ incident fees (model "AC+ Incident"). ERP-made records only; idempotent; ADMIN can switch any of them back on.
UPDATE `BranchInventory` AS `bi`
JOIN `ProductSku` AS `s` ON `s`.`id` = `bi`.`skuId`
JOIN `ProductModel` AS `m` ON `m`.`id` = `s`.`modelId`
JOIN `Product` AS `p` ON `p`.`id` = `m`.`productId`
SET `bi`.`active` = false
WHERE `p`.`erpManaged` = true
  AND (LOWER(TRIM(`p`.`name`)) IN ('whole unit', 'display', 'back glass', 'connectivity cards', 'apple demo units')
       OR `m`.`name` LIKE '%AC+ Incident%');

UPDATE `ProductSku` AS `s`
JOIN `ProductModel` AS `m` ON `m`.`id` = `s`.`modelId`
JOIN `Product` AS `p` ON `p`.`id` = `m`.`productId`
SET `s`.`active` = false
WHERE `p`.`erpManaged` = true
  AND (LOWER(TRIM(`p`.`name`)) IN ('whole unit', 'display', 'back glass', 'connectivity cards', 'apple demo units')
       OR `m`.`name` LIKE '%AC+ Incident%');

UPDATE `ProductModel` AS `m`
JOIN `Product` AS `p` ON `p`.`id` = `m`.`productId`
SET `m`.`active` = false
WHERE `p`.`erpManaged` = true
  AND (LOWER(TRIM(`p`.`name`)) IN ('whole unit', 'display', 'back glass', 'connectivity cards', 'apple demo units')
       OR `m`.`name` LIKE '%AC+ Incident%');

UPDATE `Product` SET `active` = false
WHERE `erpManaged` = true
  AND LOWER(TRIM(`name`)) IN ('whole unit', 'display', 'back glass', 'connectivity cards', 'apple demo units');
