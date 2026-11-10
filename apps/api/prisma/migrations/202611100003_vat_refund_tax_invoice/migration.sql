-- D121: Customer tax document requests (VAT refund and full tax invoice)
ALTER TABLE `CustomerSession`
  ADD COLUMN `vatRefund` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `taxInvoice` BOOLEAN NOT NULL DEFAULT FALSE;
