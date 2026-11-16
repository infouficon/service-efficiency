-- D141: Add allowOther flag to SurveyQuestion
ALTER TABLE `SurveyQuestion` ADD COLUMN `allowOther` BOOLEAN NOT NULL DEFAULT false;
