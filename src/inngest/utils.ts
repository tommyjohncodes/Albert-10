import { Sandbox } from "@e2b/code-interpreter";
import { AgentResult, Message, TextMessage } from "@inngest/agent-kit";

import { SANDBOX_TIMEOUT } from "./types";

const SANDBOX_CONNECT_TIMEOUT_MS = 15_000;
const SANDBOX_SET_TIMEOUT_MS = 10_000;

const withTimeout = async <T>(promise: Promise<T>, ms: number, message: string) => {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export async function getSandbox(sandboxId: string, timeoutMs = SANDBOX_TIMEOUT) {
  const sandbox = await withTimeout(
    Sandbox.connect(sandboxId),
    SANDBOX_CONNECT_TIMEOUT_MS,
    "Sandbox connect timed out",
  );
  await withTimeout(
    sandbox.setTimeout(timeoutMs),
    SANDBOX_SET_TIMEOUT_MS,
    "Sandbox timeout update timed out",
  );
  return sandbox;
};

export function lastAssistantTextMessageContent(result: AgentResult) {
  const lastAssistantTextMessageIndex = result.output.findLastIndex(
    (message) => message.role === "assistant",
  );

  const message = result.output[lastAssistantTextMessageIndex] as
    | TextMessage
    | undefined;

  return message?.content
    ? typeof message.content === "string"
      ? message.content
      : message.content.map((c) => c.text).join("")
    : undefined;
};

export const parseAgentOutput = (value: Message[]) => {
  const output = value[0];

  if (output.type !== "text") {
    return "Fragment";
  }

  if (Array.isArray(output.content)) {
    return output.content.map((txt) => txt).join("")
  } else {
    return output.content
  }
};
