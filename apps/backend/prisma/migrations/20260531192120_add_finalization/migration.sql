-- AlterTable
ALTER TABLE "Group" ADD COLUMN "finalItineraryId" TEXT,
ADD COLUMN "finalizedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Group_finalItineraryId_key" ON "Group"("finalItineraryId");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_finalItineraryId_fkey"
  FOREIGN KEY ("finalItineraryId") REFERENCES "Itinerary"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
