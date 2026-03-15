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
import {
  CONTEXT_SUMMARY_PROMPT,
  FRAGMENT_TITLE_PROMPT,
  PROMPT,
  RESPONSE_PROMPT,
} from "@/prompt";

import { inngest } from "./client";
import { SANDBOX_RUN_TIMEOUT, SANDBOX_TIMEOUT } from "./types";
import { getSandbox, lastAssistantTextMessageContent, parseAgentOutput } from "./utils";

interface AgentState {
  summary: string;
  files: { [path: string]: string };
  error?: string;
  finishReason?: string;
  lastAssistantMessage?: string;
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

const MAX_CONTEXT_SUMMARY_LENGTH = 1200;

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

type FailureContext = {
  errorType: string;
  errorMessage?: string | null;
  finishReason?: string | null;
  summaryFound: boolean;
  filesCount: number;
};

const buildFailureReason = ({
  errorType,
  finishReason,
}: FailureContext): string | null => {
  if (finishReason === "length") {
    return "The model hit its output limit before finishing.";
  }
  if (finishReason === "content_filter") {
    return "The response was blocked by the safety filter.";
  }
  if (errorType === "missing_summary") {
    return "The agent did not produce the final task summary.";
  }
  if (errorType === "no_files") {
    return "No files were created or updated.";
  }
  if (errorType === "sandbox_limit_reached") {
    return "The sandbox concurrency limit was reached.";
  }
  if (errorType === "tool_call_parse_failed") {
    return "The model returned malformed tool arguments.";
  }
  if (errorType === "agent_error") {
    return "The agent reported an error during execution.";
  }
  return "An unknown error occurred.";
};

const buildFailureGuidance = ({
  errorType,
  finishReason,
}: FailureContext): string | null => {
  if (finishReason === "length") {
    return "Try a shorter request or split the task into smaller steps.";
  }
  if (finishReason === "content_filter") {
    return "Rephrase the request to avoid restricted content.";
  }
  if (errorType === "missing_summary") {
    return "Retry the request, and consider shortening it if it keeps failing.";
  }
  if (errorType === "no_files") {
    return "Be more specific about what you want built, then try again.";
  }
  if (errorType === "sandbox_limit_reached") {
    return "Close another project or wait a minute, then retry.";
  }
  if (errorType === "tool_call_parse_failed") {
    return "Try again or switch models.";
  }
  if (errorType === "agent_error") {
    return "Try again, or simplify the request.";
  }
  return "Try again or simplify the request.";
};

const buildUserFailureMessage = (context: FailureContext): string => {
  const base =
    context.errorMessage ??
    (context.errorType === "missing_summary"
      ? "The agent didn't finish the response."
      : context.errorType === "no_files"
        ? "The agent didn't produce any files."
        : "Something went wrong. Please try again.");
  const reason = buildFailureReason(context);
  const guidance = buildFailureGuidance(context);

  let message = base;
  if (reason) {
    message += `\n\nReason: ${reason}`;
  }
  if (guidance) {
    message += `\nTry: ${guidance}`;
  }

  return message;
};

const recordAgentFailure = async (data: {
  projectId: string;
  sandboxId?: string | null;
  errorType: string;
  errorMessage?: string | null;
  finishReason?: string | null;
  lastAssistantMessage?: string | null;
  summaryFound: boolean;
  filesCount: number;
}) => {
  try {
    const client = (prisma as unknown as { agentFailure?: { create: Function } })
      .agentFailure;
    if (!client?.create) return;
    await client.create({ data });
  } catch (error) {
    console.warn("Failed to record agent failure", error);
  }
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
      const message = buildUserFailureMessage({
        errorType: "sandbox_limit_reached",
        errorMessage:
          "Something went wrong while starting the sandbox. Please try again.",
        finishReason: null,
        summaryFound: false,
        filesCount: 0,
      });

      await step.run("sandbox-limit-error", async () => {
        await recordAgentFailure({
          projectId: event.data.projectId,
          sandboxId: projectAccess?.sandboxId ?? null,
          errorType: "sandbox_limit_reached",
          errorMessage:
            "Something went wrong while starting the sandbox. Please try again.",
          summaryFound: false,
          filesCount: 0,
        });
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

    await createProgressMessage("Planning your request...");

    const projectContext = await step.run("get-project-context", async () => {
      try {
        return await prisma.projectContext.findUnique({
          where: { projectId: event.data.projectId },
          select: { summary: true },
        });
      } catch (error) {
        console.warn("Failed to load project context", error);
        return null;
      }
    });

    const priorContextSummary = projectContext?.summary
      ? projectContext.summary.slice(0, MAX_CONTEXT_SUMMARY_LENGTH)
      : null;

    const previousMessages = await step.run("get-previous-messages", async () => {
      const recentMessages: Message[] = [];

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
        take: 2,
      });

      for (const message of messages) {
        recentMessages.push({
          type: "text",
          role: message.role === "ASSISTANT" ? "assistant" : "user",
          content: message.content,
        })
      }

      const orderedMessages = recentMessages.reverse();
      if (priorContextSummary) {
        return [
          {
            type: "text",
            role: "assistant",
            content: `Project context summary:\n${priorContextSummary}`,
          },
          ...orderedMessages,
        ];
      }

      return orderedMessages;
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
          await createProgressMessage(`Ran command: ${extractCommandName(command)}`);
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
            await createProgressMessage(
              files.length === 1
                ? `Updated file: ${fileList}`
                : `Updated files: ${fileList}`,
            );
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
          if (files.length > 0) {
            const preview = files.slice(0, 3).join(", ");
            const suffix = files.length > 3 ? ` and ${files.length - 3} more` : "";
            await createProgressMessage(
              files.length === 1
                ? `Opened file: ${preview}`
                : `Opened files: ${preview}${suffix}`,
            );
          }
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
      }),
      createTool({
        name: "progress",
        description: "Record a user-visible step update",
        parameters: z.object({
          content: z.string().min(1),
        }),
        handler: async ({ content }) => {
          await createProgressMessage(content);
          return "ok";
        },
      }),
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
        if (finishReason) {
          network.state.data.finishReason = finishReason;
        }
        if (finishReason === "length" || finishReason === "content_filter") {
          network.state.data.error =
            "The model hit the output limit before completing the task. Please try again with a shorter request or a different model.";
          return result;
        }

        const lastAssistantMessageText =
          lastAssistantTextMessageContent(result);

        if (lastAssistantMessageText) {
          network.state.data.lastAssistantMessage =
            lastAssistantMessageText.slice(0, 4000);
        }

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
          const errorType = isToolArgumentsParseError(fallbackError)
            ? "tool_call_parse_failed"
            : "agent_error";
          const errorMessage =
            errorType === "tool_call_parse_failed"
              ? "The model returned malformed tool arguments. Please try again or switch models."
              : "The model request failed. Please try again.";
          await recordAgentFailure({
            projectId: event.data.projectId,
            sandboxId,
            errorType,
            errorMessage: String(fallbackError),
            summaryFound: false,
            filesCount: 0,
          });
          const message = buildUserFailureMessage({
            errorType,
            errorMessage,
            finishReason: null,
            summaryFound: false,
            filesCount: 0,
          });
          await prisma.message.create({
            data: {
              projectId: event.data.projectId,
              content: message,
              role: "ASSISTANT",
              type: "ERROR",
            },
          });
          await cooldownSandbox();
          return { error: errorType };
        }
      } else {
        const errorType = isToolArgumentsParseError(error)
          ? "tool_call_parse_failed"
          : "agent_error";
        const errorMessage =
          errorType === "tool_call_parse_failed"
            ? "The model returned malformed tool arguments. Please try again or switch models."
            : "The model request failed. Please try again.";
        await recordAgentFailure({
          projectId: event.data.projectId,
          sandboxId,
          errorType,
          errorMessage: String(error),
          summaryFound: false,
          filesCount: 0,
        });
        const message = buildUserFailureMessage({
          errorType,
          errorMessage,
          finishReason: null,
          summaryFound: false,
          filesCount: 0,
        });
        await prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content: message,
            role: "ASSISTANT",
            type: "ERROR",
          },
        });
        await cooldownSandbox();
        return { error: errorType };
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

    const isError =
      Boolean(result.state.data.error) ||
      !result.state.data.summary ||
      Object.keys(result.state.data.files || {}).length === 0;

    const resolvedSummary = result.state.data.summary
      ? normalizeTaskSummary(result.state.data.summary)
      : null;

    let contextSummaryResult: { output: Message[]; raw?: unknown } | null = null;
    let nextContextSummary: string | null = null;

    if (resolvedSummary && !isError) {
      const contextSummaryGenerator = createAgent({
        name: "context-summary-generator",
        description: "Generates a compact project context summary",
        system: CONTEXT_SUMMARY_PROMPT,
        model: llmModels.response,
      });

      contextSummaryResult = await contextSummaryGenerator.run(
        JSON.stringify({
          previous_summary: priorContextSummary ?? "",
          user_request: event.data.value,
          task_summary: resolvedSummary,
        }),
      );

      const parsedContextSummary = parseAgentOutput(contextSummaryResult.output);
      if (parsedContextSummary) {
        nextContextSummary = parsedContextSummary.slice(0, MAX_CONTEXT_SUMMARY_LENGTH);
      }
    }

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

      if (contextSummaryResult) {
        usageByModel.push({
          modelName: llmModels.modelNames.response,
          usage: extractUsageFromAgentResult(contextSummaryResult),
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
        const filesCount = Object.keys(result.state.data.files || {}).length;
        const summaryFound = Boolean(result.state.data.summary);
        const errorType = result.state.data.error
          ? "agent_error"
          : !summaryFound
            ? "missing_summary"
            : filesCount === 0
              ? "no_files"
              : "unknown_error";
        const message = buildUserFailureMessage({
          errorType,
          errorMessage: result.state.data.error ?? null,
          finishReason: result.state.data.finishReason ?? null,
          summaryFound,
          filesCount,
        });

        await recordAgentFailure({
          projectId: event.data.projectId,
          sandboxId,
          errorType,
          errorMessage: result.state.data.error ?? null,
          finishReason: result.state.data.finishReason ?? null,
          lastAssistantMessage: result.state.data.lastAssistantMessage ?? null,
          summaryFound,
          filesCount,
        });
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

    if (nextContextSummary) {
      await step.run("save-project-context", async () => {
        await prisma.projectContext.upsert({
          where: { projectId: event.data.projectId },
          update: { summary: nextContextSummary },
          create: {
            projectId: event.data.projectId,
            summary: nextContextSummary,
          },
        });
      });
    }

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
