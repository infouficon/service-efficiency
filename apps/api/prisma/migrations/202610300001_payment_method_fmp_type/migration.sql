-- D89: each payment method gets the payment TYPE FileMaker knows it by, so the FMP push can send `paymentTypes` next to `payments`.
-- Additive: one nullable column. The four obvious methods are pre-filled; every other method stays NULL (sent as "อื่นๆ") until an
-- ADMIN picks a type in Admin -> ช่องทางชำระเงิน. The pre-filled values are SES's reading of the FMP team's list, not yet confirmed by them.
ALTER TABLE `PaymentMethod` ADD COLUMN `fmpType` VARCHAR(32) NULL;

UPDATE `PaymentMethod` SET `fmpType` = 'เงินสด' WHERE `name` = 'Cash' AND `fmpType` IS NULL;
UPDATE `PaymentMethod` SET `fmpType` = 'โอนเงิน' WHERE `name` = 'Transfer' AND `fmpType` IS NULL;
UPDATE `PaymentMethod` SET `fmpType` = 'บัตรเครดิต' WHERE `name` = 'Full Credit Card' AND `fmpType` IS NULL;
UPDATE `PaymentMethod` SET `fmpType` = 'บัตรเงินผ่อน' WHERE `name` = '0% Credit Card' AND `fmpType` IS NULL;
