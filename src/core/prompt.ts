import {
  InvalidPromptError,
  UnsupportedFunctionalityError,
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

import type {
  PreparedRuntimeCall,
  RuntimeAssistantContent,
  RuntimeCallSettings,
  RuntimeContext,
  RuntimeResponseFormat,
  RuntimeToolChoice,
  RuntimeToolDefinition,
  RuntimeToolResultMessage,
  RuntimeUserTextPart,
} from "./runtime-types.js";

type SupportedCallOptions = LanguageModelV2CallOptions | LanguageModelV3CallOptions;

type PromptVersion = "v2" | "v3";

export function prepareRuntimeCall(options: LanguageModelV3CallOptions): PreparedRuntimeCall<SharedV3Warning> {
  const warnings: SharedV3Warning[] = [];
  const tools = selectV3Tools(options.tools, warnings);
  const context = convertPromptToContext(
    "v3",
    options.prompt,
    tools,
    options.toolChoice ? mapToolChoice(options.toolChoice) : undefined,
    buildResponseFormatV3(options.responseFormat, warnings),
  );
  const settings = buildRuntimeCallSettings(options);

  pushUnsupportedWarningsV3(options, warnings);

  return {
    context,
    settings,
    warnings,
  };
}

export function prepareRuntimeCallV2(options: LanguageModelV2CallOptions): PreparedRuntimeCall<LanguageModelV2CallWarning> {
  const warnings: LanguageModelV2CallWarning[] = [];
  const tools = selectV2Tools(options.tools, warnings);
  const context = convertPromptToContext(
    "v2",
    options.prompt,
    tools,
    options.toolChoice ? mapToolChoice(options.toolChoice) : undefined,
    buildResponseFormatV2(options.responseFormat, warnings),
  );
  const settings = buildRuntimeCallSettings(options);

  pushUnsupportedWarningsV2(options, warnings);

  return {
    context,
    settings,
    warnings,
  };
}

function buildRuntimeCallSettings(options: SupportedCallOptions): RuntimeCallSettings {
  const headers = normalizeHeaders(options.headers);

  return {
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.abortSignal !== undefined ? { abortSignal: options.abortSignal } : {}),
    ...(headers ? { headers } : {}),
  };
}

function normalizeHeaders(headers: Record<string, string | undefined> | undefined): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const entries = Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function pushUnsupportedWarningsV2(
  options: LanguageModelV2CallOptions,
  warnings: LanguageModelV2CallWarning[],
): void {
  const settings: Array<Omit<keyof LanguageModelV2CallOptions, "prompt">> = [];

  if (options.stopSequences?.length) settings.push("stopSequences");
  if (options.topP !== undefined) settings.push("topP");
  if (options.topK !== undefined) settings.push("topK");
  if (options.presencePenalty !== undefined) settings.push("presencePenalty");
  if (options.frequencyPenalty !== undefined) settings.push("frequencyPenalty");
  if (options.seed !== undefined) settings.push("seed");
  if (options.includeRawChunks) settings.push("includeRawChunks");

  for (const setting of settings) {
    warnings.push({
      type: "unsupported-setting",
      setting,
      details: "This package currently supports text generation, streaming, tool calling, and JSON compatibility mode only.",
    });
  }
}

function pushUnsupportedWarningsV3(options: LanguageModelV3CallOptions, warnings: SharedV3Warning[]): void {
  const features: string[] = [];

  if (options.stopSequences?.length) features.push("stopSequences");
  if (options.topP !== undefined) features.push("topP");
  if (options.topK !== undefined) features.push("topK");
  if (options.presencePenalty !== undefined) features.push("presencePenalty");
  if (options.frequencyPenalty !== undefined) features.push("frequencyPenalty");
  if (options.seed !== undefined) features.push("seed");
  if (options.includeRawChunks) features.push("includeRawChunks");

  for (const feature of features) {
    warnings.push({
      type: "unsupported",
      feature,
      details: "This package currently supports text generation, streaming, tool calling, and JSON compatibility mode only.",
    });
  }
}

function selectV2Tools(
  tools: Array<LanguageModelV2FunctionTool | LanguageModelV2ProviderDefinedTool> | undefined,
  warnings: LanguageModelV2CallWarning[],
): RuntimeToolDefinition[] | undefined {
  const supportedTools = (tools ?? []).flatMap((tool) => {
    if (tool.type === "provider-defined") {
      warnings.push({
        type: "unsupported-tool",
        tool,
        details: `Provider-defined tool '${tool.id}' is not supported by this package.`,
      });
      return [];
    }

    return [{
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
    }];
  });

  return supportedTools.length > 0 ? supportedTools : undefined;
}

function selectV3Tools(
  tools: Array<LanguageModelV3FunctionTool | LanguageModelV3ProviderTool> | undefined,
  warnings: SharedV3Warning[],
): RuntimeToolDefinition[] | undefined {
  const supportedTools = (tools ?? []).flatMap((tool) => {
    if (tool.type === "provider") {
      warnings.push({
        type: "unsupported",
        feature: "provider-tools",
        details: `Provider tool '${tool.name}' is not supported by this package.`,
      });
      return [];
    }

    return [{
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
    }];
  });

  return supportedTools.length > 0 ? supportedTools : undefined;
}

