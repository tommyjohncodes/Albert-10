import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { Sandbox } from "@e2b/code-interpreter";

import { prisma } from "@/lib/db";
import { SANDBOX_TIMEOUT } from "@/inngest/types";

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
      sandboxUrl: true,
      message: {
        select: {
          project: {
            select: {
              id: true,
              userId: true,
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
    await Sandbox.setTimeout(sandboxId, SANDBOX_TIMEOUT);
    await prisma.project.update({
      where: { id: fragment.message.project.id },
      data: {
        sandboxId,
        sandboxUpdatedAt: new Date(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Heartbeat failed" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
