-- D130: which FileMaker each message goes to (PRODUCTION / UAT; NONE = held back by ADMIN's switch). Additive: existing rows
-- went to the production FileMaker, which is what the default says.
ALTER TABLE `FmpOutbox` ADD COLUMN `target` VARCHAR(16) NOT NULL DEFAULT 'PRODUCTION';
