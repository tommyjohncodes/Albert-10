import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { codeAgentFunction } from "@/inngest/functions";

// maxDuration and streaming prevent Railway's reverse-proxy from closing
// the connection during long-running steps (context deadline / i/o timeout).
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    codeAgentFunction,
  ],
  streaming: "allow",
});
