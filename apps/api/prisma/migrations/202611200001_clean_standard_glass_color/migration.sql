-- D157: Clean leaked standard glass display specifications from ProductSku and ProductColor
UPDATE `ProductSku`
SET `color` = 'Midnight'
WHERE `color` LIKE '%standard glass%Midnight%';

UPDATE `ProductSku`
SET `color` = 'Starlight'
WHERE `color` LIKE '%standard glass%Starlight%';

UPDATE `ProductSku`
SET `color` = 'Silver'
WHERE `color` LIKE '%standard glass%Silver%';

UPDATE `ProductSku`
SET `color` = 'Space Black'
WHERE `color` LIKE '%standard glass%Space Black%';

-- Clean attributes JSON where color is embedded
UPDATE `ProductSku`
SET `attributes` = JSON_SET(`attributes`, '$.color', 'Midnight')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`attributes`, '$.color')) LIKE '%standard glass%Midnight%';

UPDATE `ProductSku`
SET `attributes` = JSON_SET(`attributes`, '$.color', 'Starlight')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`attributes`, '$.color')) LIKE '%standard glass%Starlight%';

UPDATE `ProductSku`
SET `attributes` = JSON_SET(`attributes`, '$.color', 'Silver')
WHERE JSON_UNQUOTE(JSON_EXTRACT(`attributes`, '$.color')) LIKE '%standard glass%Silver%';

-- Remove redundant ProductColor entries with 'standard glass'
DELETE FROM `ProductColor`
WHERE `name` LIKE '%standard glass%';
