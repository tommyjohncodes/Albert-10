import { z } from "zod";
import { Sandbox } from "@e2b/code-interpreter";
import {
  createAgent,
  createTool,
  createNetwork,
  type Agent,
  type AgentResult,
  type Message,
  type Tool,
  createState,
} from "@inngest/agent-kit";

import { prisma } from "@/lib/db";
import { recordLlmUsage } from "@/lib/llm-usage";
import { getLlmModels } from "@/lib/llm";
import {
  ensureProjectSandbox,
  touchProjectSandbox,
} from "@/lib/sandbox-instance";
import { recordSandboxUsage } from "@/lib/sandbox-usage";
import {
  ensureSandboxPreviewReady,
  SANDBOX_PREVIEW_PORT,
} from "@/lib/sandbox-preview";
import { FRAGMENT_TITLE_PROMPT, PROMPT, RESPONSE_PROMPT } from "@/prompt";

import { inngest } from "./client";
import { SANDBOX_RUN_TIMEOUT, SANDBOX_TIMEOUT } from "./types";
import { getSandbox, lastAssistantTextMessageContent, parseAgentOutput } from "./utils";

interface AgentState {
  summary: string;
  files: { [path: string]: string };
  error?: string;
};

interface UsageShape {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number | string;
  total_cost?: number | string;
  totalCost?: number | string;
  costUsd?: number | string;
  cost_usd?: number | string;
  total_cost_usd?: number | string;
  totalCostUsd?: number | string;
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

const normalizeUsage = (usage?: RawUsage | null): UsageShape => {
  if (!usage) {
    return {};
  }

  const promptTokens = usage.promptTokens ?? usage.prompt_tokens ?? 0;
  const completionTokens = usage.completionTokens ?? usage.completion_tokens ?? 0;
  const totalTokens =
    usage.totalTokens ?? usage.total_tokens ?? promptTokens + completionTokens;
  const rawCost =
    usage.costUsd ??
    usage.cost_usd ??
    usage.total_cost_usd ??
    usage.totalCostUsd ??
    usage.cost ??
    usage.total_cost ??
    usage.totalCost ??
    0;
  const costUsd =
    typeof rawCost === "number"
      ? rawCost
      : typeof rawCost === "string"
        ? Number(rawCost)
        : 0;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: Number.isFinite(costUsd) ? costUsd : 0,
  };
};

const parseUsageFromRaw = (raw: unknown): UsageShape => {
  if (!raw) {
    return {};
  }

  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }

  if (!value || typeof value !== "object") {
    return {};
  }

  const usage =
    (value as { usage?: RawUsage }).usage ??
    (value as { data?: { usage?: RawUsage } }).data?.usage ??
    (value as { response?: { usage?: RawUsage } }).response?.usage;

  if (!usage || typeof usage !== "object") {
    return {};
  }

  return normalizeUsage(usage);
};

const mergeUsage = (items: UsageShape[]): UsageShape => {
  const totals: UsageShape = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };

  for (const item of items) {
    totals.promptTokens = (totals.promptTokens ?? 0) + (item.promptTokens ?? 0);
    totals.completionTokens =
      (totals.completionTokens ?? 0) + (item.completionTokens ?? 0);
    totals.totalTokens = (totals.totalTokens ?? 0) + (item.totalTokens ?? 0);
    totals.costUsd = (totals.costUsd ?? 0) + (item.costUsd ?? 0);
  }

  return totals;
};

const extractUsageFromAgentResult = (result?: { raw?: unknown } | null) =>
  parseUsageFromRaw(result?.raw);

const extractUsageFromNetwork = (
  network?: { state?: { results?: Array<{ raw?: unknown }> } } | null,
) =>
  mergeUsage(
    (network?.state?.results ?? []).map((result) =>
      extractUsageFromAgentResult(result),
    ),
  );

const parseRawObject = (raw: unknown) => {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") {
    return raw as object;
  }
  return null;
};