function convertPromptToContext(
  version: PromptVersion,
  prompt: LanguageModelV2CallOptions["prompt"] | LanguageModelV3CallOptions["prompt"],
  tools: RuntimeToolDefinition[] | undefined,
  toolChoice: RuntimeToolChoice | undefined,
  responseFormat: RuntimeResponseFormat,
): RuntimeContext {
  const systemPrompts: string[] = [];
  const messages: RuntimeContext["messages"] = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system":
        systemPrompts.push(message.content);
        break;
      case "user":
        messages.push({
          role: "user",
          content: convertUserContent(version, message.content),
        });
        break;
      case "assistant": {
        const converted = convertAssistantContent(version, message.content);
        if (converted.assistantContent.length > 0) {
          messages.push({
            role: "assistant",
            content: converted.assistantContent,
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

  if (responseFormat.type === "json") {
    systemPrompts.push(responseFormat.instruction);
  }

  return {
    ...(systemPrompts.length > 0 ? { systemPrompt: systemPrompts.join("\n\n") } : {}),
    messages,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { toolChoice } : {}),
    responseFormat,
  };
}

function buildResponseFormatV2(
  responseFormat: LanguageModelV2CallOptions["responseFormat"],
  warnings: LanguageModelV2CallWarning[],
): RuntimeResponseFormat {
  if (!responseFormat || responseFormat.type === "text") {
    return { type: "text" };
  }

  warnings.push({
    type: "other",
    message: "Using compatibility JSON mode instead of a provider-native JSON schema contract.",
  });

  return {
    type: "json",
    instruction: buildJsonCompatibilityInstruction(responseFormat),
    ...(responseFormat.schema ? { schema: responseFormat.schema } : {}),
  };
}

function buildResponseFormatV3(
  responseFormat: LanguageModelV3CallOptions["responseFormat"],
  warnings: SharedV3Warning[],
): RuntimeResponseFormat {
  if (!responseFormat || responseFormat.type === "text") {
    return { type: "text" };
  }

  warnings.push({
    type: "compatibility",
    feature: "native-json-schema",
    details: "Using compatibility JSON mode instead of a provider-native JSON schema contract.",
  });

  return {
    type: "json",
    instruction: buildJsonCompatibilityInstruction(responseFormat),
    ...(responseFormat.schema ? { schema: responseFormat.schema } : {}),
  };
}

function buildJsonCompatibilityInstruction(
  responseFormat: NonNullable<LanguageModelV2CallOptions["responseFormat"] | LanguageModelV3CallOptions["responseFormat"]>,
): string {
  const schemaDescription = responseFormat.type === "json" && responseFormat.schema
    ? `Schema: ${JSON.stringify(responseFormat.schema)}`
    : "";
  const nameDescription = responseFormat.type === "json" && responseFormat.name
    ? `Name: ${responseFormat.name}`
    : "";
  const outputDescription = responseFormat.type === "json" && responseFormat.description
    ? `Description: ${responseFormat.description}`
    : "";

  return [
    "Return only valid JSON.",
    "Do not wrap the JSON in markdown fences or prose.",
    nameDescription,
    outputDescription,
    schemaDescription,
  ].filter(Boolean).join("\n");
}

function mapToolChoice(toolChoice: LanguageModelV2ToolChoice | LanguageModelV3ToolChoice): RuntimeToolChoice {
  switch (toolChoice.type) {
    case "auto":
      return { type: "auto" };
    case "none":
      return { type: "none" };
    case "required":
      return { type: "required" };
    case "tool":
      return { type: "tool", toolName: toolChoice.toolName };
    default: {
      const exhaustive: never = toolChoice;
      return exhaustive;
    }
  }
}

function convertUserContent(
  version: PromptVersion,
  content: Array<{ type: string; text?: string }>,
): string | RuntimeUserTextPart[] {
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

function convertAssistantContent(
  version: PromptVersion,
  content: Array<{ type: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown; output?: unknown }>,
): {
  assistantContent: RuntimeAssistantContent[];
  toolResults: RuntimeToolResultMessage[];
} {
  const assistantContent: RuntimeAssistantContent[] = [];
  const toolResults: RuntimeToolResultMessage[] = [];

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
  version: PromptVersion,
  content: Array<{ type: string; toolCallId?: string; toolName?: string; output?: unknown }>,
): RuntimeToolResultMessage[] {
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
  version: PromptVersion,
  part: {
    toolCallId: string;
    toolName: string;
    output: unknown;
  },
): RuntimeToolResultMessage {
  const output = version === "v2"
    ? convertToolResultOutputV2(part.output as LanguageModelV2ToolResultOutput)
    : convertToolResultOutputV3(part.output as LanguageModelV3ToolResultOutput);

  return {
    role: "toolResult",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    content: output.content,
    isError: output.isError,
  };
}

function convertToolResultOutputV2(output: LanguageModelV2ToolResultOutput): {
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
              message: "This package only supports text tool result content.",
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

function convertToolResultOutputV3(output: LanguageModelV3ToolResultOutput): {
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
              message: "This package only supports text tool result content.",
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

function requireJSONObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new InvalidPromptError({
      prompt: value,
      message: `Expected ${field} to be a JSON object.`,
    });
  }

  return value as Record<string, unknown>;
}

function unsupportedPromptPart(version: PromptVersion, role: string, type: string): UnsupportedFunctionalityError {
  return new UnsupportedFunctionalityError({
    functionality: `languageModel${version.toUpperCase()}:${role}:${type}`,
    message: `Prompt part '${type}' in ${role} messages is not supported by this package.`,
  });
}
