import { z } from "zod";
import { Sandbox } from "@e2b/code-interpreter";
import {
  createAgent,
  createTool,
  createNetwork,
  type Message,
  type Tool,
  createState,
} from "@inngest/agent-kit";

import { prisma } from "@/lib/db";
import { fetchLlmOrgData, buildLlmModels } from "@/lib/llm";
import { ensureProjectSandbox, touchProjectSandbox } from "@/lib/sandbox-instance";
import { recordSandboxUsage } from "@/lib/sandbox-usage";
import { SANDBOX_PREVIEW_PORT } from "@/lib/sandbox-preview";
import { FRAGMENT_TITLE_PROMPT, PROMPT, RESPONSE_PROMPT } from "@/prompt";

import { inngest } from "./client";
import { SANDBOX_RUN_TIMEOUT, SANDBOX_TIMEOUT } from "./types";
import { getSandbox, lastAssistantTextMessageContent, parseAgentOutput } from "./utils";

interface AgentState {
  summary: string;
  files: { [path: string]: string };
}

const extractSandboxIdFromUrl = (sandboxUrl?: string | null) => {
  if (!sandboxUrl) return null;
  try {
    const url = new URL(sandboxUrl);
    const host = url.host;
    const dotIndex = host.indexOf(".");
    const subdomain = dotIndex > 0 ? host.slice(0, dotIndex) : host;
    const dashIndex = subdomain.indexOf("-");
    if (dashIndex <= 0) return null;
    return subdomain.slice(dashIndex + 1);
  } catch {
    return null;
  }
};

