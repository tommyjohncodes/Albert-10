import { z } from "zod";
import { generateSlug } from "random-word-slugs";

import { prisma } from "@/lib/db";
import { terminateProjectSandboxes } from "@/lib/sandbox-instance";
import { TRPCError } from "@trpc/server";
import { inngest } from "@/inngest/client";
import { protectedProcedure, createTRPCRouter } from "@/trpc/init";
import { getClerkClient } from "@/lib/clerk-server";

const resolveOrgIdForUser = async (
  userId: string,
  currentOrgId?: string | null
) => {
  if (currentOrgId) return currentOrgId;

  const client = getClerkClient();
  if (!client) return null;

  const memberships = await client.users.getOrganizationMembershipList({
    userId,
    limit: 2,
  });

  if (memberships.data.length === 1) {
    return memberships.data[0]?.organization?.id ?? null;
  }

  return null;
};

export const projectsRouter = createTRPCRouter({
  getOne: protectedProcedure
    .input(z.object({
      id: z.string().min(1, { message: "Id is required" }),
    }))
    .query(async ({ input, ctx }) => {
      const existingProject = await prisma.project.findUnique({
        where: {
          id: input.id,
          userId: ctx.auth.userId,
        },
        select: {
          id: true,
          name: true,
          userId: true,
          orgId: true,
          sandboxId: true,
          sandboxUpdatedAt: true,
          createdAt: true,
          updatedAt: true,
          messages: {
            where: {
              role: "ASSISTANT",
              fragment: { isNot: null },
            },
            orderBy: {
              createdAt: "asc",
            },
            take: 1,
            select: {
              fragment: {
                select: {
                  title: true,
                },
              },
            },
          },
        },
      });

      if (!existingProject) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const displayTitle =
        existingProject.messages[0]?.fragment?.title ?? existingProject.name;

      const { messages, ...project } = existingProject;
      void messages;

      return {
        ...project,
        displayTitle,
      };
    }),
  getMany: protectedProcedure
    .query(async ({ ctx }) => {
      const projects = await prisma.project.findMany({
        where: {
          userId: ctx.auth.userId,
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          id: true,
          name: true,
          userId: true,
          orgId: true,
          sandboxId: true,
          sandboxUpdatedAt: true,
          createdAt: true,
          updatedAt: true,
          messages: {
            where: {
              role: "ASSISTANT",
              fragment: { isNot: null },
            },
            orderBy: {
              createdAt: "asc",
            },
            take: 1,
            select: {
              fragment: {
                select: {
                  title: true,
                },
              },
            },
          },
        },
      });

      return projects.map((project) => {
        const displayTitle =
          project.messages[0]?.fragment?.title ?? project.name;
        const { messages, ...rest } = project;
        void messages;
        return { ...rest, displayTitle };
      });
    }),
  getSidebarList: protectedProcedure
    .query(async ({ ctx }) => {
      const projects = await prisma.project.findMany({
        where: {
          userId: ctx.auth.userId,
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          id: true,
          name: true,
          updatedAt: true,
          messages: {
            where: {
              role: "ASSISTANT",
              fragment: { isNot: null },
            },
            orderBy: {
              createdAt: "asc",
            },
            take: 1,
            select: {
              fragment: {
                select: {
                  title: true,
                },
              },
            },
          },
        },
      });

      return projects.map((project) => ({
        id: project.id,
        updatedAt: project.updatedAt,
        title: project.messages[0]?.fragment?.title ?? project.name,
      }));
    }),
  create: protectedProcedure
    .input(
      z.object({
        value: z.string()
          .min(1, { message: "Value is required" })
          .max(10000, { message: "Value is too long" })
      }),
    )
    .mutation(async ({ input, ctx }) => {
      let orgId: string | null = null;
      try {
        orgId = await resolveOrgIdForUser(
          ctx.auth.userId,
          ctx.auth.orgId ?? null
        );
      } catch (error) {
        console.error("[projects.create] Failed to resolve org ID", error);
      }

      const createdProject = await prisma.project.create({
        data: {
          userId: ctx.auth.userId,
          orgId,
          name: generateSlug(2, {
            format: "kebab",
          }),
          messages: {
            create: {
              content: input.value,
              role: "USER",
              type: "RESULT",
            }
          }
        }
      });

      try {
        await inngest.send({
          name: "code-agent/run",
          data: {
            value: input.value,
            projectId: createdProject.id,
            orgId: createdProject.orgId,
            userId: ctx.auth.userId,
          },
        });
      } catch (error) {
        console.error("[projects.create] Failed to enqueue code agent run", error);
        await prisma.message.create({
          data: {
            projectId: createdProject.id,
            content:
              "I couldn't start the coding task because the background worker is unavailable. Please make sure the Inngest dev server is running, then try again.",
            role: "ASSISTANT",
            type: "ERROR",
          },
        });
      }

      return createdProject;
    }),
  delete: protectedProcedure
    .input(z.object({
      id: z.string().min(1, { message: "Id is required" }),
    }))
    .mutation(async ({ input, ctx }) => {
      const existingProject = await prisma.project.findFirst({
        where: {
          id: input.id,
          userId: ctx.auth.userId,
        },
        select: { id: true },
      });

      if (!existingProject) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      await terminateProjectSandboxes(input.id);

      await prisma.project.delete({
        where: { id: input.id },
      });

      return { id: input.id };
    }),
});
