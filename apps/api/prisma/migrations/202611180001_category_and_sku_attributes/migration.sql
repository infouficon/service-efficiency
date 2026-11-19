-- D142: category specification templates and SKU attributes
ALTER TABLE `Category` ADD COLUMN `attributes` JSON NULL;
ALTER TABLE `ProductSku` ADD COLUMN `attributes` JSON NULL;

-- Default category specification templates (D142, D143: attribute keys without hardcoded options)
UPDATE `Category` SET `attributes` = '[{"key":"color","label":"สี","required":true}, {"key":"storage","label":"ความจุ","required":true}, {"key":"display","label":"จอภาพ","required":true}, {"key":"connectivity","label":"การเชื่อมต่อ","required":true}]' WHERE `name` = 'iPad';
UPDATE `Category` SET `attributes` = '[ {"key":"color","label":"สี","required":true}, {"key":"storage","label":"ความจุ","required":true}]' WHERE `name` = 'iPhone';
UPDATE `Category` SET `attributes` = '[ {"key":"color","label":"สี","required":true}, {"key":"display","label":"จอภาพ","required":true}, {"key":"chip","label":"Chip","required":true}, {"key":"customisations","label":"Customisations","required":true}]' WHERE `name` = 'Mac';
UPDATE `Category` SET `attributes` = '[ {"key":"case","label":"ตัวเรือน"}, {"key":"caseSize","label":"ขนาดตัวเรือน"}, {"key":"connectivity","label":"การเชื่อมต่อ","required":true}, {"key":"band","label":"สายนาฬิกา","required":true}]' WHERE `name` = 'Watch';