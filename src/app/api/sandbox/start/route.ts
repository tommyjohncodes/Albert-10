import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { Sandbox } from "@e2b/code-interpreter";

import { prisma } from "@/lib/db";
import { getClerkSecretKey } from "@/lib/clerk-server";
import { ensureProjectSandbox, touchProjectSandbox } from "@/lib/sandbox-instance";
import { ensureSandboxPreviewReady, SANDBOX_PREVIEW_PORT } from "@/lib/sandbox-preview";
import { SANDBOX_TIMEOUT } from "@/inngest/types";
import { recordSandboxUsage } from "@/lib/sandbox-usage";
import { ensureSandboxElementPicker } from "@/lib/sandbox-element-picker";

const extractSandboxId = (sandboxUrl?: string | null) => {
  if (!sandboxUrl) return null;
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

  let payload: { projectId?: string } | null = null;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  const projectId = payload?.projectId?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId,
    },
    select: {
      id: true,
      orgId: true,
      sandboxId: true,
      sandboxUpdatedAt: true,
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const latestFragment = await prisma.fragment.findFirst({
    where: {
      message: {
        projectId,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      sandboxUrl: true,
      files: true,
    },
  });

  if (!latestFragment) {
    return NextResponse.json({ ok: false, reason: "no_fragment" });
  }

  try {
    const managedSandbox = await ensureProjectSandbox({
      projectId: project.id,
      userId,
      orgId: project.orgId,
      projectSandboxId: project.sandboxId ?? null,
      inferredSandboxId: extractSandboxId(latestFragment.sandboxUrl),
      hydrateFiles: typeof latestFragment.files === "object"
        ? (latestFragment.files as Record<string, string>)
        : undefined,
    });

    await ensureSandboxPreviewReady(managedSandbox.sandboxId);
    const sandbox = await Sandbox.connect(managedSandbox.sandboxId);
    const sandboxUrl = `https://${sandbox.getHost(SANDBOX_PREVIEW_PORT)}`;
    const pickerStatus = await ensureSandboxElementPicker(sandbox);
    await sandbox.setTimeout(SANDBOX_TIMEOUT);

    await prisma.fragment.update({
      where: { id: latestFragment.id },
      data: { sandboxUrl },
    });

    await touchProjectSandbox({
      projectId: project.id,
      sandboxId: managedSandbox.sandboxId,
      sandboxUrl,
    });

    await recordSandboxUsage({
      projectId: project.id,
      userId,
      orgId: project.orgId,
      lastUpdatedAt: project.sandboxUpdatedAt,
    });

    return NextResponse.json({
      ok: true,
      sandboxUrl,
      pickerReload: pickerStatus.updated,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Sandbox start failed",
      },
      { status: 502 },
    );
  }
}
