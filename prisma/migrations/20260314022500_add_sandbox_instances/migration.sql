-- Track sandbox allocations durably so per-user concurrency can be enforced.
CREATE TYPE "SandboxState" AS ENUM ('RUNNING', 'TERMINATED', 'FAILED');

CREATE TABLE "SandboxInstance" (
    "id" TEXT NOT NULL,
    "sandboxId" TEXT NOT NULL,
    "sandboxUrl" TEXT,
    "state" "SandboxState" NOT NULL DEFAULT 'RUNNING',
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SandboxInstance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SandboxInstance_sandboxId_key" ON "SandboxInstance"("sandboxId");
CREATE INDEX "SandboxInstance_userId_state_lastActiveAt_idx" ON "SandboxInstance"("userId", "state", "lastActiveAt");
CREATE INDEX "SandboxInstance_projectId_createdAt_idx" ON "SandboxInstance"("projectId", "createdAt");

ALTER TABLE "SandboxInstance"
ADD CONSTRAINT "SandboxInstance_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
