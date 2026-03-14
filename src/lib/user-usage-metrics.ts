import "server-only";

import { prisma } from "@/lib/db";
import { aggregateSandboxUsage } from "@/lib/sandbox-usage";

export async function getUserUsageMetrics(userId: string) {
  const [llmTotals, sandboxRows] = await Promise.all([
    prisma.llmUsage.aggregate({
      where: { userId },
      _sum: { costUsd: true },
    }),
    prisma.sandboxUsage.findMany({
      where: { userId },
      select: { seconds: true, updatedAt: true },
    }),
  ]);

  const llmCostUsd = llmTotals._sum.costUsd ?? 0;
  const sandboxUsage = aggregateSandboxUsage(sandboxRows);

  return {
    llmCostUsd,
    sandboxUsage,
  };
}
