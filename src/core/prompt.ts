import {
  InvalidPromptError,
  UnsupportedFunctionalityError,
  type JSONValue,
  type LanguageModelV2CallOptions,
  type LanguageModelV2CallWarning,
  type LanguageModelV2FunctionTool,
  type LanguageModelV2ProviderDefinedTool,
  type LanguageModelV2ToolChoice,
  type LanguageModelV2ToolResultOutput,
  type LanguageModelV3CallOptions,
  type LanguageModelV3FunctionTool,
  type LanguageModelV3ProviderTool,
  type LanguageModelV3ToolChoice,
  type LanguageModelV3ToolResultOutput,
  type SharedV3Warning,
} from "@ai-sdk/provider";
import type { Context, Message, Tool as PiTool, ToolResultMessage } from "@mariozechner/pi-ai";

type PiStreamOptions = {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

export interface PreparedPiCall<TWarning, TToolChoice> {
  context: Context;
  toolChoice?: TToolChoice;
  streamOptions: PiStreamOptions;
  warnings: TWarning[];
}

export function prepareV2Call(
  options: LanguageModelV2CallOptions,
): PreparedPiCall<LanguageModelV2CallWarning, LanguageModelV2ToolChoice> {
  const warnings: LanguageModelV2CallWarning[] = [];
  const tools = selectV2Tools(options.tools, options.toolChoice, warnings);
  const context = convertPromptToContext("v2", options.prompt, tools);

  pushUnsupportedV2Settings(options, warnings);

  return {
    context,
    ...(options.toolChoice ? { toolChoice: options.toolChoice } : {}),
    streamOptions: buildStreamOptions(options.maxOutputTokens, options.temperature, options.abortSignal, options.headers),
    warnings,
  };
}

export function prepareV3Call(
  options: LanguageModelV3CallOptions,
): PreparedPiCall<SharedV3Warning, LanguageModelV3ToolChoice> {
  const warnings: SharedV3Warning[] = [];
  const tools = selectV3Tools(options.tools, options.toolChoice, warnings);
  const context = convertPromptToContext("v3", options.prompt, tools);

  pushUnsupportedV3Settings(options, warnings);

  return {
    context,
    ...(options.toolChoice ? { toolChoice: options.toolChoice } : {}),
    streamOptions: buildStreamOptions(options.maxOutputTokens, options.temperature, options.abortSignal, options.headers),
    warnings,
  };
}

function buildStreamOptions(
  maxTokens: number | undefined,
  temperature: number | undefined,
  signal: AbortSignal | undefined,
  headers: Record<string, string | undefined> | undefined,
): PiStreamOptions {
  const normalizedHeaders = normalizeHeaders(headers);

  return {
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(signal !== undefined ? { signal } : {}),
    ...(normalizedHeaders ? { headers: normalizedHeaders } : {}),
  };
}

function normalizeHeaders(headers: Record<string, string | undefined> | undefined): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const entries = Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function pushUnsupportedV2Settings(
  options: LanguageModelV2CallOptions,
  warnings: LanguageModelV2CallWarning[],
): void {
  const unsupportedSettings: Array<Exclude<keyof LanguageModelV2CallOptions, "prompt">> = [];

  if (options.stopSequences?.length) unsupportedSettings.push("stopSequences");
  if (options.topP !== undefined) unsupportedSettings.push("topP");
  if (options.topK !== undefined) unsupportedSettings.push("topK");
  if (options.presencePenalty !== undefined) unsupportedSettings.push("presencePenalty");
  if (options.frequencyPenalty !== undefined) unsupportedSettings.push("frequencyPenalty");
  if (options.responseFormat?.type === "json") unsupportedSettings.push("responseFormat");
  if (options.seed !== undefined) unsupportedSettings.push("seed");
  if (options.includeRawChunks) unsupportedSettings.push("includeRawChunks");

  for (const setting of unsupportedSettings) {
    warnings.push({
      type: "unsupported-setting",
      setting,
      details: "This adapter currently supports text-first generation, streaming, and tool flow only.",
    });
  }
}

function pushUnsupportedV3Settings(options: LanguageModelV3CallOptions, warnings: SharedV3Warning[]): void {
  const features: string[] = [];

  if (options.stopSequences?.length) features.push("stopSequences");
  if (options.topP !== undefined) features.push("topP");
  if (options.topK !== undefined) features.push("topK");
  if (options.presencePenalty !== undefined) features.push("presencePenalty");
  if (options.frequencyPenalty !== undefined) features.push("frequencyPenalty");
  if (options.responseFormat?.type === "json") features.push("responseFormat");
  if (options.seed !== undefined) features.push("seed");
  if (options.includeRawChunks) features.push("includeRawChunks");

  for (const feature of features) {
    warnings.push({
      type: "unsupported",
      feature,
      details: "This adapter currently supports text-first generation, streaming, and tool flow only.",
    });
  }
}

function selectV2Tools(
  tools: Array<LanguageModelV2FunctionTool | LanguageModelV2ProviderDefinedTool> | undefined,
  toolChoice: LanguageModelV2ToolChoice | undefined,
  warnings: LanguageModelV2CallWarning[],
): PiTool[] | undefined {
  const supportedTools = (tools ?? []).flatMap((tool) => {
    if (tool.type === "provider-defined") {
      warnings.push({
        type: "unsupported-tool",
        tool,
        details: "Provider-defined tools are not supported by this adapter.",
      });
      return [];
    }

    return [toPiTool(tool)];
  });

  return applyToolChoiceSelection(supportedTools, toolChoice);
}

function selectV3Tools(
  tools: Array<LanguageModelV3FunctionTool | LanguageModelV3ProviderTool> | undefined,
  toolChoice: LanguageModelV3ToolChoice | undefined,
  warnings: SharedV3Warning[],
): PiTool[] | undefined {
  const supportedTools = (tools ?? []).flatMap((tool) => {
    if (tool.type === "provider") {
      warnings.push({
        type: "unsupported",
        feature: "provider-tools",
        details: `Provider tool '${tool.name}' is not supported by this adapter.`,
      });
      return [];
    }

    return [toPiTool(tool)];
  });

  return applyToolChoiceSelection(supportedTools, toolChoice);
}

function toPiTool(tool: LanguageModelV2FunctionTool | LanguageModelV3FunctionTool): PiTool {
  return {
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.inputSchema as never,
  };
}

function applyToolChoiceSelection<T extends { name: string }>(
  tools: T[],
  toolChoice:
    | LanguageModelV2ToolChoice
    | LanguageModelV3ToolChoice
    | undefined,
): T[] | undefined {
  if (tools.length === 0 || toolChoice?.type === "none") {
    return undefined;
  }

  if (toolChoice?.type === "tool") {
    const selected = tools.find((tool) => tool.name === toolChoice.toolName);
    return selected ? [selected] : undefined;
  }

  return tools;
}

function convertPromptToContext(
  version: "v2" | "v3",
  prompt: LanguageModelV2CallOptions["prompt"] | LanguageModelV3CallOptions["prompt"],
  tools: PiTool[] | undefined,
): Context {
  const systemPrompts: string[] = [];
  const messages: Message[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system":
        systemPrompts.push(message.content);
        break;
      case "user":
        messages.push({
          role: "user",
          content: convertUserContent(version, message.content),
          timestamp: Date.now(),
        });
        break;
      case "assistant": {
        const converted = convertAssistantMessage(version, message.content);
        if (converted.assistantContent.length > 0) {
          messages.push({
            role: "assistant",
            content: converted.assistantContent,
            api: "unknown",
            provider: "unknown",
            model: "unknown",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: Date.now(),
          });
        }
        messages.push(...converted.toolResults);
        break;
      }
      case "tool":
        messages.push(...convertToolMessage(version, message.content));
        break;
      default: {
        const exhaustive: never = message;
        throw new InvalidPromptError({
          prompt,
          message: `Unsupported prompt message: ${JSON.stringify(exhaustive)}`,
        });
      }
    }
  }

  return {
    ...(systemPrompts.length > 0 ? { systemPrompt: systemPrompts.join("\n\n") } : {}),
    messages,
    ...(tools ? { tools } : {}),
  };
}

