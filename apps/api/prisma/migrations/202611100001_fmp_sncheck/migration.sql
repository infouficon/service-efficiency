-- D119: the per-serial check the FileMaker `ses` script v3.3 returns ("snCheck"), kept on the message it answered
ALTER TABLE `FmpOutbox` ADD COLUMN `snCheck` JSON NULL;
