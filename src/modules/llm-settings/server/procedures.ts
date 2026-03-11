import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { prisma } from "@/lib/db";
import { protectedProcedure, createTRPCRouter } from "@/trpc/init";

const ProviderSchema = z.enum(["openai", "openrouter"]);

const SettingsInputSchema = z.object({
  orgId: z.string().min(1, { message: "Org ID is required" }),
  provider: ProviderSchema,
  model: z.string().min(1, { message: "Model is required" }),
  titleModel: z.string().min(1).optional(),
  responseModel: z.string().min(1).optional(),
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

      return prisma.orgLlmSettings.findUnique({
        where: { orgId: targetOrgId },
      });
    }),
  upsert: protectedProcedure
    .input(SettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      requirePlatformOrg(ctx.auth.orgId);

      return prisma.orgLlmSettings.upsert({
        where: { orgId: input.orgId },
        update: {
          provider: input.provider,
          model: input.model,
          titleModel: input.titleModel,
          responseModel: input.responseModel,
        },
        create: {
          orgId: input.orgId,
          provider: input.provider,
          model: input.model,
          titleModel: input.titleModel,
          responseModel: input.responseModel,
        },
      });
    }),
});