function convertUserContent(
  version: "v2" | "v3",
  content: Array<{ type: string; text?: string; mediaType?: string; data?: unknown; url?: string }>,
): string | Array<{ type: "text"; text: string }> {
  const textParts = content.map((part) => {
    if (part.type !== "text") {
      throw unsupportedPromptPart(version, "user", part.type);
    }
    return { type: "text" as const, text: part.text ?? "" };
  });

  if (textParts.length === 0) {
    return "";
  }

  if (textParts.length === 1) {
    return textParts[0]?.text ?? "";
  }

  return textParts;
}

function convertAssistantMessage(
  version: "v2" | "v3",
  content: Array<{ type: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown; output?: unknown }>,
): {
  assistantContent: Array<
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | { type: "toolCall"; id: string; name: string; arguments: Record<string, JSONValue> }
  >;
  toolResults: ToolResultMessage[];
} {
  const assistantContent: Array<
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | { type: "toolCall"; id: string; name: string; arguments: Record<string, JSONValue> }
  > = [];
  const toolResults: ToolResultMessage[] = [];

  for (const part of content) {
    switch (part.type) {
      case "text":
        assistantContent.push({ type: "text", text: part.text ?? "" });
        break;
      case "reasoning":
        assistantContent.push({ type: "thinking", thinking: part.text ?? "" });
        break;
      case "tool-call":
        assistantContent.push({
          type: "toolCall",
          id: part.toolCallId ?? "",
          name: part.toolName ?? "",
          arguments: requireJSONObject(part.input, "assistant.tool-call.input"),
        });
        break;
      case "tool-result":
        toolResults.push(toToolResultMessage(version, {
          toolCallId: part.toolCallId ?? "",
          toolName: part.toolName ?? "",
          output: part.output,
        }));
        break;
      default:
        throw unsupportedPromptPart(version, "assistant", part.type);
    }
  }

  return { assistantContent, toolResults };
}

