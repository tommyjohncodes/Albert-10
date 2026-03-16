import "server-only";

import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

export const GLOBAL_PLATFORM_SETTINGS_ID = "global";
export const TOKEN_EFFICIENCY_DEFAULTS = {
  enabled: false,
  agentHistoryLimit: 4,
  contextSummaryMaxChars: 900,
  agentTimeoutMs: 240_000,
  responseTimeoutMs: 30_000,
  contextTimeoutMs: 15_000,
};

export async function getPlatformSettings() {
  return prisma.platformSettings.findUnique({
    where: { id: GLOBAL_PLATFORM_SETTINGS_ID },
  });
}

export function resolveTokenEfficiencySettings(
  settings: Awaited<ReturnType<typeof getPlatformSettings>> | null
) {
  return {
    enabled: settings?.tokenEfficiencyMode ?? TOKEN_EFFICIENCY_DEFAULTS.enabled,
    agentHistoryLimit:
      settings?.agentHistoryLimit ?? TOKEN_EFFICIENCY_DEFAULTS.agentHistoryLimit,
    contextSummaryMaxChars:
      settings?.contextSummaryMaxChars ??
      TOKEN_EFFICIENCY_DEFAULTS.contextSummaryMaxChars,
    agentTimeoutMs:
      settings?.agentTimeoutMs ?? TOKEN_EFFICIENCY_DEFAULTS.agentTimeoutMs,
    responseTimeoutMs:
      settings?.responseTimeoutMs ?? TOKEN_EFFICIENCY_DEFAULTS.responseTimeoutMs,
    contextTimeoutMs:
      settings?.contextTimeoutMs ?? TOKEN_EFFICIENCY_DEFAULTS.contextTimeoutMs,
  };
}

export async function getPlatformVercelToken(): Promise<string | null> {
  const settings = await getPlatformSettings();

  if (!settings?.vercelAccessToken) {
    return null;
  }

  try {
    return decryptSecret(settings.vercelAccessToken);
  } catch {
    return null;
  }
}

export async function upsertPlatformVercelToken(options: {
  token: string | null;
  updatedByUserId?: string | null;
}) {
  const normalizedToken = options.token?.trim() || "";
  const encryptedToken = normalizedToken.length > 0 ? encryptSecret(normalizedToken) : null;
  const now = new Date();

  return prisma.platformSettings.upsert({
    where: { id: GLOBAL_PLATFORM_SETTINGS_ID },
    create: {
      id: GLOBAL_PLATFORM_SETTINGS_ID,
      vercelAccessToken: encryptedToken,
      vercelTokenUpdatedAt: now,
      updatedByUserId: options.updatedByUserId ?? null,
      updatedAt: now,
    },
    update: {
      vercelAccessToken: encryptedToken,
      vercelTokenUpdatedAt: now,
      updatedByUserId: options.updatedByUserId ?? null,
      updatedAt: now,
    },
  });
}

export async function upsertTokenEfficiencySettings(options: {
  enabled: boolean;
  agentHistoryLimit: number;
  contextSummaryMaxChars: number;
  agentTimeoutMs: number;
  responseTimeoutMs: number;
  contextTimeoutMs: number;
  updatedByUserId?: string | null;
}) {
  const now = new Date();

  return prisma.platformSettings.upsert({
    where: { id: GLOBAL_PLATFORM_SETTINGS_ID },
    create: {
      id: GLOBAL_PLATFORM_SETTINGS_ID,
      tokenEfficiencyMode: options.enabled,
      agentHistoryLimit: options.agentHistoryLimit,
      contextSummaryMaxChars: options.contextSummaryMaxChars,
      agentTimeoutMs: options.agentTimeoutMs,
      responseTimeoutMs: options.responseTimeoutMs,
      contextTimeoutMs: options.contextTimeoutMs,
      updatedByUserId: options.updatedByUserId ?? null,
      updatedAt: now,
    },
    update: {
      tokenEfficiencyMode: options.enabled,
      agentHistoryLimit: options.agentHistoryLimit,
      contextSummaryMaxChars: options.contextSummaryMaxChars,
      agentTimeoutMs: options.agentTimeoutMs,
      responseTimeoutMs: options.responseTimeoutMs,
      contextTimeoutMs: options.contextTimeoutMs,
      updatedByUserId: options.updatedByUserId ?? null,
      updatedAt: now,
    },
  });
}
