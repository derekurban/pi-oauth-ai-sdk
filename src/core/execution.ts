import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  SharedV3Warning,
} from "@ai-sdk/provider";
import { LoadAPIKeyError } from "@ai-sdk/provider";

import { OAuthAuthStore } from "../auth/store.js";
import { anthropicTransport } from "../providers/anthropic.js";
import { geminiCliTransport } from "../providers/google-gemini-cli.js";
import { openAICodexTransport } from "../providers/openai-codex.js";
import type { ProviderTransport } from "../providers/shared.js";
import type { OAuthProviderId } from "../types.js";
import { prepareRuntimeCall, prepareRuntimeCallV2 } from "./prompt.js";
import { toGenerateResult, toGenerateResultV2 } from "./result.js";
import { toLanguageModelV2Stream, toLanguageModelV3Stream } from "./stream.js";
import type { PreparedRuntimeCall, RuntimeAssistantMessage, RuntimeStreamEvent } from "./runtime-types.js";

type CreateLanguageModelOptions = {
  providerId: OAuthProviderId;
  modelId: string;
  authStore: OAuthAuthStore;
  fetch?: typeof globalThis.fetch;
};

const transportByProviderId: Record<OAuthProviderId, ProviderTransport> = {
  anthropic: anthropicTransport,
  "google-gemini-cli": geminiCliTransport,
  "openai-codex": openAICodexTransport,
};

export function createLanguageModel(options: CreateLanguageModelOptions): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: `ai-sdk-oauth-providers/${options.providerId}`,
    modelId: options.modelId,
    supportedUrls: {},
    async doGenerate(callOptions: LanguageModelV3CallOptions) {
      const prepared = prepareRuntimeCall(callOptions);
      applyProviderWarningsV3(options.providerId, prepared);
      const { message, warnings } = await executeGenerate(options, prepared);
      return toGenerateResult(message, warnings);
    },
    async doStream(callOptions: LanguageModelV3CallOptions) {
      const prepared = prepareRuntimeCall(callOptions);
      applyProviderWarningsV3(options.providerId, prepared);
      const { source, warnings } = await executeStream(options, prepared);

      return {
        stream: toLanguageModelV3Stream(source, warnings),
      };
    },
  };
}

export function createLanguageModelV2(options: CreateLanguageModelOptions): LanguageModelV2 {
  return {
    specificationVersion: "v2",
    provider: `ai-sdk-oauth-providers/${options.providerId}`,
    modelId: options.modelId,
    supportedUrls: {},
    async doGenerate(callOptions: LanguageModelV2CallOptions) {
      const prepared = prepareRuntimeCallV2(callOptions);
      applyProviderWarningsV2(options.providerId, prepared);
      const { message, warnings } = await executeGenerate(options, prepared);
      return toGenerateResultV2(message, warnings);
    },
    async doStream(callOptions: LanguageModelV2CallOptions) {
      const prepared = prepareRuntimeCallV2(callOptions);
      applyProviderWarningsV2(options.providerId, prepared);
      const { source, warnings } = await executeStream(options, prepared);

      return {
        stream: toLanguageModelV2Stream(source, warnings),
      };
    },
  };
}

async function executeGenerate<TWarning>(
  options: CreateLanguageModelOptions,
  prepared: PreparedRuntimeCall<TWarning>,
): Promise<{ message: RuntimeAssistantMessage; warnings: TWarning[] }> {
  const { source, warnings } = await executeStream(options, prepared);
  let finalMessage: RuntimeAssistantMessage | undefined;

  for await (const event of source) {
    if (event.type === "done") {
      finalMessage = event.message;
      break;
    }

    if (event.type === "error") {
      throw new Error(event.error.responseId ?? "OAuth provider call failed");
    }
  }

  if (!finalMessage) {
    throw new Error("OAuth provider call completed without a final message");
  }

  return { message: finalMessage, warnings };
}

async function executeStream<TWarning>(
  options: CreateLanguageModelOptions,
  prepared: PreparedRuntimeCall<TWarning>,
): Promise<{ source: AsyncIterable<RuntimeStreamEvent>; warnings: TWarning[] }> {
  const warnings = [...prepared.warnings];
  const transport = transportByProviderId[options.providerId];
  const credentials = await loadCredentials(options.authStore, options.providerId);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const source = await transport.stream({
    providerId: options.providerId,
    modelId: options.modelId,
    prepared,
    credentials,
    fetch: fetchImpl,
  });

  return { source, warnings };
}

function applyProviderWarningsV2(
  providerId: OAuthProviderId,
  prepared: PreparedRuntimeCall<LanguageModelV2CallWarning>,
): void {
  if (providerId === "openai-codex" && prepared.settings.temperature !== undefined) {
    prepared.warnings.push({
      type: "unsupported-setting",
      setting: "temperature",
      details: "OpenAI Codex OAuth currently ignores temperature and always uses the backend default.",
    });
  }

  if (
    providerId === "google-gemini-cli"
    && prepared.context.tools?.length
    && (prepared.context.toolChoice?.type === "required" || prepared.context.toolChoice?.type === "tool")
  ) {
    prepared.warnings.push({
      type: "unsupported-setting",
      setting: "toolChoice",
      details: "Gemini CLI OAuth only supports auto, none, or any tool selection. Falling back to ANY.",
    });
  }
}

function applyProviderWarningsV3(
  providerId: OAuthProviderId,
  prepared: PreparedRuntimeCall<SharedV3Warning>,
): void {
  if (providerId === "openai-codex" && prepared.settings.temperature !== undefined) {
    prepared.warnings.push({
      type: "unsupported",
      feature: "temperature",
      details: "OpenAI Codex OAuth currently ignores temperature and always uses the backend default.",
    });
  }

  if (
    providerId === "google-gemini-cli"
    && prepared.context.tools?.length
    && (prepared.context.toolChoice?.type === "required" || prepared.context.toolChoice?.type === "tool")
  ) {
    prepared.warnings.push({
      type: "unsupported",
      feature: "toolChoice",
      details: "Gemini CLI OAuth only supports auto, none, or any tool selection. Falling back to ANY.",
    });
  }
}

async function loadCredentials(authStore: OAuthAuthStore, providerId: OAuthProviderId) {
  try {
    return await authStore.getCredentials(providerId);
  } catch (error) {
    throw new LoadAPIKeyError({
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