function convertToolMessage(
  version: "v2" | "v3",
  content: Array<{ type: string; toolCallId?: string; toolName?: string; output?: unknown }>,
): ToolResultMessage[] {
  return content.map((part) => {
    if (part.type !== "tool-result") {
      throw unsupportedPromptPart(version, "tool", part.type);
    }

    return toToolResultMessage(version, {
      toolCallId: part.toolCallId ?? "",
      toolName: part.toolName ?? "",
      output: part.output,
    });
  });
}

function toToolResultMessage(
  version: "v2" | "v3",
  part: { toolCallId: string; toolName: string; output: unknown },
): ToolResultMessage {
  const output = version === "v2"
    ? convertV2ToolResultOutput(part.output as LanguageModelV2ToolResultOutput)
    : convertV3ToolResultOutput(part.output as LanguageModelV3ToolResultOutput);

  return {
    role: "toolResult",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    content: output.content,
    isError: output.isError,
    timestamp: Date.now(),
  };
}

function convertV2ToolResultOutput(output: LanguageModelV2ToolResultOutput): {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
} {
  switch (output.type) {
    case "text":
      return { content: [{ type: "text", text: output.value }], isError: false };
    case "json":
      return { content: [{ type: "text", text: JSON.stringify(output.value) }], isError: false };
    case "error-text":
      return { content: [{ type: "text", text: output.value }], isError: true };
    case "error-json":
      return { content: [{ type: "text", text: JSON.stringify(output.value) }], isError: true };
    case "content":
      return {
        content: output.value.map((part) => {
          if (part.type !== "text") {
            throw new UnsupportedFunctionalityError({
              functionality: "tool result media parts",
              message: "This adapter only supports text tool result content.",
            });
          }
          return { type: "text" as const, text: part.text };
        }),
        isError: false,
      };
    default: {
      const exhaustive: never = output;
      throw new InvalidPromptError({
        prompt: output,
        message: `Unsupported tool result output: ${JSON.stringify(exhaustive)}`,
      });
    }
  }
}

function convertV3ToolResultOutput(output: LanguageModelV3ToolResultOutput): {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
} {
  switch (output.type) {
    case "text":
      return { content: [{ type: "text", text: output.value }], isError: false };
    case "json":
      return { content: [{ type: "text", text: JSON.stringify(output.value) }], isError: false };
    case "error-text":
      return { content: [{ type: "text", text: output.value }], isError: true };
    case "error-json":
      return { content: [{ type: "text", text: JSON.stringify(output.value) }], isError: true };
    case "execution-denied":
      return { content: [{ type: "text", text: output.reason ?? "Tool execution denied." }], isError: true };
    case "content":
      return {
        content: output.value.map((part) => {
          if (part.type !== "text") {
            throw new UnsupportedFunctionalityError({
              functionality: "tool result multimodal content",
              message: "This adapter only supports text tool result content.",
            });
          }
          return { type: "text" as const, text: part.text };
        }),
        isError: false,
      };
    default: {
      const exhaustive: never = output;
      throw new InvalidPromptError({
        prompt: output,
        message: `Unsupported tool result output: ${JSON.stringify(exhaustive)}`,
      });
    }
  }
}

function requireJSONObject(value: unknown, field: string): Record<string, JSONValue> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new InvalidPromptError({
      prompt: value,
      message: `Expected ${field} to be a JSON object.`,
    });
  }

  return value as Record<string, JSONValue>;
}

function unsupportedPromptPart(version: "v2" | "v3", role: string, type: string): UnsupportedFunctionalityError {
  return new UnsupportedFunctionalityError({
    functionality: `${version}:${role}:${type}`,
    message: `Prompt part '${type}' in ${role} messages is not supported by this adapter.`,
  });
}
