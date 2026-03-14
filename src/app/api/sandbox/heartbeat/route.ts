import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { Sandbox } from "@e2b/code-interpreter";

import { prisma } from "@/lib/db";
import { getClerkSecretKey } from "@/lib/clerk-server";
import {
  ensureProjectSandbox,
  touchProjectSandbox,
} from "@/lib/sandbox-instance";
import {
  ensureSandboxPreviewReady,
  SANDBOX_PREVIEW_PORT,
} from "@/lib/sandbox-preview";
import { SANDBOX_TIMEOUT } from "@/inngest/types";
import { recordSandboxUsage } from "@/lib/sandbox-usage";

const extractSandboxId = (sandboxUrl: string) => {
  try {
    const url = new URL(sandboxUrl);
    const host = url.host; // e.g. 3000-<sandboxId>.e2b.app
    const dotIndex = host.indexOf(".");
    const subdomain = dotIndex > 0 ? host.slice(0, dotIndex) : host;
    const dashIndex = subdomain.indexOf("-");
    if (dashIndex <= 0) return null;
    return subdomain.slice(dashIndex + 1);
  } catch {
    return null;
  }
};

export async function POST(req: Request) {
  getClerkSecretKey();
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { fragmentId?: string } | null = null;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  const fragmentId = payload?.fragmentId?.trim();
  if (!fragmentId) {
    return NextResponse.json({ error: "fragmentId is required" }, { status: 400 });
  }

  const fragment = await prisma.fragment.findUnique({
    where: { id: fragmentId },
    select: {
      id: true,
      sandboxUrl: true,
      files: true,
      message: {
        select: {
          project: {
            select: {
              id: true,
              orgId: true,
              userId: true,
              sandboxUpdatedAt: true,
            },
          },
        },
      },
    },
  });

  if (!fragment?.message?.project) {
    return NextResponse.json({ error: "Fragment not found" }, { status: 404 });
  }

  if (fragment.message.project.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!fragment.sandboxUrl) {
    return NextResponse.json({ error: "Sandbox URL missing" }, { status: 400 });
  }

  const sandboxId = extractSandboxId(fragment.sandboxUrl);
  if (!sandboxId) {
    return NextResponse.json({ error: "Invalid sandbox URL" }, { status: 400 });
  }

  try {
    const sandbox = await Sandbox.connect(sandboxId);
    await ensureSandboxPreviewReady(sandboxId);
    const sandboxUrl = `https://${sandbox.getHost(SANDBOX_PREVIEW_PORT)}`;
    await sandbox.setTimeout(SANDBOX_TIMEOUT);
    await recordSandboxUsage({
      projectId: fragment.message.project.id,
      userId,
      orgId: fragment.message.project.orgId,
      lastUpdatedAt: fragment.message.project.sandboxUpdatedAt,
    });
    await touchProjectSandbox({
      projectId: fragment.message.project.id,
      sandboxId,
      sandboxUrl,
    });
    if (sandboxUrl !== fragment.sandboxUrl) {
      await prisma.fragment.update({
        where: { id: fragment.id },
        data: { sandboxUrl },
      });
    }

    return NextResponse.json({ ok: true, sandboxUrl });
  } catch (error) {
    try {
      const projectFragments = await prisma.fragment.findMany({
        where: {
          message: {
            projectId: fragment.message.project.id,
          },
        },
        select: {
          files: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      const filesToWrite: Record<string, string> = {};
      for (const projectFragment of projectFragments) {
        const files = projectFragment.files;
        if (!files || typeof files !== "object") continue;
        for (const [path, content] of Object.entries(files)) {
          if (typeof content === "string") {
            filesToWrite[path] = content;
          }
        }
      }

      const managedSandbox = await ensureProjectSandbox({
        projectId: fragment.message.project.id,
        userId,
        orgId: fragment.message.project.orgId,
        projectSandboxId: sandboxId,
        inferredSandboxId: sandboxId,
        hydrateFiles: filesToWrite,
      });

      await ensureSandboxPreviewReady(managedSandbox.sandboxId);
      const sandbox = await Sandbox.connect(managedSandbox.sandboxId);
      await sandbox.setTimeout(SANDBOX_TIMEOUT);

      const sandboxUrl = managedSandbox.sandboxUrl;

      await prisma.fragment.update({
        where: { id: fragment.id },
        data: { sandboxUrl },
      });

      await touchProjectSandbox({
        projectId: fragment.message.project.id,
        sandboxId: managedSandbox.sandboxId,
        sandboxUrl,
      });

      await recordSandboxUsage({
        projectId: fragment.message.project.id,
        userId,
        orgId: fragment.message.project.orgId,
        lastUpdatedAt: fragment.message.project.sandboxUpdatedAt,
      });

      return NextResponse.json({ ok: true, sandboxUrl });
    } catch (fallbackError) {
      return NextResponse.json(
        {
          error:
            fallbackError instanceof Error
              ? fallbackError.message
              : "Heartbeat failed",
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ ok: true });
}
