import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createClerkClient } from "@clerk/nextjs/server";

import { prisma } from "@/lib/db";

function getClerkClient() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required for admin Clerk Backend API");
  }
  return createClerkClient({ secretKey });
}
import { aggregateUsage } from "@/lib/llm-usage";
import { decryptSecret, encryptSecret, hasEncryptionKey } from "@/lib/secrets";
import { getPlatformSettings, upsertPlatformVercelToken } from "@/lib/platform-settings";
import { adminProcedure, createTRPCRouter } from "@/trpc/init";

const ProviderSchema = z.enum(["openrouter"]);

const OrgSettingsInputSchema = z.object({
  orgId: z.string().min(1),
  provider: ProviderSchema,
  model: z.string().min(1),
  titleModel: z.string().min(1).optional(),
  responseModel: z.string().min(1).optional(),
  openrouterApiKey: z.string().optional(),
});

const VercelTokenInputSchema = z.object({
  token: z.string().optional(),
});

const ListInputSchema = z
  .object({
    limit: z.number().min(1).max(100).optional(),
    offset: z.number().min(0).optional(),
  })
  .optional();

function getDisplayName(params: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}) {
  const name = [params.firstName, params.lastName].filter(Boolean).join(" ").trim();
  return name || params.email || "Unknown";
}

