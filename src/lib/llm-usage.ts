import "server-only";

import { prisma } from "@/lib/db";

export type LlmUsageInput = {
  userId?: string | null;
  orgId?: string | null;
  provider: string;
  model: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
};

export type UsageTotals = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  lastUsedAt: string | null;
};

export type DailyUsagePoint = {
  label: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type UsageBreakdownPoint = {
  label: string;
  totalTokens: number;
};

export function createEmptyUsageTotals(): UsageTotals {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, lastUsedAt: null };
}

export function addUsageTotals(
  target: UsageTotals,
  promptTokens: number,
  completionTokens: number,
  totalTokens: number,
  createdAt?: Date | null
) {
  target.promptTokens += promptTokens;
  target.completionTokens += completionTokens;
  target.totalTokens += totalTokens;

  if (createdAt) {
    const timestamp = createdAt.toISOString();
    if (!target.lastUsedAt || timestamp > target.lastUsedAt) {
      target.lastUsedAt = timestamp;
    }
  }
}

export function aggregateUsage(
  rows: Array<{
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    createdAt: Date;
  }>,
  options?: { days?: number }
) {
  const totals = createEmptyUsageTotals();
  const dailyMap = new Map<string, DailyUsagePoint>();
  const providerMap = new Map<string, UsageBreakdownPoint>();
  const modelMap = new Map<string, UsageBreakdownPoint>();

  const cutoff = options?.days
    ? new Date(Date.now() - options.days * 24 * 60 * 60 * 1000)
    : null;

  for (const row of rows) {
    const prompt = row.promptTokens ?? 0;
    const completion = row.completionTokens ?? 0;
    const total = row.totalTokens ?? prompt + completion;

    addUsageTotals(totals, prompt, completion, total, row.createdAt);

    if (row.createdAt && (!cutoff || row.createdAt >= cutoff)) {
      const label = row.createdAt.toISOString().slice(0, 10);
      const existing = dailyMap.get(label) || {
        label,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
      existing.promptTokens += prompt;
      existing.completionTokens += completion;
      existing.totalTokens += total;
      dailyMap.set(label, existing);
    }

    const providerKey = row.provider || "Unknown";
    const providerEntry = providerMap.get(providerKey) || { label: providerKey, totalTokens: 0 };
    providerEntry.totalTokens += total;
    providerMap.set(providerKey, providerEntry);

    const modelKey = row.model || "Unknown";
    const modelEntry = modelMap.get(modelKey) || { label: modelKey, totalTokens: 0 };
    modelEntry.totalTokens += total;
    modelMap.set(modelKey, modelEntry);
  }

  const daily = Array.from(dailyMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  const byProvider = Array.from(providerMap.values()).sort((a, b) => b.totalTokens - a.totalTokens);
  const byModel = Array.from(modelMap.values()).sort((a, b) => b.totalTokens - a.totalTokens);

  return { totals, daily, byProvider, byModel };
}

export async function recordLlmUsage(input: LlmUsageInput) {
  const promptTokens = input.promptTokens ?? 0;
  const completionTokens = input.completionTokens ?? 0;
  const totalTokens = input.totalTokens ?? promptTokens + completionTokens;
  const costUsd = input.costUsd ?? 0;

  await prisma.llmUsage.create({
    data: {
      userId: input.userId ?? null,
      orgId: input.orgId ?? null,
      provider: input.provider,
      model: input.model,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
    },
  });
}
