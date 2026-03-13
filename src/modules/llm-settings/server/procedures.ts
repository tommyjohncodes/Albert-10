import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/secrets";
import { protectedProcedure, createTRPCRouter } from "@/trpc/init";

const ProviderSchema = z.enum(["openrouter"]);

const SettingsInputSchema = z.object({
  orgId: z.string().min(1, { message: "Org ID is required" }),
  provider: ProviderSchema,
  model: z.string().min(1, { message: "Model is required" }),
  titleModel: z.string().min(1).optional(),
  responseModel: z.string().min(1).optional(),
  openrouterApiKey: z.string().optional(),
});

const getPlatformOrgId = () => {
  const platformOrgId = process.env.PLATFORM_ORG_ID;
  if (!platformOrgId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "PLATFORM_ORG_ID is not configured",
    });
  }
  return platformOrgId;
};

const requirePlatformOrg = (orgId?: string | null) => {
  const platformOrgId = getPlatformOrgId();
  if (!orgId || orgId !== platformOrgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the platform org can manage LLM settings",
    });
  }
};

export const llmSettingsRouter = createTRPCRouter({
  get: protectedProcedure
    .input(
      z
        .object({
          orgId: z.string().min(1).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const targetOrgId = input?.orgId ?? ctx.auth.orgId;

      if (!targetOrgId) {
        return null;
      }

      if (input?.orgId && ctx.auth.orgId !== getPlatformOrgId()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not authorized to view other org settings",
        });
      }

      const settings = await prisma.orgLlmSettings.findUnique({
        where: { orgId: targetOrgId },
      });

      if (!settings) {
        return null;
      }

      return {
        orgId: settings.orgId,
        provider: settings.provider,
        model: settings.model,
        titleModel: settings.titleModel,
        responseModel: settings.responseModel,
        hasOpenRouterKey: Boolean(settings.openrouterApiKey),
        openrouterKeyUpdatedAt: settings.openrouterKeyUpdatedAt,
      };
    }),
  upsert: protectedProcedure
    .input(SettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      requirePlatformOrg(ctx.auth.orgId);

      const keyValue = input.openrouterApiKey?.trim() ?? "";
      let encryptedKey: string | null | undefined = undefined;

      if (input.openrouterApiKey !== undefined) {
        if (!keyValue) {
          encryptedKey = null;
        } else {
          encryptedKey = encryptSecret(keyValue);
        }
      }

      return prisma.orgLlmSettings.upsert({
        where: { orgId: input.orgId },
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
        create: {
          orgId: input.orgId,
          provider: input.provider,
          model: input.model,
          titleModel: input.titleModel,
          responseModel: input.responseModel,
          openrouterApiKey: encryptedKey ?? null,
          openrouterKeyUpdatedAt:
            input.openrouterApiKey !== undefined ? new Date() : null,
        },
      });
    }),
});