const extractFinishReasonFromRaw = (raw: unknown) => {
  const value = parseRawObject(raw) as
    | {
        choices?: Array<{ finish_reason?: string; finishReason?: string }>;
        data?: { choices?: Array<{ finish_reason?: string; finishReason?: string }> };
        response?: { choices?: Array<{ finish_reason?: string; finishReason?: string }> };
      }
    | null;

  if (!value) return null;

  const choices =
    value.choices ??
    value.data?.choices ??
    value.response?.choices;

  const finishReason = choices?.[0]?.finish_reason ?? choices?.[0]?.finishReason;
  return typeof finishReason === "string" ? finishReason : null;
};

const normalizeTaskSummary = (value: string) => {
  const withoutTags = value.replace(/<\/?task_summary>/g, "");
  return withoutTags.replace(/\s+/g, " ").trim();
};

const extractCommandName = (command: string) => {
  const trimmed = command.trim();
  if (!trimmed) return "command";
  return trimmed.split(/\s+/)[0] ?? "command";
};

const isToolArgumentsParseError = (error: unknown) =>
  error instanceof Error &&
  error.message.includes("Failed to parse JSON with backticks");

export const codeAgentFunction = inngest.createFunction(
  { id: "code-agent" },
  { event: "code-agent/run" },
  async ({ event, step }) => {
    const projectAccess = await step.run("get-project-access", async () => {
      const project = await prisma.project.findUnique({
        where: {
          id: event.data.projectId,
        },
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
    const resolvedUserId = userId ?? event.data.userId;

    if (!resolvedUserId) {
      throw new Error("Project user ID is missing.");
    }

    const sandboxResult = await step.run("get-sandbox-id", async () => {
      const latestFragment = await prisma.fragment.findFirst({
        where: {
          message: {
            projectId: event.data.projectId,
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          sandboxUrl: true,
        },
      });

      const managedSandbox = await ensureProjectSandbox({
        projectId: event.data.projectId,
        userId: resolvedUserId,
        orgId,
        projectSandboxId: projectAccess?.sandboxId ?? null,
        inferredSandboxId: extractSandboxIdFromUrl(
          latestFragment?.sandboxUrl ?? null,
        ),
      });

      await recordSandboxUsage({
        projectId: event.data.projectId,
        userId,
        orgId,
        lastUpdatedAt: projectAccess?.sandboxUpdatedAt
          ? new Date(projectAccess.sandboxUpdatedAt)
          : null,
      });

      return { sandboxId: managedSandbox.sandboxId };
    });

    if (!sandboxResult?.sandboxId) {
      const message = "Something went wrong while starting the sandbox. Please try again.";

      await step.run("sandbox-limit-error", async () => {
        return prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content: message,
            role: "ASSISTANT",
            type: "ERROR",
          },
        });
      });

      return { error: "sandbox_limit_reached" };
    }

    const sandboxId = sandboxResult.sandboxId;
    const cooldownSandbox = async () => {
      try {
        await Sandbox.setTimeout(sandboxId, SANDBOX_TIMEOUT);
      } catch (error) {
        console.warn("Failed to reset sandbox timeout after error", error);
      }
    };

    const llmModels = await getLlmModels(orgId);

    const createProgressMessage = async (content: string) => {
      try {
        await prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content,
            role: "ASSISTANT",
            type: "PROGRESS",
          },
        });
      } catch (error) {
        console.warn("Failed to record progress message", error);
      }
    };

    const previousMessages = await step.run("get-previous-messages", async () => {
      const formattedMessages: Message[] = [];

      const messages = await prisma.message.findMany({
        where: {
          projectId: event.data.projectId,
          type: {
            not: "PROGRESS",
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 5,
      });

      for (const message of messages) {
        formattedMessages.push({
          type: "text",
          role: message.role === "ASSISTANT" ? "assistant" : "user",
          content: message.content,
        })
      }

      return formattedMessages.reverse();
    });

    const buildAgentState = () =>
      createState<AgentState>(
        {
          summary: "",
          files: {},
        },
        {
          messages: previousMessages,
        },
      );

    const tools = [
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
                onStdout: (data: string) => {
                  buffers.stdout += data;
                },
                onStderr: (data: string) => {
                  buffers.stderr += data;
                }
              });
              return result.stdout;
            } catch (e) {
              console.error(
                `Command failed: ${e} \nstdout: ${buffers.stdout}\nstderror: ${buffers.stderr}`,
              );
              return `Command failed: ${e} \nstdout: ${buffers.stdout}\nstderr: ${buffers.stderr}`;
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
          if (files.length > 0) {
            const fileList = files.map((file) => file.path).join(", ");
            await createProgressMessage(`Changed files: ${fileList}`);
          }

          const newFiles = await step?.run("createOrUpdateFiles", async () => {
            try {
              const updatedFiles = network.state.data.files || {};
              const sandbox = await getSandbox(sandboxId, SANDBOX_RUN_TIMEOUT);
              for (const file of files) {
                await sandbox.files.write(file.path, file.content);
                updatedFiles[file.path] = file.content;
              }

              return updatedFiles;
            } catch (e) {
              return "Error: " + e;
            }
          });

          if (typeof newFiles === "object") {
            network.state.data.files = newFiles;
          }
        }
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
          })
        },
      })
    ];

    const lifecycle: Agent.Lifecycle<AgentState> = {
      onResponse: async ({
        result,
        network,
      }: {
        result: AgentResult;
        network?: { state: { data: AgentState } };
      }) => {
        if (!network) {
          return result;
        }

        const finishReason = extractFinishReasonFromRaw(result.raw);
        if (finishReason === "length" || finishReason === "content_filter") {
          network.state.data.error =
            "The model hit the output limit before completing the task. Please try again with a shorter request or a different model.";
          return result;
        }

        const lastAssistantMessageText =
          lastAssistantTextMessageContent(result);

        if (lastAssistantMessageText?.includes("<task_summary>")) {
          network.state.data.summary = lastAssistantMessageText;
        }

        return result;
      },
    };

    const buildCodeAgent = (model: typeof llmModels.code) =>
      createAgent<AgentState>({
        name: "code-agent",
        description: "An expert coding agent",
        system: PROMPT,
        model,
        tools,
        lifecycle,
      });

    const buildNetwork = (agent: ReturnType<typeof buildCodeAgent>, state: ReturnType<typeof buildAgentState>) =>
      createNetwork<AgentState>({
        name: "coding-agent-network",
        agents: [agent],
        maxIter: 15,
        defaultState: state,
        router: async ({ network }) => {
          const summary = network.state.data.summary;

          if (network.state.data.error) {
            return;
          }

          if (summary) {
            return;
          }

          return agent;
        },
      });

    const runWithAgent = async (
      model: typeof llmModels.code,
      modelName: string | null,
    ) => {
      const state = buildAgentState();
      const agent = buildCodeAgent(model);
      const network = buildNetwork(agent, state);
      const result = await network.run(event.data.value, { state });
      return { result, modelName };
    };

    let runResult: { result: any; modelName: string | null };

    try {
      runResult = await runWithAgent(
        llmModels.code,
        llmModels.modelNames.code,
      );
    } catch (error) {
      if (isToolArgumentsParseError(error) && llmModels.codeFallback) {
        try {
          runResult = await runWithAgent(
            llmModels.codeFallback,
            llmModels.modelNames.codeFallback ?? llmModels.modelNames.code,
          );
        } catch (fallbackError) {
          await prisma.message.create({
            data: {
              projectId: event.data.projectId,
              content:
                "The model returned malformed tool arguments. Please try again or switch models.",
              role: "ASSISTANT",
              type: "ERROR",
            },
          });
          await cooldownSandbox();
          return { error: "tool_call_parse_failed" };
        }
      } else {
        await prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content:
              "The model returned malformed tool arguments. Please try again or switch models.",
            role: "ASSISTANT",
            type: "ERROR",
          },
        });
        await cooldownSandbox();
        return { error: "tool_call_parse_failed" };
      }
    }

    const result = runResult.result;
    const codeModelName = runResult.modelName ?? llmModels.modelNames.code;

    const existingTitle = await step.run("get-existing-title", async () => {
      const fragment = await prisma.fragment.findFirst({
        where: {
          message: {
            projectId: event.data.projectId,
          },
        },
        orderBy: {
          createdAt: "asc",
        },
        select: {
          title: true,
        },
      });

      return fragment?.title ?? null;
    });

    const responseGenerator = createAgent({
      name: "response-generator",
      description: "A response generator",
      system: RESPONSE_PROMPT,
      model: llmModels.response,
    });

    let fragmentTitleResult: { output: Message[]; raw?: unknown } | null = null;
    let fragmentTitle: string | null = existingTitle;

    if (!fragmentTitle) {
      const fragmentTitleGenerator = createAgent({
        name: "fragment-title-generator",
        description: "A fragment title generator",
        system: FRAGMENT_TITLE_PROMPT,
        model: llmModels.title,
      });

      fragmentTitleResult = await fragmentTitleGenerator.run(
        result.state.data.summary,
      );
      fragmentTitle = parseAgentOutput(fragmentTitleResult.output);
    }

    const responseResult = await responseGenerator.run(result.state.data.summary);

    const responseOutput = responseResult.output;

    await step.run("record-llm-usage", async () => {
      const usageByModel = [
        {
          modelName: codeModelName,
          usage: extractUsageFromNetwork(result),
        },
        {
          modelName: llmModels.modelNames.response,
          usage: extractUsageFromAgentResult(responseResult),
        },
      ];

      if (fragmentTitleResult) {
        usageByModel.push({
          modelName: llmModels.modelNames.title,
          usage: extractUsageFromAgentResult(fragmentTitleResult),
        });
      }

      for (const item of usageByModel) {
        await recordLlmUsage({
          userId,
          orgId,
          provider: llmModels.provider,
          model: item.modelName ?? "unknown",
          promptTokens: item.usage?.promptTokens ?? 0,
          completionTokens: item.usage?.completionTokens ?? 0,
          totalTokens: item.usage?.totalTokens ?? 0,
          costUsd: item.usage?.costUsd ?? 0,
        });
      }
    });

    const isError =
      Boolean(result.state.data.error) ||
      !result.state.data.summary ||
      Object.keys(result.state.data.files || {}).length === 0;

    const sandboxUrl = await step.run("get-sandbox-url", async () => {
      if (!isError) {
        await ensureSandboxPreviewReady(sandboxId);
      }

      const sandbox = await getSandbox(sandboxId, SANDBOX_RUN_TIMEOUT);
      const host = sandbox.getHost(SANDBOX_PREVIEW_PORT);
      return `https://${host}`;
    });

    await step.run("save-result", async () => {
      if (isError) {
        const message =
          result.state.data.error ?? "Something went wrong. Please try again.";
        return await prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content: message,
            role: "ASSISTANT",
            type: "ERROR",
          },
        });
      }

      const resolvedTitle = fragmentTitle ?? "Fragment";
      const resolvedSummary = result.state.data.summary
        ? normalizeTaskSummary(result.state.data.summary)
        : null;

      return await prisma.message.create({
        data: {
          projectId: event.data.projectId,
          content: parseAgentOutput(responseOutput),
          role: "ASSISTANT",
          type: "RESULT",
          fragment: {
            create: {
              sandboxUrl: sandboxUrl,
              title: resolvedTitle,
              summary: resolvedSummary,
              files: result.state.data.files,
            },
          },
        },
      })
    });

    await step.run("record-sandbox-usage", async () => {
      const project = await prisma.project.findUnique({
        where: { id: event.data.projectId },
        select: { sandboxUpdatedAt: true },
      });
      await recordSandboxUsage({
        projectId: event.data.projectId,
        userId,
        orgId,
        lastUpdatedAt: project?.sandboxUpdatedAt ?? null,
      });
      await touchProjectSandbox({
        projectId: event.data.projectId,
        sandboxId,
        sandboxUrl,
      });
    });

    await step.run("cooldown-sandbox", async () => {
      try {
        await Sandbox.setTimeout(sandboxId, SANDBOX_TIMEOUT);
      } catch (error) {
        console.warn("Failed to reset sandbox timeout", error);
      }
    });

    return { 
      url: sandboxUrl,
      title: fragmentTitle ?? "Fragment",
      files: result.state.data.files,
      summary: result.state.data.summary,
    };
  },
);
