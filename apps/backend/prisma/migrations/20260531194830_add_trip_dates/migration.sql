-- AlterTable: add startDate and endDate to Group
ALTER TABLE "Group"
  ADD COLUMN "startDate" TIMESTAMP(3),
  ADD COLUMN "endDate"   TIMESTAMP(3);
