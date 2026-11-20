-- D153: Widen accessoryName from 64 to 191 chars to support real Apple accessory names with SKUs
ALTER TABLE `SessionAccessory` MODIFY `accessoryName` VARCHAR(191) NOT NULL;
