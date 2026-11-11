-- D128: Replace single taxInvoice toggle with 3-way receiptType (corporate tax invoice, individual tax invoice, simplified receipt)
ALTER TABLE `CustomerSession`
  ADD COLUMN `receiptType` ENUM('TAX_CORPORATE', 'TAX_INDIVIDUAL', 'SIMPLIFIED') NULL;
