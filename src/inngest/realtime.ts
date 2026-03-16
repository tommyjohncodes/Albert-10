import { channel, topic } from "@inngest/realtime";
import type { AgentMessageChunk } from "@inngest/agent-kit";

const agentStreamTopic = topic("agent_stream").type<AgentMessageChunk>();

export const agentStreamChannel = channel((channelKey: string) => `agent:${channelKey}`).addTopic(
  agentStreamTopic,
);

export const getAgentStreamChannel = (channelKey: string) => agentStreamChannel(channelKey);

export const AGENT_STREAM_TOPIC = agentStreamTopic.name;
