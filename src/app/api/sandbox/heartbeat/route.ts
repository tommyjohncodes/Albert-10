import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { Sandbox } from "@e2b/code-interpreter";

import { prisma } from "@/lib/db";
import { SandboxState } from "@/generated/prisma";
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

/** Only extend sandbox timeout / record usage at most this often (minimizes E2B usage). */
const EXTEND_COOLDOWN_MS = 30_000;
import { ensureSandboxElementPicker } from "@/lib/sandbox-element-picker";

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

const isSandboxNotFound = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("not found") || message.includes("paused sandbox");
};

export async function POST(req: Request) {
  getClerkSecretKey();
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.E2B_API_KEY) {
    console.error("[sandbox] heartbeat missing E2B_API_KEY", { userId });
    return NextResponse.json(
      { error: "E2B_API_KEY is not configured" },
      { status: 500 },
    );
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

  const projectId = fragment.message.project.id;
  const orgId = fragment.message.project.orgId;

  const buildFilesToWrite = async () => {
    const projectFragments = await prisma.fragment.findMany({
      where: {
        message: {
          projectId,
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

    return filesToWrite;
  };

  const provisionSandbox = async (preferredSandboxId: string | null) => {
    const filesToWrite = await buildFilesToWrite();
    const managedSandbox = await ensureProjectSandbox({
      projectId,
      userId,
      orgId,
      projectSandboxId: preferredSandboxId,
      inferredSandboxId: preferredSandboxId,
      hydrateFiles: filesToWrite,
    });

    await ensureSandboxPreviewReady(managedSandbox.sandboxId);
    const sandbox = await Sandbox.connect(managedSandbox.sandboxId);
    await sandbox.setTimeout(SANDBOX_TIMEOUT);

    const sandboxUrl = managedSandbox.sandboxUrl;
    const pickerStatus = await ensureSandboxElementPicker(sandbox);

    await prisma.fragment.update({
      where: { id: fragment.id },
      data: { sandboxUrl },
    });

    await touchProjectSandbox({
      projectId,
      sandboxId: managedSandbox.sandboxId,
      sandboxUrl,
    });

    await recordSandboxUsage({
      projectId,
      userId,
      orgId,
      lastUpdatedAt: fragment.message.project.sandboxUpdatedAt,
    });

    return { sandboxUrl, pickerStatus };
  };

  const sandboxId = fragment.sandboxUrl
    ? extractSandboxId(fragment.sandboxUrl)
    : null;

  if (!sandboxId) {
    try {
      const { sandboxUrl, pickerStatus } = await provisionSandbox(null);
      return NextResponse.json({
        ok: true,
        sandboxUrl,
        pickerReload: pickerStatus.updated,
      });
    } catch (error) {
      console.error("[sandbox] heartbeat failed (missing url)", {
        userId,
        fragmentId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Sandbox start failed",
        },
        { status: 502 },
      );
    }
  }

  try {
    const sandbox = await Sandbox.connect(sandboxId);
    await ensureSandboxPreviewReady(sandboxId);
    const sandboxUrl = `https://${sandbox.getHost(SANDBOX_PREVIEW_PORT)}`;
    const pickerStatus = await ensureSandboxElementPicker(sandbox);

    const lastUpdatedAt = fragment.message.project.sandboxUpdatedAt;
    const shouldExtend =
      !lastUpdatedAt ||
      Date.now() - lastUpdatedAt.getTime() >= EXTEND_COOLDOWN_MS;

    if (shouldExtend) {
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
    }

    if (sandboxUrl !== fragment.sandboxUrl) {
      await prisma.fragment.update({
        where: { id: fragment.id },
        data: { sandboxUrl },
      });
    }

    return NextResponse.json({
      ok: true,
      sandboxUrl,
      pickerReload: pickerStatus.updated,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const shouldForceNew = isSandboxNotFound(error);
    console.error("[sandbox] heartbeat failed", {
      userId,
      fragmentId,
      error: errorMessage,
      forceNew: shouldForceNew,
    });
    if (shouldForceNew) {
      try {
      await prisma.project.update({
        where: { id: projectId },
        data: { sandboxId: null, sandboxUpdatedAt: null },
      });
        await prisma.sandboxInstance.updateMany({
          where: { sandboxId },
          data: { state: SandboxState.TERMINATED, terminatedAt: new Date() },
        });
        await prisma.fragment.update({
          where: { id: fragment.id },
          data: { sandboxUrl: "" },
        });
      } catch (cleanupError) {
        console.warn("[sandbox] cleanup failed", cleanupError);
      }
    }
    try {
      const { sandboxUrl, pickerStatus } = await provisionSandbox(
        shouldForceNew ? null : sandboxId,
      );

      return NextResponse.json({
        ok: true,
        sandboxUrl,
        pickerReload: pickerStatus.updated,
      });
    } catch (fallbackError) {
      console.error("[sandbox] heartbeat fallback failed", {
        userId,
        fragmentId,
        error: fallbackError instanceof Error ? fallbackError.message : "Unknown error",
      });
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