export const adminRouter = createTRPCRouter({
  listOpenRouterModels: adminProcedure.query(async () => {
    const baseUrl =
      process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/";
    const modelsUrl = new URL("models", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (process.env.OPENROUTER_API_KEY) {
      headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
    }
    if (process.env.OPENROUTER_REFERRER) {
      headers["HTTP-Referer"] = process.env.OPENROUTER_REFERRER;
    }
    if (process.env.OPENROUTER_TITLE) {
      headers["X-Title"] = process.env.OPENROUTER_TITLE;
    }

    const response = await fetch(modelsUrl.toString(), {
      headers,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: "Failed to fetch OpenRouter models",
      });
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: string; name?: string | null }>;
    };

    const models = Array.isArray(payload.data) ? payload.data : [];
    const normalized = models
      .filter((model) => typeof model.id === "string" && model.id.length > 0)
      .map((model) => ({
        id: model.id as string,
        name: model.name ?? model.id ?? "",
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    return {
      models: normalized,
    };
  }),
  amIAdmin: adminProcedure.query(() => ({ isAdmin: true })),

  listOrganizations: adminProcedure
    .input(ListInputSchema)
    .query(async ({ input }) => {
      const client = getClerkClient();
      const organizationsResponse = await client.organizations.getOrganizationList({
        limit: input?.limit ?? 100,
        offset: input?.offset ?? 0,
        includeMembersCount: true,
      });

      const orgIds = organizationsResponse.data.map((org) => org.id);
      const [settings, usageRows] = await Promise.all([
        prisma.orgLlmSettings.findMany({
          where: {
            orgId: {
              in: orgIds,
            },
          },
        }),
        prisma.llmUsage.findMany({
          where: {
            orgId: {
              in: orgIds,
            },
          },
        }),
      ]);

      const settingsMap = new Map(settings.map((item) => [item.orgId, item]));
      const usageByOrg = new Map<string, ReturnType<typeof aggregateUsage>>();
      for (const orgId of orgIds) {
        const rows = usageRows.filter((row) => row.orgId === orgId);
        usageByOrg.set(
          orgId,
          aggregateUsage(
            rows.map((row) => ({
              provider: row.provider,
              model: row.model,
              promptTokens: row.promptTokens,
              completionTokens: row.completionTokens,
              totalTokens: row.totalTokens,
              createdAt: row.createdAt,
            }))
          )
        );
      }

      return organizationsResponse.data.map((org) => {
        const setting = settingsMap.get(org.id);
        const usage = usageByOrg.get(org.id);

        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          membersCount: org.membersCount ?? 0,
          provider: setting?.provider ?? null,
          model: setting?.model ?? null,
          hasOpenRouterKey: Boolean(setting?.openrouterApiKey),
          usage: usage?.totals ?? {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            lastUsedAt: null,
          },
        };
      });
    }),

  getOrganization: adminProcedure
    .input(
      z.object({
        orgId: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      const client = getClerkClient();
      const [organization, settings, memberships, usageRows] = await Promise.all([
        client.organizations.getOrganization({ organizationId: input.orgId, includeMembersCount: true }),
        prisma.orgLlmSettings.findUnique({
          where: { orgId: input.orgId },
        }),
        client.organizations.getOrganizationMembershipList({
          organizationId: input.orgId,
          limit: 100,
          offset: 0,
        }),
        prisma.llmUsage.findMany({
          where: { orgId: input.orgId },
        }),
      ]);

      const usage = aggregateUsage(
        usageRows.map((row) => ({
          provider: row.provider,
          model: row.model,
          promptTokens: row.promptTokens,
          completionTokens: row.completionTokens,
          totalTokens: row.totalTokens,
          createdAt: row.createdAt,
        })),
        { days: 30 }
      );

      return {
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          membersCount: organization.membersCount ?? 0,
        },
        settings: {
          provider: settings?.provider ?? "openrouter",
          model: settings?.model ?? "",
          titleModel: settings?.titleModel ?? "",
          responseModel: settings?.responseModel ?? "",
          hasOpenRouterKey: Boolean(settings?.openrouterApiKey),
          openrouterKeyUpdatedAt: settings?.openrouterKeyUpdatedAt?.toISOString() ?? null,
        },
        members: memberships.data.map((membership) => ({
          id: membership.publicUserData?.userId ?? "",
          firstName: membership.publicUserData?.firstName ?? null,
          lastName: membership.publicUserData?.lastName ?? null,
          identifier: membership.publicUserData?.identifier ?? null,
          role: membership.role,
        })),
        usage,
      };
    }),

  updateOrgSettings: adminProcedure
    .input(OrgSettingsInputSchema)
    .mutation(async ({ input }) => {
      const keyValue = input.openrouterApiKey?.trim() ?? "";
      let encryptedKey: string | null | undefined = undefined;

      if (input.openrouterApiKey !== undefined) {
        if (!keyValue) {
          encryptedKey = null;
        } else {
          encryptedKey = encryptSecret(keyValue);
        }
      }

      const updated = await prisma.orgLlmSettings.upsert({
        where: { orgId: input.orgId },
        create: {
          orgId: input.orgId,
          provider: input.provider,
          model: input.model,
          titleModel: input.titleModel,
          responseModel: input.responseModel,
          openrouterApiKey: encryptedKey ?? null,
          openrouterKeyUpdatedAt: input.openrouterApiKey !== undefined ? new Date() : null,
        },
        update: {
          provider: input.provider,
          model: input.model,
          titleModel: input.titleModel,
          responseModel: input.responseModel,
          ...(input.openrouterApiKey !== undefined
            ? {
                openrouterApiKey: encryptedKey,
                openrouterKeyUpdatedAt: new Date(),
              }
            : {}),
        },
      });

      return {
        orgId: updated.orgId,
        provider: updated.provider,
        model: updated.model,
        titleModel: updated.titleModel,
        responseModel: updated.responseModel,
        hasOpenRouterKey: Boolean(updated.openrouterApiKey),
      };
    }),

  listUsers: adminProcedure
    .input(ListInputSchema)
    .query(async ({ input }) => {
      const client = getClerkClient();
      const usersResponse = await client.users.getUserList({
        limit: input?.limit ?? 100,
        offset: input?.offset ?? 0,
      });

      const userIds = usersResponse.data.map((user) => user.id);
      const usageRows = await prisma.llmUsage.findMany({
        where: {
          userId: {
            in: userIds,
          },
        },
      });

      const usageByUser = new Map<string, ReturnType<typeof aggregateUsage>>();
      for (const userId of userIds) {
        const rows = usageRows.filter((row) => row.userId === userId);
        usageByUser.set(
          userId,
          aggregateUsage(
            rows.map((row) => ({
              provider: row.provider,
              model: row.model,
              promptTokens: row.promptTokens,
              completionTokens: row.completionTokens,
              totalTokens: row.totalTokens,
              createdAt: row.createdAt,
            }))
          )
        );
      }

      return usersResponse.data.map((user) => {
        const primaryEmail = user.primaryEmailAddress?.emailAddress ?? null;
        const usage = usageByUser.get(user.id);

        return {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: primaryEmail,
          name: getDisplayName({
            firstName: user.firstName,
            lastName: user.lastName,
            email: primaryEmail,
          }),
          usage: usage?.totals ?? {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            lastUsedAt: null,
          },
        };
      });
    }),

  getUser: adminProcedure
    .input(
      z.object({
        userId: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      const client = getClerkClient();
      const [user, membershipsResponse, usageRows] = await Promise.all([
        client.users.getUser(input.userId),
        client.users.getOrganizationMembershipList({
          userId: input.userId,
          limit: 100,
          offset: 0,
        }),
        prisma.llmUsage.findMany({
          where: {
            userId: input.userId,
          },
        }),
      ]);

      const usage = aggregateUsage(
        usageRows.map((row) => ({
          provider: row.provider,
          model: row.model,
          promptTokens: row.promptTokens,
          completionTokens: row.completionTokens,
          totalTokens: row.totalTokens,
          createdAt: row.createdAt,
        })),
        { days: 30 }
      );

      return {
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.primaryEmailAddress?.emailAddress ?? null,
        },
        memberships: membershipsResponse.data.map((membership) => ({
          organizationId: membership.organization.id,
          organizationName: membership.organization.name,
          role: membership.role,
        })),
        usage,
      };
    }),

  getPlatformSettings: adminProcedure.query(async () => {
    const settings = await getPlatformSettings();

    let hasToken = false;
    if (settings?.vercelAccessToken) {
      try {
        hasToken = Boolean(decryptSecret(settings.vercelAccessToken));
      } catch {
        hasToken = false;
      }
    }

    return {
      hasToken,
      tokenUpdatedAt: settings?.vercelTokenUpdatedAt?.toISOString() ?? null,
      encryptionReady: hasEncryptionKey(),
    };
  }),

  upsertVercelToken: adminProcedure
    .input(VercelTokenInputSchema)
    .mutation(async ({ ctx, input }) => {
      const token = input.token?.trim() ?? "";

      await upsertPlatformVercelToken({
        token,
        updatedByUserId: ctx.auth.userId,
      });

      return {
        success: true,
      };
    }),
});
