import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import type { ChatRequestPayload } from "@inngest/use-agent";

import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: ChatRequestPayload | null = null;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  const userMessage = payload?.userMessage;
  const content = typeof userMessage?.content === "string" ? userMessage.content.trim() : "";

  if (!content) {
    return NextResponse.json({ error: "Message content is required" }, { status: 400 });
  }

  const state =
    userMessage?.state && typeof userMessage.state === "object"
      ? userMessage.state
      : {};
  const projectId =
    typeof state.projectId === "string" && state.projectId.trim()
      ? state.projectId.trim()
      : typeof payload?.threadId === "string" && payload.threadId.trim()
        ? payload.threadId.trim()
        : null;

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
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  await prisma.message.create({
    data: {
      projectId: project.id,
      content,
      role: "USER",
      type: "RESULT",
    },
  });

  const requestedChannelKey =
    typeof payload?.channelKey === "string" && payload.channelKey.trim()
      ? payload.channelKey.trim()
      : null;
  const channelKey = requestedChannelKey === userId ? requestedChannelKey : userId;

  const threadId =
    typeof payload?.threadId === "string" && payload.threadId.trim()
      ? payload.threadId.trim()
      : project.id;

  await inngest.send({
    name: "code-agent/run",
    data: {
      value: content,
      projectId: project.id,
      orgId: project.orgId,
      userId,
      channelKey,
      threadId,
      userMessage: {
        id: userMessage?.id ?? crypto.randomUUID(),
        content,
        role: "user",
        state: {
          ...state,
          projectId: project.id,
        },
        clientTimestamp: userMessage?.clientTimestamp ?? new Date().toISOString(),
        systemPrompt: userMessage?.systemPrompt,
      },
      history: payload?.history ?? [],
    },
  });

  return NextResponse.json({ success: true, threadId });
}
