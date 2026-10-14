-- D70: queue criteria for customer types (ontop, points, burnPoints)
ALTER TABLE `CustomerType`
  ADD COLUMN `ontop` JSON NULL,
  ADD COLUMN `points` JSON NULL,
  ADD COLUMN `burnPoints` JSON NULL;
