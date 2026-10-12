-- F6: the payment methods become a list ADMIN keeps (so new ones need no deploy). Additive: a new table, seeded with the
-- eleven methods the web app has offered so far, in their order.
CREATE TABLE `PaymentMethod` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PaymentMethod_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `PaymentMethod` (`id`, `name`, `active`, `position`, `createdAt`) VALUES
    (UUID(), 'Cash', true, 1, CURRENT_TIMESTAMP(3)),
    (UUID(), 'Transfer', true, 2, CURRENT_TIMESTAMP(3)),
    (UUID(), 'SPayLater', true, 3, CURRENT_TIMESTAMP(3)),
    (UUID(), 'TrueMoney', true, 4, CURRENT_TIMESTAMP(3)),
    (UUID(), 'Full Credit Card', true, 5, CURRENT_TIMESTAMP(3)),
    (UUID(), '0% Credit Card', true, 6, CURRENT_TIMESTAMP(3)),
    (UUID(), 'PayNext', true, 7, CURRENT_TIMESTAMP(3)),
    (UUID(), 'UFund', true, 8, CURRENT_TIMESTAMP(3)),
    (UUID(), 'Ulite', true, 9, CURRENT_TIMESTAMP(3)),
    (UUID(), 'Thisshop', true, 10, CURRENT_TIMESTAMP(3)),
    (UUID(), 'Kashjoy', true, 11, CURRENT_TIMESTAMP(3));
