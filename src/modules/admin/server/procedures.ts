import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/lib/db";
import { SandboxState } from "@/generated/prisma";
import { getClerkClient } from "@/lib/clerk-server";
import { getActiveSandboxCutoff } from "@/lib/sandbox-activity";

import { aggregateUsage } from "@/lib/llm-usage";
import { aggregateSandboxUsage } from "@/lib/sandbox-usage";
import { getUserUsageMetrics } from "@/lib/user-usage-metrics";
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

const activeSandboxSelect = {
  sandboxId: true,
  sandboxUrl: true,
  lastActiveAt: true,
  createdAt: true,
  projectId: true,
  project: {
    select: {
      name: true,
    },
  },
} as const;

const agentFailureSelect = {
  id: true,
  errorType: true,
  errorMessage: true,
  finishReason: true,
  summaryFound: true,
  filesCount: true,
  createdAt: true,
  project: {
    select: {
      id: true,
      name: true,
      userId: true,
      orgId: true,
    },
  },
} as const;

function serializeAgentFailures(
  rows: Array<{
    id: string;
    errorType: string;
    errorMessage: string | null;
    finishReason: string | null;
    summaryFound: boolean;
    filesCount: number;
    createdAt: Date;
    project: {
      id: string;
      name: string;
      userId: string;
      orgId: string | null;
    };
  }>,
) {
  return rows.map((row) => ({
    id: row.id,
    errorType: row.errorType,
    errorMessage: row.errorMessage,
    finishReason: row.finishReason,
    summaryFound: row.summaryFound,
    filesCount: row.filesCount,
    createdAt: row.createdAt.toISOString(),
    project: {
      id: row.project.id,
      name: row.project.name,
      userId: row.project.userId,
      orgId: row.project.orgId,
    },
  }));
}

async function getFallbackOrgIds() {
  const [projectOrgIds, usageOrgIds, sandboxUsageOrgIds, sandboxInstanceOrgIds] =
    await Promise.all([
      prisma.project.findMany({
        where: { orgId: { not: null } },
        distinct: ["orgId"],
        select: { orgId: true },
      }),
      prisma.llmUsage.findMany({
        where: { orgId: { not: null } },
        distinct: ["orgId"],
        select: { orgId: true },
      }),
      prisma.sandboxUsage.findMany({
        where: { orgId: { not: null } },
        distinct: ["orgId"],
        select: { orgId: true },
      }),
      prisma.sandboxInstance.findMany({
        where: { orgId: { not: null } },
        distinct: ["orgId"],
        select: { orgId: true },
      }),
    ]);

  const orgIds = new Set<string>();
  for (const row of [
    ...projectOrgIds,
    ...usageOrgIds,
    ...sandboxUsageOrgIds,
    ...sandboxInstanceOrgIds,
  ]) {
    if (row.orgId) {
      orgIds.add(row.orgId);
    }
  }

  return Array.from(orgIds);
}

