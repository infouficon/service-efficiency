-- D196: Add colorOverride flag to ProductSku to preserve manual color bindings across ERP syncs
ALTER TABLE `ProductSku`
  ADD COLUMN `colorOverride` BOOLEAN NOT NULL DEFAULT false;
