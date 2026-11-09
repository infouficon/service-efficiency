-- D112: AirPods, Apple TV, HomePod and AirTag become main-product categories (switched on, not accessory-like), listed right
-- after Watch. Their ERP SKUs leave "Accessories" on the warroom sync's next scheduled check (catalog rules version 6).
-- The derived tables carry an aggregate, so MySQL materialises them (no "can't specify target table" error).
UPDATE `Category` AS `c`
JOIN (SELECT COALESCE(MAX(`position`), 0) AS `w` FROM `Category` WHERE `name` = 'Watch') AS `x`
SET `c`.`position` = `c`.`position` + 4
WHERE `c`.`position` > `x`.`w`;

INSERT IGNORE INTO `Category` (`id`, `name`, `active`, `position`, `isAccessory`, `erpManaged`, `createdAt`)
SELECT UUID(), `l`.`name`, true, `x`.`w` + `l`.`n`, false, false, CURRENT_TIMESTAMP(3)
FROM (SELECT COALESCE(MAX(`position`), 0) AS `w` FROM `Category` WHERE `name` = 'Watch') AS `x`
CROSS JOIN (
  SELECT 'AirPods' AS `name`, 1 AS `n`
  UNION ALL SELECT 'Apple TV', 2
  UNION ALL SELECT 'HomePod', 3
  UNION ALL SELECT 'AirTag', 4
) AS `l`;