export const codeAgentFunction = inngest.createFunction(
  { id: "code-agent" },
  { event: "code-agent/run" },
  async ({ event, step }) => {
    // Resolve project auth / org context
    const projectAccess = await step.run("get-project-access", async () => {
      const project = await prisma.project.findUnique({
        where: { id: event.data.projectId },
        select: {
          orgId: true,
          userId: true,
          sandboxId: true,
          sandboxUpdatedAt: true,
        },
      });
      return {
        orgId: (event.data?.orgId as string | undefined) ?? project?.orgId ?? null,
        userId: (event.data?.userId as string | undefined) ?? project?.userId ?? null,
        sandboxId: project?.sandboxId ?? null,
        sandboxUpdatedAt: project?.sandboxUpdatedAt ?? null,
      };
    });

    const orgId = projectAccess?.orgId ?? null;
    const userId = projectAccess?.userId ?? null;

    // Fetch org LLM config inside a step so it is memoised — avoids hitting the
    // DB on every Inngest replay and prevents "Server has closed the connection".
    const llmOrgData = await step.run("get-llm-config", () => fetchLlmOrgData(orgId));

    // Build model instances outside the step (non-serialisable, pure computation).
    const llmModels = buildLlmModels(
      llmOrgData ?? {
        config: {
          provider: "openai",
          codeModel: "gpt-4.1",
          titleModel: "gpt-4o",
          responseModel: "gpt-4o",
          fallbackCodeModel: "gpt-4.1",
        },
        encryptedApiKey: null,
      },
    );

    // Ensure a sandbox is running for this project, reusing an existing one
    // where possible so the agent sees the cumulative file state.
    const sandboxResult = await step.run("get-sandbox-id", async () => {
      const allFragments = await prisma.fragment.findMany({
        where: { message: { projectId: event.data.projectId } },
        orderBy: { createdAt: "asc" },
        select: { sandboxUrl: true, files: true },
      });

      const latestFragment = allFragments.length > 0
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        ? allFragments[allFragments.length - 1]!
        : null;

      // Merge all fragment files so a fresh sandbox has the full project state.
      const cumulativeFiles: Record<string, string> = {};
      for (const fragment of allFragments) {
        const files = fragment.files;
        if (files && typeof files === "object") {
          for (const [path, content] of Object.entries(files)) {
            if (typeof content === "string") cumulativeFiles[path] = content;
          }
        }
      }

      const managedSandbox = await ensureProjectSandbox({
        projectId: event.data.projectId,
        userId: userId ?? "",
        orgId,
        projectSandboxId: projectAccess?.sandboxId ?? null,
        inferredSandboxId: extractSandboxIdFromUrl(latestFragment?.sandboxUrl ?? null),
        hydrateFiles: Object.keys(cumulativeFiles).length > 0 ? cumulativeFiles : undefined,
      });

      await recordSandboxUsage({
        projectId: event.data.projectId,
        userId: userId ?? "",
        orgId,
        lastUpdatedAt: projectAccess?.sandboxUpdatedAt
          ? new Date(projectAccess.sandboxUpdatedAt)
          : null,
      });

      return { sandboxId: managedSandbox.sandboxId };
    });

    if (!sandboxResult?.sandboxId) {
      await step.run("sandbox-error", async () => {
        return prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content: "Something went wrong while starting the sandbox. Please try again.",
            role: "ASSISTANT",
            type: "ERROR",
          },
        });
      });
      return { error: "sandbox_unavailable" };
    }

    const sandboxId = sandboxResult.sandboxId;

    const previousMessages = await step.run("get-previous-messages", async () => {
      const formattedMessages: Message[] = [];

      const messages = await prisma.message.findMany({
        where: { projectId: event.data.projectId },
        orderBy: { createdAt: "desc" },
        take: 5,
      });

      for (const message of messages) {
        formattedMessages.push({
          type: "text",
          role: message.role === "ASSISTANT" ? "assistant" : "user",
          content: message.content,
        });
      }

      return formattedMessages.reverse();
    });

    const state = createState<AgentState>(
      { summary: "", files: {} },
      { messages: previousMessages ?? [] },
    );

    const codeAgent = createAgent<AgentState>({
      name: "code-agent",
      description: "An expert coding agent",
      system: PROMPT,
      model: llmModels.code,
      tools: [
        createTool({
          name: "terminal",
          description: "Use the terminal to run commands",
          parameters: z.object({
            command: z.string(),
          }),
          handler: async ({ command }, { step }) => {
            return await step?.run("terminal", async () => {
              const buffers = { stdout: "", stderr: "" };
              try {
                const sandbox = await getSandbox(sandboxId, SANDBOX_RUN_TIMEOUT);
                const result = await sandbox.commands.run(command, {
                  onStdout: (data: string) => { buffers.stdout += data; },
                  onStderr: (data: string) => { buffers.stderr += data; },
                });
                return result.stdout;
              } catch (e) {
                console.error(`Command failed: ${e}\nstdout: ${buffers.stdout}\nstderr: ${buffers.stderr}`);
                return `Command failed: ${e}\nstdout: ${buffers.stdout}\nstderr: ${buffers.stderr}`;
              }
            });
          },
        }),
        createTool({
          name: "createOrUpdateFiles",
          description: "Create or update files in the sandbox",
          parameters: z.object({
            files: z.array(
              z.object({
                path: z.string(),
                content: z.string(),
              }),
            ),
          }),
          handler: async (
            { files },
            { step, network }: Tool.Options<AgentState>
          ) => {
            // Return only the files written in this call — avoids bloating the
            // Inngest replay payload with the entire accumulated file state.
            const writtenFiles = await step?.run("createOrUpdateFiles", async () => {
              try {
                const sandbox = await getSandbox(sandboxId, SANDBOX_RUN_TIMEOUT);
                const newlyWritten: Record<string, string> = {};
                for (const file of files) {
                  await sandbox.files.write(file.path, file.content);
                  newlyWritten[file.path] = file.content;
                }
                return newlyWritten;
              } catch (e) {
                return "Error: " + e;
              }
            });

            if (typeof writtenFiles === "object") {
              network.state.data.files = { ...network.state.data.files, ...writtenFiles };
            }
          },
        }),
        createTool({
          name: "readFiles",
          description: "Read files from the sandbox",
          parameters: z.object({
            files: z.array(z.string()),
          }),
          handler: async ({ files }, { step }) => {
            return await step?.run("readFiles", async () => {
              try {
                const sandbox = await getSandbox(sandboxId, SANDBOX_RUN_TIMEOUT);
                const contents = [];
                for (const file of files) {
                  const content = await sandbox.files.read(file);
                  contents.push({ path: file, content });
                }
                return JSON.stringify(contents);
              } catch (e) {
                return "Error: " + e;
              }
            });
          },
        }),
      ],
      lifecycle: {
        onResponse: async ({ result, network }) => {
          const lastAssistantMessageText = lastAssistantTextMessageContent(result);
          if (lastAssistantMessageText && network) {
            if (lastAssistantMessageText.includes("<task_summary>")) {
              network.state.data.summary = lastAssistantMessageText;
            }
          }
          return result;
        },
      },
    });

    const network = createNetwork<AgentState>({
      name: "coding-agent-network",
      agents: [codeAgent],
      maxIter: 15,
      defaultState: state,
      router: async ({ network }) => {
        if (network.state.data.summary) return;
        return codeAgent;
      },
    });

    const result = await network.run(event.data.value, { state });

    const fragmentTitleResult = await step.run("llm-fragment-title", async () => {
      const fragmentTitleGenerator = createAgent({
        name: "fragment-title-generator",
        description: "A fragment title generator",
        system: FRAGMENT_TITLE_PROMPT,
        model: llmModels.title,
      });
      try {
        return await fragmentTitleGenerator.run(result.state.data.summary);
      } catch {
        return null;
      }
    });

    const responseResult = await step.run("llm-response", async () => {
      const responseGenerator = createAgent({
        name: "response-generator",
        description: "A response generator",
        system: RESPONSE_PROMPT,
        model: llmModels.response,
      });
      try {
        return await responseGenerator.run(result.state.data.summary);
      } catch {
        return null;
      }
    });

    const isError =
      !result.state.data.summary ||
      Object.keys(result.state.data.files || {}).length === 0;

    const sandboxUrl = await step.run("get-sandbox-url", async () => {
      const sandbox = await getSandbox(sandboxId, SANDBOX_RUN_TIMEOUT);
      const host = sandbox.getHost(SANDBOX_PREVIEW_PORT);
      return `https://${host}`;
    });

    await step.run("save-result", async () => {
      if (isError) {
        return prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content: "Something went wrong. Please try again.",
            role: "ASSISTANT",
            type: "ERROR",
          },
        });
      }

      return prisma.message.create({
        data: {
          projectId: event.data.projectId,
          content: responseResult
            ? parseAgentOutput(responseResult.output)
            : "Here's what I built for you.",
          role: "ASSISTANT",
          type: "RESULT",
          fragment: {
            create: {
              sandboxUrl,
              title: fragmentTitleResult
                ? parseAgentOutput(fragmentTitleResult.output)
                : "Fragment",
              files: result.state.data.files,
            },
          },
        },
      });
    });

    await step.run("cooldown-sandbox", async () => {
      try {
        await Sandbox.setTimeout(sandboxId, SANDBOX_TIMEOUT);
        await touchProjectSandbox({
          projectId: event.data.projectId,
          sandboxId,
          sandboxUrl,
        });
      } catch (error) {
        console.warn("Failed to cooldown sandbox", error);
      }
    });

    return {
      url: sandboxUrl,
      title: fragmentTitleResult
        ? parseAgentOutput(fragmentTitleResult.output)
        : "Fragment",
      files: result.state.data.files,
      summary: result.state.data.summary,
    };
  },
);
