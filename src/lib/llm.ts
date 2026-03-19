import "server-only";

import { openai } from "@inngest/agent-kit";

import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";

export type LlmProvider = "openai" | "openrouter";

export interface LlmConfig {
  provider: LlmProvider;
  codeModel: string;
  titleModel: string;
  responseModel: string;
  fallbackCodeModel: string;
}

const OPENROUTER_BASE_URL_DEFAULT = "https://openrouter.ai/api/v1/";
const DEFAULT_MAX_TOKENS = {
  code: 4096,
  title: 256,
  response: 1024,
};

const parseMaxTokens = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
};

const DEFAULT_MODELS: Record<LlmProvider, Omit<LlmConfig, "provider">> = {
  openai: {
    codeModel: "gpt-4.1",
    titleModel: "gpt-4o",
    responseModel: "gpt-4o",
    fallbackCodeModel: "gpt-4.1",
  },
  openrouter: {
    codeModel: "z-ai/glm-5",
    titleModel: "z-ai/glm-5",
    responseModel: "z-ai/glm-5",
    fallbackCodeModel: "openai/gpt-4o",
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

  const fallbackCodeModel =
    process.env.LLM_CODE_FALLBACK_MODEL ??
    defaults.fallbackCodeModel ??
    codeModel;

  return {
    provider,
    codeModel,
    titleModel,
    responseModel,
    fallbackCodeModel,
  };
}

const buildModel = (
  provider: LlmProvider,
  model: string,
  orgOpenRouterApiKey?: string | null,
  defaultParameters?: Parameters<typeof openai>[0]["defaultParameters"]
) => {
  if (provider === "openrouter") {
    const apiKey = orgOpenRouterApiKey ?? process.env.OPENROUTER_API_KEY;
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

// Serialisable data fetched from the DB — safe to return from an Inngest step.
export interface LlmOrgData {
  config: LlmConfig;
  /** Encrypted OpenRouter API key, or null when not configured. */
  encryptedApiKey: string | null;
}

/** Fetches LLM config + org API key from the DB. Returns only JSON-serialisable
 *  data so the result can be memoised inside an Inngest step. */
export async function fetchLlmOrgData(orgId?: string | null): Promise<LlmOrgData> {
  const config = await resolveLlmConfig(orgId);
  const settings = orgId
    ? await prisma.orgLlmSettings.findUnique({
        where: { orgId },
        select: { openrouterApiKey: true },
      })
    : null;
  return { config, encryptedApiKey: settings?.openrouterApiKey ?? null };
}

/** Builds model instances from already-fetched org data. Pure computation — no
 *  DB calls, not serialisable. Call this outside Inngest steps. */
export function buildLlmModels(orgData: LlmOrgData) {
  const { config } = orgData;

  let orgOpenRouterApiKey: string | null = null;
  if (orgData.encryptedApiKey) {
    try {
      orgOpenRouterApiKey = decryptSecret(orgData.encryptedApiKey);
    } catch {
      throw new Error(
        "Failed to decrypt org OpenRouter key. Check OPENROUTER_KEY_ENCRYPTION_KEY."
      );
    }
  }

  const maxTokens = {
    code: parseMaxTokens(
      process.env.LLM_CODE_MAX_TOKENS ?? process.env.LLM_MAX_TOKENS,
      DEFAULT_MAX_TOKENS.code,
    ),
    title: parseMaxTokens(
      process.env.LLM_TITLE_MAX_TOKENS ?? process.env.LLM_MAX_TOKENS,
      DEFAULT_MAX_TOKENS.title,
    ),
    response: parseMaxTokens(
      process.env.LLM_RESPONSE_MAX_TOKENS ?? process.env.LLM_MAX_TOKENS,
      DEFAULT_MAX_TOKENS.response,
    ),
  };

  const fallbackCodeModelName =
    config.fallbackCodeModel && config.fallbackCodeModel !== config.codeModel
      ? config.fallbackCodeModel
      : null;

  return {
    provider: config.provider,
    modelNames: {
      code: config.codeModel,
      title: config.titleModel,
      response: config.responseModel,
      codeFallback: fallbackCodeModelName,
    },
    code: buildModel(config.provider, config.codeModel, orgOpenRouterApiKey, {
      temperature: 0.1,
      max_tokens: maxTokens.code,
    } as Parameters<typeof buildModel>[3]),
    title: buildModel(config.provider, config.titleModel, orgOpenRouterApiKey, {
      max_tokens: maxTokens.title,
    } as Parameters<typeof buildModel>[3]),
    response: buildModel(config.provider, config.responseModel, orgOpenRouterApiKey, {
      max_tokens: maxTokens.response,
    } as Parameters<typeof buildModel>[3]),
    codeFallback: fallbackCodeModelName
      ? buildModel(config.provider, fallbackCodeModelName, orgOpenRouterApiKey, {
          temperature: 0.1,
          max_tokens: maxTokens.code,
        } as Parameters<typeof buildModel>[3])
      : null,
  };
}

/** Convenience wrapper — use only where Inngest memoisation is not needed. */
export async function getLlmModels(orgId?: string | null) {
  const orgData = await fetchLlmOrgData(orgId);
  return buildLlmModels(orgData);
}
