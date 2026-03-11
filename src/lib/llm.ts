import "server-only";

import { openai } from "@inngest/agent-kit";

import { prisma } from "@/lib/db";

export type LlmProvider = "openai" | "openrouter";

export interface LlmConfig {
  provider: LlmProvider;
  codeModel: string;
  titleModel: string;
  responseModel: string;
}

const OPENROUTER_BASE_URL_DEFAULT = "https://openrouter.ai/api/v1/";

const DEFAULT_MODELS: Record<LlmProvider, Omit<LlmConfig, "provider">> = {
  openai: {
    codeModel: "gpt-4.1",
    titleModel: "gpt-4o",
    responseModel: "gpt-4o",
  },
  openrouter: {
    codeModel: "z-ai/glm-5",
    titleModel: "z-ai/glm-5",
    responseModel: "z-ai/glm-5",
  },
};

const normalizeProvider = (value?: string | null): LlmProvider => {
  const normalized = (value ?? "").toLowerCase();
  if (!normalized || normalized === "openai") {
    return "openai";
  }
  if (normalized === "openrouter") {
    return "openrouter";
  }

  throw new Error(`Unsupported LLM provider: ${value}`);
};

const getOpenRouterHeaders = () => {
  const headers: Record<string, string> = {};
  const referrer = process.env.OPENROUTER_REFERRER;
  const title = process.env.OPENROUTER_TITLE;

  if (referrer) {
    headers["HTTP-Referer"] = referrer;
  }

  if (title) {
    headers["X-Title"] = title;
  }

  return headers;
};

export async function resolveLlmConfig(orgId?: string | null): Promise<LlmConfig> {
  const settings = orgId
    ? await prisma.orgLlmSettings.findUnique({
        where: { orgId },
      })
    : null;

  const provider = normalizeProvider(settings?.provider ?? process.env.LLM_PROVIDER);
  const defaults = DEFAULT_MODELS[provider];

  const codeModel =
    settings?.model ?? process.env.LLM_MODEL ?? defaults.codeModel;

  const titleModel =
    settings?.titleModel ?? process.env.LLM_TITLE_MODEL ?? defaults.titleModel ?? codeModel;

  const responseModel =
    settings?.responseModel ??
    process.env.LLM_RESPONSE_MODEL ??
    defaults.responseModel ??
    codeModel;

  return {
    provider,
    codeModel,
    titleModel,
    responseModel,
  };
}

const buildModel = (
  provider: LlmProvider,
  model: string,
  defaultParameters?: Parameters<typeof openai>[0]["defaultParameters"]
) => {
  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is required when using OpenRouter");
    }

    const baseUrl =
      process.env.OPENROUTER_BASE_URL ?? OPENROUTER_BASE_URL_DEFAULT;

    const openRouterModel = openai({
      model,
      apiKey,
      baseUrl,
      defaultParameters,
    });

    const headers = getOpenRouterHeaders();
    if (Object.keys(headers).length > 0) {
      openRouterModel.headers = headers;
    }

    return openRouterModel;
  }

  const openAiModel = openai({
    model,
    apiKey: process.env.OPENAI_API_KEY,
    defaultParameters,
  });

  return openAiModel;
};

export async function getLlmModels(orgId?: string | null) {
  const config = await resolveLlmConfig(orgId);

  return {
    provider: config.provider,
    code: buildModel(config.provider, config.codeModel, {
      temperature: 0.1,
    }),
    title: buildModel(config.provider, config.titleModel),
    response: buildModel(config.provider, config.responseModel),
  };
}
