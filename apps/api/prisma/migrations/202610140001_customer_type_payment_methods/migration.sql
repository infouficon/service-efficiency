-- D69: link payment methods to customer types (e.g. Type B for long-service payment options like installments / UFund)
ALTER TABLE `CustomerType` ADD COLUMN `paymentMethods` JSON NULL;

-- Default Type B to have long-service payment methods if Type B exists
UPDATE `CustomerType`
SET `paymentMethods` = '["0% Credit Card", "PayNext", "UFund", "Ulite", "Thisshop", "Kashjoy"]'
WHERE `letter` = 'B' AND `paymentMethods` IS NULL;
