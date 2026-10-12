-- F3: a session holds several main products. Additive: a new table; the old single-product columns of CustomerSession stay
-- (the previous release keeps working against this schema) and are only read by the copy below.
CREATE TABLE `SessionItem` (
    `id` VARCHAR(36) NOT NULL,
    `sessionId` VARCHAR(36) NOT NULL,
    `skuId` VARCHAR(36) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `deducted` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SessionItem_sessionId_idx`(`sessionId`),
    INDEX `SessionItem_skuId_idx`(`skuId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SessionItem` ADD CONSTRAINT `SessionItem_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `CustomerSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `SessionItem` ADD CONSTRAINT `SessionItem_skuId_fkey` FOREIGN KEY (`skuId`) REFERENCES `ProductSku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every session that has a main product gets it as one item (quantity 1, as before). `deducted` = the unit FOUND took off the
-- shelf, which only matters while the session is still open at FOUND or later: the figure recorded on its latest STOCK_FOUND
-- event (D59: 0 when "stock unlimited" was on), or one unit when that event has none (as before D59).
INSERT INTO `SessionItem` (`id`, `sessionId`, `skuId`, `quantity`, `deducted`, `createdAt`)
SELECT UUID(), cs.`id`, cs.`skuId`, 1,
       CASE
         WHEN cs.`stockFoundAt` IS NOT NULL AND cs.`outcome` IS NULL AND cs.`state` <> 'COMPLETED'
         THEN COALESCE(
                (SELECT CAST(JSON_UNQUOTE(JSON_EXTRACT(e.`metadata`, '$.deducted')) AS UNSIGNED)
                   FROM `SessionEvent` e
                  WHERE e.`sessionId` = cs.`id` AND e.`eventType` = 'STOCK_FOUND'
                  ORDER BY e.`createdAt` DESC LIMIT 1),
                1)
         ELSE 0
       END,
       cs.`customerWalkInAt`
FROM `CustomerSession` cs
WHERE cs.`skuId` IS NOT NULL;
