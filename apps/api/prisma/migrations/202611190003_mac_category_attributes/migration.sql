-- D150: Update Mac category specification template to 4 attributes (RAM, storage, color, display)
UPDATE `Category`
SET `attributes` = '[{"key":"memory","label":"RAM","required":true},{"key":"storage","label":"ความจุ","required":true},{"key":"color","label":"สี","required":true},{"key":"display","label":"จอภาพ","required":false}]'
WHERE `name` = 'Mac';
