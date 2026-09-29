-- A technical ID avoids deciding the unresolved business uniqueness scope of Branch Code.
ALTER TABLE `Staff` DROP FOREIGN KEY `Staff_branchCode_fkey`;
ALTER TABLE `Branch` ADD COLUMN `id` VARCHAR(36) NULL;
UPDATE `Branch` SET `id` = UUID();
ALTER TABLE `Staff` ADD COLUMN `branchId` VARCHAR(36) NULL;
UPDATE `Staff` JOIN `Branch` ON `Staff`.`branchCode` = `Branch`.`code`
SET `Staff`.`branchId` = `Branch`.`id`;
ALTER TABLE `Staff` DROP COLUMN `branchCode`;
ALTER TABLE `Branch` DROP PRIMARY KEY, MODIFY `id` VARCHAR(36) NOT NULL, ADD PRIMARY KEY (`id`);
ALTER TABLE `Staff` ADD CONSTRAINT `Staff_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
