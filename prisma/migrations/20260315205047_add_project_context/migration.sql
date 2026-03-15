-- CreateTable
CREATE TABLE "ProjectContext" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectContext_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectContext_projectId_key" ON "ProjectContext"("projectId");

-- CreateIndex
CREATE INDEX "ProjectContext_projectId_idx" ON "ProjectContext"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectContext" ADD CONSTRAINT "ProjectContext_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
