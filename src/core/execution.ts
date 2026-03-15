import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  SharedV3Warning,
} from "@ai-sdk/provider";
import { LoadAPIKeyError } from "@ai-sdk/provider";
import { complete, stream, type Api } from "@mariozechner/pi-ai";

import { PiOAuthAuthStore } from "../auth/store.js";
import type { PiOAuthProviderId } from "../types.js";
import { runWithFetchOverride } from "./fetch-override.js";
import { resolvePiModel } from "./model-resolution.js";
import { prepareV2Call, prepareV3Call, type PreparedPiCall } from "./prompt.js";
import { toV2GenerateResult, toV3GenerateResult } from "./result.js";
import { toV2Stream, toV3Stream } from "./stream.js";

type CreateLanguageModelOptions = {
  providerId: PiOAuthProviderId;
  modelId: string;
  authStore: PiOAuthAuthStore;
  fetch?: typeof globalThis.fetch;
};

export function createLanguageModelV2(options: CreateLanguageModelOptions): LanguageModelV2 {
  return {
    specificationVersion: "v2",
    provider: `pi-oauth-ai-sdk/${options.providerId}`,
    modelId: options.modelId,
    supportedUrls: {},
    async doGenerate(callOptions: LanguageModelV2CallOptions) {
      const prepared = prepareV2Call(callOptions);
      const { message, warnings } = await executeCompleteRequest(options, prepared, "v2");

      return toV2GenerateResult(message, warnings);
    },
    async doStream(callOptions: LanguageModelV2CallOptions) {
      const prepared = prepareV2Call(callOptions);
      const { source, warnings } = await executeStreamRequest(options, prepared, "v2");

      return {
        stream: toV2Stream(source, warnings),
      };
    },
  };
}

export function createLanguageModelV3(options: CreateLanguageModelOptions): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: `pi-oauth-ai-sdk/${options.providerId}`,
    modelId: options.modelId,
    supportedUrls: {},
    async doGenerate(callOptions: LanguageModelV3CallOptions) {
      const prepared = prepareV3Call(callOptions);
      const { message, warnings } = await executeCompleteRequest(options, prepared, "v3");

      return toV3GenerateResult(message, warnings);
    },
    async doStream(callOptions: LanguageModelV3CallOptions) {
      const prepared = prepareV3Call(callOptions);
      const { source, warnings } = await executeStreamRequest(options, prepared, "v3");

      return {
        stream: toV3Stream(source, warnings),
      };
    },
  };
}

async function executeCompleteRequest<TWarning>(
  options: CreateLanguageModelOptions,
  prepared: PreparedPiCall<TWarning, unknown>,
  warningMode: "v2" | "v3",
): Promise<{ message: Awaited<ReturnType<typeof complete>>; warnings: TWarning[] }> {
  const resolved = await resolveRuntimeRequest(options, prepared, warningMode);
  const message = await runWithFetchOverride(options.fetch, () =>
    complete(resolved.model, resolved.context, resolved.streamOptions),
  );

  return {
    message,
    warnings: resolved.warnings,
  };
}

async function executeStreamRequest<TWarning>(
  options: CreateLanguageModelOptions,
  prepared: PreparedPiCall<TWarning, unknown>,
  warningMode: "v2" | "v3",
): Promise<{ source: ReturnType<typeof stream>; warnings: TWarning[] }> {
  const resolved = await resolveRuntimeRequest(options, prepared, warningMode);
  const source = await runWithFetchOverride(options.fetch, async () =>
    stream(resolved.model, resolved.context, resolved.streamOptions),
  );

  return {
    source,
    warnings: resolved.warnings,
  };
}

async function resolveRuntimeRequest<TWarning>(
  options: CreateLanguageModelOptions,
  prepared: PreparedPiCall<TWarning, unknown>,
  warningMode: "v2" | "v3",
): Promise<{
  model: ReturnType<typeof resolvePiModel>;
  context: PreparedPiCall<TWarning, unknown>["context"];
  streamOptions: Record<string, unknown>;
  warnings: TWarning[];
}> {
  const { apiKey, credentials } = await loadApiKey(options.authStore, options.providerId);
  const model = resolvePiModel(options.providerId, options.modelId, credentials);
  const choice = mapToolChoice(model.api, prepared.toolChoice, prepared.warnings, warningMode);

  return {
    model,
    context: prepared.context,
    streamOptions: {
      ...prepared.streamOptions,
      ...choice,
      apiKey,
    },
    warnings: prepared.warnings,
  };
}

async function loadApiKey(authStore: PiOAuthAuthStore, providerId: PiOAuthProviderId) {
  try {
    return await authStore.resolveApiKey(providerId);
  } catch (error) {
    throw new LoadAPIKeyError({
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function mapToolChoice<TWarning>(
  api: Api,
  toolChoice: unknown,
  warnings: TWarning[],
  warningMode: "v2" | "v3",
): Record<string, unknown> {
  if (!toolChoice || typeof toolChoice !== "object" || !("type" in toolChoice)) {
    return {};
  }

  switch (api) {
    case "anthropic-messages":
      return mapAnthropicToolChoice(toolChoice as { type: string; toolName?: string });
    case "openai-completions":
      return mapOpenAIToolChoice(toolChoice as { type: string; toolName?: string });
    case "google-gemini-cli":
      return mapGoogleToolChoice(toolChoice as { type: string }, warnings, warningMode);
    case "openai-codex-responses":
      pushWarning(warnings, warningMode, "toolChoice", "Per-call tool choice is not supported for OpenAI Codex models.");
      return {};
    default:
      return {};
  }
}

function mapAnthropicToolChoice(toolChoice: { type: string; toolName?: string }): Record<string, unknown> {
  switch (toolChoice.type) {
    case "auto":
      return { toolChoice: "auto" };
    case "none":
      return { toolChoice: "none" };
    case "required":
      return { toolChoice: "any" };
    case "tool":
      return { toolChoice: { type: "tool", name: toolChoice.toolName ?? "" } };
    default:
      return {};
  }
}

function mapOpenAIToolChoice(toolChoice: { type: string; toolName?: string }): Record<string, unknown> {
  switch (toolChoice.type) {
    case "auto":
      return { toolChoice: "auto" };
    case "none":
      return { toolChoice: "none" };
    case "required":
      return { toolChoice: "required" };
    case "tool":
      return {
        toolChoice: {
          type: "function",
          function: { name: toolChoice.toolName ?? "" },
        },
      };
    default:
      return {};
  }
}

function mapGoogleToolChoice<TWarning>(
  toolChoice: { type: string },
  warnings: TWarning[],
  warningMode: "v2" | "v3",
): Record<string, unknown> {
  switch (toolChoice.type) {
    case "auto":
      return { toolChoice: "auto" };
    case "none":
      return { toolChoice: "none" };
    case "required":
    case "tool":
      pushWarning(
        warnings,
        warningMode,
        "toolChoice",
        "Google Cloud Code Assist backends only support auto, none, or any tool selection.",
      );
      return { toolChoice: "any" };
    default:
      return {};
  }
}

function pushWarning<TWarning>(
  warnings: TWarning[],
  warningMode: "v2" | "v3",
  feature: string,
  details: string,
): void {
  if (warningMode === "v2") {
    (warnings as LanguageModelV2CallWarning[]).push({
      type: "unsupported-setting",
      setting: "tools",
      details,
    });
    return;
  }

  (warnings as SharedV3Warning[]).push({
    type: "unsupported",
    feature,
    details,
  });
}
