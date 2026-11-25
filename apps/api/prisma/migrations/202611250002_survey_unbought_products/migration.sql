-- D198: Add unboughtProducts to SurveyResponse
ALTER TABLE `SurveyResponse` ADD COLUMN `unboughtProducts` JSON NULL;
