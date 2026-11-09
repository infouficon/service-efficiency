-- D113: login OTP over the UFiconStaff LINE OA. Additive: the LINE userId on Staff (from the ERP import) and the channel a
-- login code went out on (existing rows were all SMS).
ALTER TABLE `Staff` ADD COLUMN `lineUserId` VARCHAR(64) NULL;

ALTER TABLE `LoginOtp` ADD COLUMN `channel` VARCHAR(8) NOT NULL DEFAULT 'sms';
