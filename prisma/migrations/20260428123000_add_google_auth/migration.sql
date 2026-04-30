ALTER TABLE `User`
  MODIFY `passwordHash` VARCHAR(191) NULL,
  ADD COLUMN `googleId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `User_googleId_key` ON `User`(`googleId`);
