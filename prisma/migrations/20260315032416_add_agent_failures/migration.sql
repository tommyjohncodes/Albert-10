-- AlterTable
ALTER TABLE "SandboxInstance" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "AgentFailure" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sandboxId" TEXT,
    "errorType" TEXT NOT NULL,
    "errorMessage" TEXT,
    "finishReason" TEXT,
    "lastAssistantMessage" TEXT,
    "summaryFound" BOOLEAN NOT NULL DEFAULT false,
    "filesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentFailure_projectId_createdAt_idx" ON "AgentFailure"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentFailure" ADD CONSTRAINT "AgentFailure_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
