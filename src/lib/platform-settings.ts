import "server-only";

import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

export const GLOBAL_PLATFORM_SETTINGS_ID = "global";

export async function getPlatformSettings() {
  return prisma.platformSettings.findUnique({
    where: { id: GLOBAL_PLATFORM_SETTINGS_ID },
  });
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
