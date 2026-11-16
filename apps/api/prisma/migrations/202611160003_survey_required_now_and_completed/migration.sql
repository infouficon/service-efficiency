-- D144: Add requiredNow to SurveyQuestion and completed to SurveyResponse
ALTER TABLE `SurveyQuestion` ADD COLUMN `requiredNow` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `SurveyResponse` ADD COLUMN `completed` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `SurveyResponse` ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
