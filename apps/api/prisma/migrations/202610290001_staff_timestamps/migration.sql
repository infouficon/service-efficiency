-- D86: the staff export shows when an account was made, last changed and last signed in. Additive: three columns; existing rows
-- get the migration time for createdAt / updatedAt (their real history was never kept) and no last sign-in.
ALTER TABLE `Staff` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `lastLoginAt` DATETIME(3) NULL;
