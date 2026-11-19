-- D148: Update Watch category specification template to 5 attributes (caseMaterial, color, caseSize, connectivity, band)
UPDATE `Category`
SET `attributes` = '[{"key":"caseMaterial","label":"ตัวเรือน","required":true},{"key":"color","label":"สี","required":true},{"key":"caseSize","label":"ขนาดตัวเรือน","required":true},{"key":"connectivity","label":"การเชื่อมต่อ","required":true},{"key":"band","label":"สาย","required":true}]'
WHERE `name` = 'Watch';