async function getFallbackUserIds() {
  const [projectUserIds, usageUserIds, sandboxUsageUserIds, sandboxInstanceUserIds] =
    await Promise.all([
      prisma.project.findMany({
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.llmUsage.findMany({
        where: { userId: { not: null } },
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.sandboxUsage.findMany({
        where: { userId: { not: null } },
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.sandboxInstance.findMany({
        distinct: ["userId"],
        select: { userId: true },
      }),
    ]);

  const userIds = new Set<string>();
  for (const row of [
    ...projectUserIds,
    ...usageUserIds,
    ...sandboxUsageUserIds,
    ...sandboxInstanceUserIds,
  ]) {
    if (row.userId) {
      userIds.add(row.userId);
    }
  }

  return Array.from(userIds);
}

function serializeActiveSandboxes(
  rows: Array<{
    sandboxId: string;
    sandboxUrl: string | null;
    lastActiveAt: Date;
    createdAt: Date;
    projectId: string;
    project: {
      name: string;
    };
  }>,
) {
  return rows.map((row) => ({
    sandboxId: row.sandboxId,
    sandboxUrl: row.sandboxUrl,
    projectId: row.projectId,
    projectName: row.project.name,
    lastActiveAt: row.lastActiveAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
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
      let organizations: Array<{
        id: string;
        name: string;
        slug: string | null;
        membersCount: number;
      }> = [];

      try {
        const client = getClerkClient();
        const organizationsResponse = await client.organizations.getOrganizationList({
          limit: input?.limit ?? 100,
          offset: input?.offset ?? 0,
          includeMembersCount: true,
        });

        organizations = organizationsResponse.data.map((org) => ({
          id: org.id,
          name: org.name,
          slug: org.slug ?? null,
          membersCount: org.membersCount ?? 0,
        }));
      } catch {
        const fallbackOrgIds = await getFallbackOrgIds();
        const offset = input?.offset ?? 0;
        const limit = input?.limit ?? fallbackOrgIds.length;
        const pagedOrgIds = fallbackOrgIds.slice(offset, offset + limit);

        organizations = pagedOrgIds.map((orgId) => ({
          id: orgId,
          name: orgId,
          slug: null,
          membersCount: 0,
        }));
      }

      const orgIds = organizations.map((org) => org.id);
      const activeCutoff = getActiveSandboxCutoff();
      const [settings, usageRows, sandboxUsageRows, activeSandboxRows] = await Promise.all([
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
        prisma.sandboxUsage.findMany({
          where: {
            orgId: {
              in: orgIds,
            },
          },
        }),
        prisma.sandboxInstance.findMany({
          where: {
            orgId: {
              in: orgIds,
            },
            state: SandboxState.RUNNING,
            lastActiveAt: {
              gte: activeCutoff,
            },
          },
          select: {
            orgId: true,
          },
        }),
      ]);

      const settingsMap = new Map(settings.map((item) => [item.orgId, item]));
      const usageByOrg = new Map<string, ReturnType<typeof aggregateUsage>>();
      const sandboxUsageByOrg = new Map<string, ReturnType<typeof aggregateSandboxUsage>>();
      const activeSandboxCountByOrg = new Map<string, number>();

      for (const row of activeSandboxRows) {
        if (!row.orgId) continue;
        activeSandboxCountByOrg.set(
          row.orgId,
          (activeSandboxCountByOrg.get(row.orgId) ?? 0) + 1,
        );
      }

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

        const sandboxRows = sandboxUsageRows.filter((row) => row.orgId === orgId);
        sandboxUsageByOrg.set(orgId, aggregateSandboxUsage(sandboxRows));
      }

      return organizations.map((org) => {
        const setting = settingsMap.get(org.id);
        const usage = usageByOrg.get(org.id);
        const sandboxUsage = sandboxUsageByOrg.get(org.id);

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
          sandboxUsage: sandboxUsage?.totals ?? {
            totalSeconds: 0,
            totalMinutes: 0,
            lastUsedAt: null,
          },
          activeSandboxes: activeSandboxCountByOrg.get(org.id) ?? 0,
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
      const activeCutoff = getActiveSandboxCutoff();
      const agentFailureClient = (
        prisma as unknown as { agentFailure?: { findMany: Function } }
      ).agentFailure;
      const agentFailureQuery = agentFailureClient?.findMany
        ? agentFailureClient.findMany({
            where: {
              project: {
                orgId: input.orgId,
              },
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 20,
            select: agentFailureSelect,
          })
        : Promise.resolve([]);
      const [settings, usageRows, sandboxUsageRows, activeSandboxRows, agentFailureRows] = await Promise.all([
        prisma.orgLlmSettings.findUnique({
          where: { orgId: input.orgId },
        }),
        prisma.llmUsage.findMany({
          where: { orgId: input.orgId },
        }),
        prisma.sandboxUsage.findMany({
          where: { orgId: input.orgId },
        }),
        prisma.sandboxInstance.findMany({
          where: {
            orgId: input.orgId,
            state: SandboxState.RUNNING,
            lastActiveAt: {
              gte: activeCutoff,
            },
          },
          orderBy: [
            { lastActiveAt: "desc" },
            { createdAt: "desc" },
          ],
          select: activeSandboxSelect,
        }),
        agentFailureQuery,
      ]);

      let organization = {
        id: input.orgId,
        name: input.orgId,
        slug: null as string | null,
        membersCount: 0,
      };
      let members: Array<{
        id: string;
        firstName: string | null;
        lastName: string | null;
        identifier: string | null;
        role: string;
      }> = [];

      try {
        const client = getClerkClient();
        const [organizationResponse, memberships] = await Promise.all([
          client.organizations.getOrganization({
            organizationId: input.orgId,
            includeMembersCount: true,
          }),
          client.organizations.getOrganizationMembershipList({
            organizationId: input.orgId,
            limit: 100,
            offset: 0,
          }),
        ]);

        organization = {
          id: organizationResponse.id,
          name: organizationResponse.name,
          slug: organizationResponse.slug ?? null,
          membersCount: organizationResponse.membersCount ?? 0,
        };
        members = memberships.data.map((membership) => ({
          id: membership.publicUserData?.userId ?? "",
          firstName: membership.publicUserData?.firstName ?? null,
          lastName: membership.publicUserData?.lastName ?? null,
          identifier: membership.publicUserData?.identifier ?? null,
          role: membership.role,
        }));
      } catch {
        members = [];
      }

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
      const sandboxUsage = aggregateSandboxUsage(sandboxUsageRows);
      const safeAgentFailures = Array.isArray(agentFailureRows)
        ? agentFailureRows
        : [];

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
        members,
        usage,
        sandboxUsage,
        activeSandboxes: serializeActiveSandboxes(activeSandboxRows),
        agentFailures: serializeAgentFailures(
          safeAgentFailures as Parameters<typeof serializeAgentFailures>[0]
        ),
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
      let users: Array<{
        id: string;
        firstName: string | null;
        lastName: string | null;
        email: string | null;
      }> = [];

      try {
        const client = getClerkClient();
        const usersResponse = await client.users.getUserList({
          limit: input?.limit ?? 100,
          offset: input?.offset ?? 0,
        });

        users = usersResponse.data.map((user) => ({
          id: user.id,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          email: user.primaryEmailAddress?.emailAddress ?? null,
        }));
      } catch {
        const fallbackUserIds = await getFallbackUserIds();
        const offset = input?.offset ?? 0;
        const limit = input?.limit ?? fallbackUserIds.length;
        const pagedUserIds = fallbackUserIds.slice(offset, offset + limit);

        users = pagedUserIds.map((userId) => ({
          id: userId,
          firstName: null,
          lastName: null,
          email: null,
        }));
      }

      const userIds = users.map((user) => user.id);
      const activeCutoff = getActiveSandboxCutoff();
      const [usageRows, sandboxUsageRows, activeSandboxRows] = await Promise.all([
        prisma.llmUsage.findMany({
          where: {
            userId: {
              in: userIds,
            },
          },
        }),
        prisma.sandboxUsage.findMany({
          where: {
            userId: {
              in: userIds,
            },
          },
        }),
        prisma.sandboxInstance.findMany({
          where: {
            userId: {
              in: userIds,
            },
            state: SandboxState.RUNNING,
            lastActiveAt: {
              gte: activeCutoff,
            },
          },
          select: {
            userId: true,
          },
        }),
      ]);

      const usageByUser = new Map<string, ReturnType<typeof aggregateUsage>>();
      const sandboxUsageByUser = new Map<string, ReturnType<typeof aggregateSandboxUsage>>();
      const activeSandboxCountByUser = new Map<string, number>();

      for (const row of activeSandboxRows) {
        activeSandboxCountByUser.set(
          row.userId,
          (activeSandboxCountByUser.get(row.userId) ?? 0) + 1,
        );
      }

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

        const sandboxRows = sandboxUsageRows.filter((row) => row.userId === userId);
        sandboxUsageByUser.set(userId, aggregateSandboxUsage(sandboxRows));
      }

      return users.map((user) => {
        const usage = usageByUser.get(user.id);
        const sandboxUsage = sandboxUsageByUser.get(user.id);

        return {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          name: getDisplayName({
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
          }),
          usage: usage?.totals ?? {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            lastUsedAt: null,
          },
          sandboxUsage: sandboxUsage?.totals ?? {
            totalSeconds: 0,
            totalMinutes: 0,
            lastUsedAt: null,
          },
          activeSandboxes: activeSandboxCountByUser.get(user.id) ?? 0,
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
      const activeCutoff = getActiveSandboxCutoff();
      const agentFailureClient = (
        prisma as unknown as { agentFailure?: { findMany: Function } }
      ).agentFailure;
      const agentFailureQuery = agentFailureClient?.findMany
        ? agentFailureClient.findMany({
            where: {
              project: {
                userId: input.userId,
              },
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 20,
            select: agentFailureSelect,
          })
        : Promise.resolve([]);
      const [usageRows, activeSandboxRows, agentFailureRows] = await Promise.all([
        prisma.llmUsage.findMany({
          where: {
            userId: input.userId,
          },
        }),
        prisma.sandboxInstance.findMany({
          where: {
            userId: input.userId,
            state: SandboxState.RUNNING,
            lastActiveAt: {
              gte: activeCutoff,
            },
          },
          orderBy: [
            { lastActiveAt: "desc" },
            { createdAt: "desc" },
          ],
          select: activeSandboxSelect,
        }),
        agentFailureQuery,
      ]);

      let user = {
        id: input.userId,
        firstName: null as string | null,
        lastName: null as string | null,
        email: null as string | null,
      };
      let memberships: Array<{
        organizationId: string;
        organizationName: string;
        role: string;
      }> = [];

      try {
        const client = getClerkClient();
        const [userResponse, membershipsResponse] = await Promise.all([
          client.users.getUser(input.userId),
          client.users.getOrganizationMembershipList({
            userId: input.userId,
            limit: 100,
            offset: 0,
          }),
        ]);

        user = {
          id: userResponse.id,
          firstName: userResponse.firstName ?? null,
          lastName: userResponse.lastName ?? null,
          email: userResponse.primaryEmailAddress?.emailAddress ?? null,
        };
        memberships = membershipsResponse.data.map((membership) => ({
          organizationId: membership.organization.id,
          organizationName: membership.organization.name,
          role: membership.role,
        }));
      } catch {
        memberships = [];
      }

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
      const { sandboxUsage } = await getUserUsageMetrics(input.userId);
      const safeAgentFailures = Array.isArray(agentFailureRows)
        ? agentFailureRows
        : [];

      return {
        user,
        memberships,
        usage,
        sandboxUsage,
        activeSandboxes: serializeActiveSandboxes(activeSandboxRows),
        agentFailures: serializeAgentFailures(
          safeAgentFailures as Parameters<typeof serializeAgentFailures>[0]
        ),
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
