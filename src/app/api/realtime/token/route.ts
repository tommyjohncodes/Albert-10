import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSubscriptionToken } from "@inngest/realtime";

import { inngest } from "@/inngest/client";
import { getAgentStreamChannel, AGENT_STREAM_TOPIC } from "@/inngest/realtime";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { channelKey?: string } | null = null;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  const requestedChannelKey =
    typeof payload?.channelKey === "string" && payload.channelKey.trim()
      ? payload.channelKey.trim()
      : null;
  const channelKey = requestedChannelKey === userId ? requestedChannelKey : userId;

  try {
    const token = await getSubscriptionToken(inngest, {
      channel: getAgentStreamChannel(channelKey),
      topics: [AGENT_STREAM_TOPIC],
    });

    return NextResponse.json(token);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to issue token" },
      { status: 500 },
    );
  }
}
