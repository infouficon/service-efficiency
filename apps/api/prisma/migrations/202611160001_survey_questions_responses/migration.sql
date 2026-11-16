-- D140: Configurable survey questions and customer session survey responses (BUY and NOT_BUY cases)

-- AlterTable
ALTER TABLE `SessionEvent` MODIFY `eventType` ENUM(
  'SESSION_CREATED',
  'DEMO_STARTED',
  'DEMO_ENDED',
  'DECISION_MADE',
  'PRODUCT_SELECTION_STARTED',
  'PRODUCT_SELECTION_CONFIRMED',
  'STOCK_SEARCHING',
  'STOCK_FOUND',
  'STOCK_SENT_TO_CASHIER',
  'STOCK_OUT_OF_STOCK',
  'CUSTOMER_CANCELLED',
  'STOCK_REPORTED_MISSING',
  'STAFF_RESOLVED_STOCK_REVIEW',
  'CASHIER_RECEIVED',
  'CASHIER_SCANNED',
  'BILL_OPENED',
  'COMPLETED',
  'CASHIER_REJECTED',
  'STOCK_ACKNOWLEDGED_CANCEL',
  'ITEM_CHANGED',
  'SURVEY_SUBMITTED'
) NOT NULL;

-- CreateTable
CREATE TABLE `SurveyQuestion` (
    `id` VARCHAR(36) NOT NULL,
    `target` ENUM('BUY', 'NOT_BUY') NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `questionType` ENUM('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TEXT') NOT NULL,
    `options` JSON NULL,
    `required` BOOLEAN NOT NULL DEFAULT true,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SurveyQuestion_target_active_sortOrder_idx`(`target`, `active`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SurveyResponse` (
    `id` VARCHAR(36) NOT NULL,
    `sessionId` VARCHAR(36) NOT NULL,
    `target` ENUM('BUY', 'NOT_BUY') NOT NULL,
    `actorStaffId` VARCHAR(64) NOT NULL,
    `answers` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SurveyResponse_sessionId_idx`(`sessionId`),
    INDEX `SurveyResponse_target_createdAt_idx`(`target`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SurveyResponse` ADD CONSTRAINT `SurveyResponse_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `CustomerSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
