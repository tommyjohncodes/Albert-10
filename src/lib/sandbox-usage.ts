import { prisma } from "@/lib/db";
import { SANDBOX_TIMEOUT } from "@/inngest/types";

const MS_PER_SECOND = 1000;

const startOfUtcDay = (value: Date) => {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const clampUsageWindowMs = (deltaMs: number) =>
  Math.min(Math.max(deltaMs, 0), SANDBOX_TIMEOUT);

export async function recordSandboxUsage(params: {
  projectId: string;
  userId?: string | null;
  orgId?: string | null;
  lastUpdatedAt?: Date | null;
  now?: Date;
}) {
  try {
    const now = params.now ?? new Date();
    const lastUpdatedAt = params.lastUpdatedAt;

    if (!lastUpdatedAt) return;

    const deltaMs = clampUsageWindowMs(now.getTime() - lastUpdatedAt.getTime());
    const deltaSeconds = Math.floor(deltaMs / MS_PER_SECOND);
    if (deltaSeconds <= 0) return;

    const usageDate = startOfUtcDay(now);

    await prisma.sandboxUsage.upsert({
      where: {
        projectId_date: {
          projectId: params.projectId,
          date: usageDate,
        },
      },
      update: {
        seconds: { increment: deltaSeconds },
        userId: params.userId ?? null,
        orgId: params.orgId ?? null,
      },
      create: {
        projectId: params.projectId,
        date: usageDate,
        seconds: deltaSeconds,
        userId: params.userId ?? null,
        orgId: params.orgId ?? null,
      },
    });
  } catch (error) {
    console.warn("Failed to record sandbox usage", error);
  }
}

export function aggregateSandboxUsage(
  rows: Array<{ seconds: number; updatedAt: Date }>
) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.totalSeconds += row.seconds;
      if (!acc.lastUsedAt || row.updatedAt > acc.lastUsedAt) {
        acc.lastUsedAt = row.updatedAt;
      }
      return acc;
    },
    { totalSeconds: 0, lastUsedAt: null as Date | null }
  );

  return {
    totals: {
      ...totals,
      totalMinutes: totals.totalSeconds / 60,
    },
  };
}
