-- D145: Clean existing product colors, strip dashes, capacities, and extract nano-texture glass display

-- 1. Extract display: 'Nano-texture Glass' for SKUs that have nano-texture in their name or color
UPDATE `ProductSku`
   SET `attributes` = JSON_SET(COALESCE(`attributes`, '{}'), '$.display', 'Nano-texture Glass')
 WHERE (`name` LIKE '%nano-texture%' OR `color` LIKE '%nano-texture%');

-- 2. Clean ProductSku.color: strip with nano-texture glass
UPDATE `ProductSku`
   SET `color` = TRIM(REGEXP_REPLACE(`color`, '(?i)[ ]*(with[ ]+)?nano-?texture([ ]+glass)?', ''))
 WHERE `color` LIKE '%nano-texture%' OR `color` LIKE '%Nano-texture%';

-- 3. Clean ProductSku.color: strip capacity prefix (e.g. 1TB SSD -, 1TB -)
UPDATE `ProductSku`
   SET `color` = TRIM(REGEXP_REPLACE(`color`, '(?i)^[0-9]+(\\.[0-9]+)?[ ]*(GB|TB)([ ]*(SSD|RAM|Memory|Storage))?[ ]*[-–·:]?[ ]*', ''))
 WHERE `color` REGEXP '^[0-9]+[ ]*(GB|TB)';

-- 4. Clean ProductSku.color: strip leading/trailing dashes and colons
UPDATE `ProductSku`
   SET `color` = TRIM(LEADING '-' FROM TRIM(LEADING '–' FROM TRIM(`color`)))
 WHERE `color` LIKE '-%' OR `color` LIKE '–%';

UPDATE `ProductSku`
   SET `color` = TRIM(TRAILING '-' FROM TRIM(TRAILING '–' FROM TRIM(`color`)))
 WHERE `color` LIKE '%-' OR `color` LIKE '%–';

-- If color became empty string, set to NULL
UPDATE `ProductSku` SET `color` = NULL WHERE `color` = '';

-- 5. Synchronize cleaned color into attributes JSON if present
UPDATE `ProductSku`
   SET `attributes` = JSON_SET(`attributes`, '$.color', `color`)
 WHERE `attributes` IS NOT NULL
   AND `color` IS NOT NULL
   AND JSON_EXTRACT(`attributes`, '$.color') IS NOT NULL;

-- 6. Clean up ProductColor table: delete dirty entries
DELETE FROM `ProductColor`
 WHERE `name` LIKE '-%'
    OR `name` LIKE '–%'
    OR `name` LIKE '%nano-texture%'
    OR `name` LIKE '%Nano-texture%'
    OR `name` REGEXP '^[0-9]+[ ]*(GB|TB)';
