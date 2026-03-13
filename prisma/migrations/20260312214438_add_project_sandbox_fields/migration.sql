-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "sandboxId" TEXT,
ADD COLUMN     "sandboxUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Project_sandboxId_key" ON "Project"("sandboxId");
