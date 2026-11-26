-- D198: Add recommendationRecords to CustomerSession
ALTER TABLE `CustomerSession` ADD COLUMN `recommendationRecords` JSON NULL;
