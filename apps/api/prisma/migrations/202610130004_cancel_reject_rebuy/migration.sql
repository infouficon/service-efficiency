-- F11/F12/F13: the stock side of a cancel (acknowledged by stock), "buy again" (the new session points at the cancelled one)
-- and two new event types (the cashier sends an order back; stock acknowledges a cancel). Additive: nullable columns, a
-- longer enum list, and a unique index that lets each cancelled session be bought again once.
ALTER TABLE `CustomerSession` ADD COLUMN `rebuyOfId` VARCHAR(36) NULL,
    ADD COLUMN `stockAckAt` DATETIME(3) NULL,
    ADD COLUMN `stockAckBy` VARCHAR(64) NULL;

ALTER TABLE `SessionEvent` MODIFY `eventType` ENUM('SESSION_CREATED', 'DEMO_STARTED', 'DEMO_ENDED', 'DECISION_MADE', 'PRODUCT_SELECTION_STARTED', 'PRODUCT_SELECTION_CONFIRMED', 'STOCK_SEARCHING', 'STOCK_FOUND', 'STOCK_SENT_TO_CASHIER', 'STOCK_OUT_OF_STOCK', 'CUSTOMER_CANCELLED', 'STOCK_REPORTED_MISSING', 'STAFF_RESOLVED_STOCK_REVIEW', 'CASHIER_RECEIVED', 'CASHIER_SCANNED', 'BILL_OPENED', 'COMPLETED', 'CASHIER_REJECTED', 'STOCK_ACKNOWLEDGED_CANCEL') NOT NULL;

CREATE UNIQUE INDEX `CustomerSession_rebuyOfId_key` ON `CustomerSession`(`rebuyOfId`);

ALTER TABLE `CustomerSession` ADD CONSTRAINT `CustomerSession_rebuyOfId_fkey` FOREIGN KEY (`rebuyOfId`) REFERENCES `CustomerSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Every session cancelled before this release counts as acknowledged: stock must not be flooded with notices for history.
UPDATE `CustomerSession` SET `stockAckAt` = COALESCE(`cancelledAt`, CURRENT_TIMESTAMP(3))
WHERE `outcome` = 'CUSTOMER_CANCELLED' AND `stockAckAt` IS NULL;
