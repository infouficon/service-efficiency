-- D79: a SKU can carry its memory (RAM), so Macs are picked as model -> RAM -> capacity -> colour. Additive: one nullable column.
ALTER TABLE `ProductSku` ADD COLUMN `memory` VARCHAR(32) NULL;
