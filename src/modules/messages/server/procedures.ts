import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { prisma } from "@/lib/db";
import { inngest } from "@/inngest/client";
import { protectedProcedure, createTRPCRouter } from "@/trpc/init";

export const messagesRouter = createTRPCRouter({
  getMany: protectedProcedure
  .input(
      z.object({
        projectId: z.string().min(1, { message: "Project ID is required" }),
      }),
    )
    .query(async ({ input, ctx }) => {
      const messages = await prisma.message.findMany({
        where: {
          projectId: input.projectId,
          project: {
            userId: ctx.auth.userId,
          },
        },
        select: {
          id: true,
          content: true,
          role: true,
          type: true,
          createdAt: true,
          updatedAt: true,
          fragment: {
            select: {
              id: true,
              sandboxUrl: true,
              title: true,
              summary: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
        orderBy: {
          updatedAt: "asc",
        },
      });

      return messages;
    }),
  getFragmentFiles: protectedProcedure
    .input(
      z.object({
        fragmentId: z.string().min(1, { message: "Fragment ID is required" }),
      }),
    )
    .query(async ({ input, ctx }) => {
      const fragment = await prisma.fragment.findFirst({
        where: {
          id: input.fragmentId,
          message: {
            project: {
              userId: ctx.auth.userId,
            },
          },
        },
        select: {
          id: true,
          files: true,
          updatedAt: true,
        },
      });

      if (!fragment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Fragment not found" });
      }

      return fragment;
    }),
  create: protectedProcedure
    .input(
      z.object({
        value: z.string()
          .min(1, { message: "Value is required" })
          .max(10000, { message: "Value is too long" }),
        projectId: z.string().min(1, { message: "Project ID is required" }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existingProject = await prisma.project.findUnique({
        where: {
          id: input.projectId,
          userId: ctx.auth.userId,
        },
      });

      if (!existingProject) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const createdMessage = await prisma.message.create({
        data: {
          projectId: existingProject.id,
          content: input.value,
          role: "USER",
          type: "RESULT",
        },
      });

      await inngest.send({
        name: "code-agent/run",
        data: {
          value: input.value,
          projectId: input.projectId,
          orgId: existingProject.orgId,
          userId: ctx.auth.userId,
          channelKey: ctx.auth.userId,
          threadId: input.projectId,
          userMessage: {
            id: createdMessage.id,
            content: input.value,
            role: "user",
            state: { projectId: input.projectId },
            clientTimestamp: new Date().toISOString(),
          },
        },
      });

      return createdMessage;
    }),
});
