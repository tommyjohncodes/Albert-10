import { getUsageStatus } from "@/lib/usage";
import { getUserUsageMetrics } from "@/lib/user-usage-metrics";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";

export const usageRouter = createTRPCRouter({
  status: protectedProcedure.query(async () => {
    try {
      const result = await getUsageStatus();

      return result;
    } catch {
      return null;
    }
  }),
  metrics: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.auth.userId;
    const { llmCostUsd, sandboxUsage } = await getUserUsageMetrics(userId);
    const sandboxMinutes = sandboxUsage.totals.totalMinutes ?? 0;

    return {
      llmCostUsd,
      sandboxMinutes,
    };
  }),
});
