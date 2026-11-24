-- D188: Default specification templates for accessory categories (customizable by Admin in CategoriesPanel)
INSERT IGNORE INTO `Category` (`id`, `name`, `active`, `position`, `isAccessory`, `erpManaged`, `createdAt`)
VALUES
  (UUID(), 'Watch Accessories', true, 10, true, false, CURRENT_TIMESTAMP(3)),
  (UUID(), 'iPhone Case', true, 11, true, false, CURRENT_TIMESTAMP(3)),
  (UUID(), 'iPad Case', true, 12, true, false, CURRENT_TIMESTAMP(3)),
  (UUID(), 'iPad Case & Keyboard', true, 13, true, false, CURRENT_TIMESTAMP(3)),
  (UUID(), 'Pencil', true, 14, true, false, CURRENT_TIMESTAMP(3)),
  (UUID(), 'Wallet & Lanyards', true, 15, true, false, CURRENT_TIMESTAMP(3)),
  (UUID(), 'Mice & Keyboards', true, 16, true, false, CURRENT_TIMESTAMP(3)),
  (UUID(), 'Device Protectors for Apple Devices', true, 17, true, false, CURRENT_TIMESTAMP(3)),
  (UUID(), 'Charging Device', true, 18, true, false, CURRENT_TIMESTAMP(3)),
  (UUID(), 'Cables & Connectors', true, 19, true, false, CURRENT_TIMESTAMP(3));

-- Ensure isAccessory is true for accessory categories
UPDATE `Category` SET `isAccessory` = true WHERE `name` IN (
  'Watch Accessories', 'iPhone Case', 'iPad Case', 'iPad Case & Keyboard', 'Pencil',
  'Wallet & Lanyards', 'Mice & Keyboards', 'Device Protectors for Apple Devices', 'Charging Device', 'Cables & Connectors'
);

-- Default attributes for each accessory category if not yet configured
UPDATE `Category` SET `attributes` = '[{"key":"caseSize","label":"ขนาดตัวเรือน","required":true},{"key":"band","label":"สายนาฬิกา","required":true},{"key":"bandSize","label":"ขนาดสาย","required":true},{"key":"color","label":"สี","required":true}]'
WHERE `name` = 'Watch Accessories' AND (`attributes` IS NULL OR JSON_LENGTH(`attributes`) = 0);

UPDATE `Category` SET `attributes` = '[{"key":"caseType","label":"ประเภทเคส","required":true},{"key":"color","label":"สี","required":true}]'
WHERE `name` = 'iPhone Case' AND (`attributes` IS NULL OR JSON_LENGTH(`attributes`) = 0);

UPDATE `Category` SET `attributes` = '[{"key":"type","label":"ประเภท","required":true},{"key":"language","label":"ภาษาแป้นพิมพ์"},{"key":"color","label":"สี","required":true}]'
WHERE `name` IN ('iPad Case', 'iPad Case & Keyboard') AND (`attributes` IS NULL OR JSON_LENGTH(`attributes`) = 0);

UPDATE `Category` SET `attributes` = '[{"key":"type","label":"ประเภท","required":true},{"key":"color","label":"สี","required":true}]'
WHERE `name` = 'Wallet & Lanyards' AND (`attributes` IS NULL OR JSON_LENGTH(`attributes`) = 0);

UPDATE `Category` SET `attributes` = '[{"key":"touchId","label":"Touch ID"},{"key":"numericKeypad","label":"Numeric Keypad"},{"key":"language","label":"ภาษาแป้นพิมพ์"},{"key":"color","label":"สี","required":true}]'
WHERE `name` = 'Mice & Keyboards' AND (`attributes` IS NULL OR JSON_LENGTH(`attributes`) = 0);

UPDATE `Category` SET `attributes` = '[{"key":"type","label":"ประเภท","required":true},{"key":"color","label":"สี","required":true}]'
WHERE `name` = 'Device Protectors for Apple Devices' AND (`attributes` IS NULL OR JSON_LENGTH(`attributes`) = 0);

UPDATE `Category` SET `attributes` = '[{"key":"wattage","label":"จำนวนวัตต์","required":true}]'
WHERE `name` = 'Charging Device' AND (`attributes` IS NULL OR JSON_LENGTH(`attributes`) = 0);
