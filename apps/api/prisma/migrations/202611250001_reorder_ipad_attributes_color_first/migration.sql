-- Reorder iPad specifications to ensure Color (สี) is first, matching Apple Store and user requirement
UPDATE `Category`
SET `attributes` = '[{"key":"color","label":"สี","required":true},{"key":"storage","label":"ความจุ","required":true},{"key":"display","label":"จอภาพ","required":true},{"key":"connectivity","label":"การเชื่อมต่อ","required":true}]'
WHERE `name` = 'iPad';
