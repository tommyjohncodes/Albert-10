import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { codeAgentFunction } from "@/inngest/functions";

const logInngestEnv = () => {
  const eventKey = process.env.INNGEST_EVENT_KEY;
  const eventKeyPrefix = eventKey ? `${eventKey.slice(0, 6)}…` : "missing";
  console.info("[inngest] env", {
    env: process.env.INNGEST_ENV ?? "default",
    devMode: process.env.INNGEST_DEV ?? "unset",
    serveHost: process.env.INNGEST_SERVE_HOST ?? "unset",
    hasEventKey: Boolean(eventKey),
    eventKeyPrefix,
    hasSigningKey: Boolean(process.env.INNGEST_SIGNING_KEY),
  });
};

logInngestEnv();

// Create an API that serves zero functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    codeAgentFunction,
  ],
});
