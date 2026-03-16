-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "agentHistoryLimit" INTEGER,
ADD COLUMN     "agentTimeoutMs" INTEGER,
ADD COLUMN     "contextSummaryMaxChars" INTEGER,
ADD COLUMN     "contextTimeoutMs" INTEGER,
ADD COLUMN     "responseTimeoutMs" INTEGER,
ADD COLUMN     "tokenEfficiencyMode" BOOLEAN NOT NULL DEFAULT false;
