-- D59: global ADMIN switches (the "stock unlimited" switch). Additive: a new table, no row needed (the code default applies).
CREATE TABLE `Setting` (
    `name` VARCHAR(64) NOT NULL,
    `value` VARCHAR(255) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(64) NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
