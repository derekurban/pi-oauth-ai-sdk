import type { ProviderTransport, TransportCallOptions } from "./shared.js";
import {
  createEmptyAssistantMessage,
  jsonParse,
  mapUsage,
  parseSseEvents,
} from "./shared.js";

const GEMINI_URL = "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
const GEMINI_HEADERS = {
  "User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata": JSON.stringify({
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  }),
};

let toolCallCounter = 0;

type GeminiRequestBody = {
  project: string;
  model: string;
  request: {
    contents: unknown[];
    systemInstruction?: { parts: Array<{ text: string }> };
    generationConfig?: {
      maxOutputTokens?: number;
      temperature?: number;
    };
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description: string;
        parametersJsonSchema: unknown;
      }>;
    }>;
    toolConfig?: {
      functionCallingConfig: {
        mode: "AUTO" | "NONE" | "ANY";
      };
    };
  };
};

export const geminiCliTransport: ProviderTransport = {
  providerId: "google-gemini-cli",
  api: "google-gemini-cli",
  async stream(options) {
    const projectId = typeof options.credentials.projectId === "string" ? options.credentials.projectId : undefined;
    if (!projectId) {
      throw new Error("Gemini CLI OAuth credentials are missing projectId. Re-authenticate and persist the project.");
    }

    const output = createEmptyAssistantMessage("google-gemini-cli", options.providerId, options.modelId);
    const requestBody = buildRequestBody(options, projectId);
    const requestInit: RequestInit = {
      method: "POST",
      headers: buildGeminiHeaders(options),
      body: JSON.stringify(requestBody),
    };
    if (options.prepared.settings.abortSignal) {
      requestInit.signal = options.prepared.settings.abortSignal;
    }

    const response = await options.fetch(GEMINI_URL, requestInit);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Gemini CLI OAuth API error (${response.status}): ${text || response.statusText}`);
    }

    return geminiEventStream(response, output);
  },
};

function buildRequestBody(options: TransportCallOptions, projectId: string): GeminiRequestBody {
  const generationConfig: GeminiRequestBody["request"]["generationConfig"] = {};
  if (options.prepared.settings.maxOutputTokens !== undefined) {
    generationConfig.maxOutputTokens = options.prepared.settings.maxOutputTokens;
  }
  if (options.prepared.settings.temperature !== undefined) {
    generationConfig.temperature = options.prepared.settings.temperature;
  }

  const requestBody: GeminiRequestBody = {
    project: projectId,
    model: options.modelId,
    request: {
      contents: convertGeminiMessages(options.prepared.context.messages),
    },
  };

  if (options.prepared.context.systemPrompt?.trim()) {
    requestBody.request.systemInstruction = {
      parts: [{ text: options.prepared.context.systemPrompt }],
    };
  }

  if (Object.keys(generationConfig).length > 0) {
    requestBody.request.generationConfig = generationConfig;
  }

  if (options.prepared.context.tools?.length) {
    requestBody.request.tools = [{
      functionDeclarations: options.prepared.context.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.inputSchema,
      })),
    }];
    requestBody.request.toolConfig = {
      functionCallingConfig: {
        mode: mapToolChoice(options.prepared.context.toolChoice),
      },
    };
  }

  return requestBody;
}

function buildGeminiHeaders(options: TransportCallOptions): Headers {
  const headers = new Headers(options.prepared.settings.headers);
  headers.set("Authorization", `Bearer ${options.credentials.access}`);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "text/event-stream");
  for (const [key, value] of Object.entries(GEMINI_HEADERS)) {
    headers.set(key, value);
  }
  return headers;
}

function mapToolChoice(
  toolChoice: TransportCallOptions["prepared"]["context"]["toolChoice"],
): "AUTO" | "NONE" | "ANY" {
  if (!toolChoice || toolChoice.type === "auto") {
    return "AUTO";
  }
  if (toolChoice.type === "none") {
    return "NONE";
  }
  if (toolChoice.type === "required" || toolChoice.type === "tool") {
    return "ANY";
  }
  return "AUTO";
}

function convertGeminiMessages(messages: TransportCallOptions["prepared"]["context"]["messages"]): unknown[] {
  const converted: unknown[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;

    if (message.role === "user") {
      const text = typeof message.content === "string"
        ? message.content
        : message.content.map((part) => part.text).join("\n");
      converted.push({
        role: "user",
        parts: [{ text }],
      });
      continue;
    }

    if (message.role === "assistant") {
      converted.push({
        role: "model",
        parts: message.content.map((part) => {
          switch (part.type) {
            case "text":
              return { text: part.text };
            case "thinking":
              return { text: part.thinking };
            case "toolCall":
              return {
                functionCall: {
                  name: part.name,
                  args: part.arguments ?? {},
                  id: part.id,
                },
              };
            default: {
              const exhaustive: never = part;
              return exhaustive;
            }
          }
        }),
      });
      continue;
    }

    const toolMessage = message;
    const responseParts = [{
      functionResponse: {
        name: toolMessage.toolName,
        id: toolMessage.toolCallId,
        response: toolMessage.isError
          ? { error: toolMessage.content.map((part) => part.text).join("\n") }
          : { output: toolMessage.content.map((part) => part.text).join("\n") },
      },
    }];

    while (index + 1 < messages.length && messages[index + 1]?.role === "toolResult") {
      index += 1;
      const nextMessage = messages[index]!;
      if (nextMessage.role !== "toolResult") {
        break;
      }
      responseParts.push({
        functionResponse: {
          name: nextMessage.toolName,
          id: nextMessage.toolCallId,
          response: nextMessage.isError
            ? { error: nextMessage.content.map((part) => part.text).join("\n") }
            : { output: nextMessage.content.map((part) => part.text).join("\n") },
        },
      });
    }

    converted.push({
      role: "user",
      parts: responseParts,
    });
  }

  return converted;
}

async function* geminiEventStream(
  response: Response,
  output: ReturnType<typeof createEmptyAssistantMessage>,
) {
  let currentBlock:
    | { type: "text"; index: number }
    | { type: "thinking"; index: number }
    | undefined;

  yield { type: "start", partial: output } as const;

  for await (const event of parseSseEvents(response)) {
    const payload = jsonParse<Record<string, unknown>>(event.data, "Failed to parse Gemini SSE event");
    const responsePayload = payload.response as Record<string, unknown> | undefined;
    if (!responsePayload) {
      continue;
    }

    const candidates = Array.isArray(responsePayload.candidates) ? responsePayload.candidates : [];
    const candidate = candidates[0] as Record<string, unknown> | undefined;
    const content = candidate?.content as Record<string, unknown> | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];

    for (const part of parts) {
      const record = part as Record<string, unknown>;
      const text = typeof record.text === "string" ? record.text : undefined;
      const isThinking = record.thought === true;
      const functionCall = record.functionCall as Record<string, unknown> | undefined;

      if (text !== undefined) {
        if (!currentBlock || currentBlock.type !== (isThinking ? "thinking" : "text")) {
          if (currentBlock) {
            yield currentBlock.type === "text"
              ? { type: "text_end", contentIndex: currentBlock.index, partial: output } as const
              : { type: "thinking_end", contentIndex: currentBlock.index, partial: output } as const;
          }

          if (isThinking) {
            output.content.push({ type: "thinking", thinking: "" });
            currentBlock = { type: "thinking", index: output.content.length - 1 };
            yield { type: "thinking_start", contentIndex: currentBlock.index, partial: output } as const;
          } else {
            output.content.push({ type: "text", text: "" });
            currentBlock = { type: "text", index: output.content.length - 1 };
            yield { type: "text_start", contentIndex: currentBlock.index, partial: output } as const;
          }
        }

        const block = output.content[currentBlock.index];
        if (block?.type === "text") {
          block.text += text;
          yield { type: "text_delta", contentIndex: currentBlock.index, delta: text, partial: output } as const;
        } else if (block?.type === "thinking") {
          block.thinking += text;
          yield { type: "thinking_delta", contentIndex: currentBlock.index, delta: text, partial: output } as const;
        }
      }

      if (functionCall) {
        if (currentBlock) {
          yield currentBlock.type === "text"
            ? { type: "text_end", contentIndex: currentBlock.index, partial: output } as const
            : { type: "thinking_end", contentIndex: currentBlock.index, partial: output } as const;
          currentBlock = undefined;
        }

        const toolCall = {
          type: "toolCall" as const,
          id: typeof functionCall.id === "string" ? functionCall.id : `tool_${Date.now()}_${++toolCallCounter}`,
          name: String(functionCall.name ?? "tool"),
          arguments: parseGeminiArgs(functionCall.args),
        };

        output.content.push(toolCall);
        const contentIndex = output.content.length - 1;
        yield { type: "toolcall_start", contentIndex, partial: output } as const;
        yield {
          type: "toolcall_delta",
          contentIndex,
          delta: JSON.stringify(toolCall.arguments),
          partial: output,
        } as const;
        yield {
          type: "toolcall_end",
          contentIndex,
          toolCall,
          partial: output,
        } as const;
      }
    }

    const usageMetadata = responsePayload.usageMetadata as Record<string, unknown> | undefined;
    const promptTokens = numberValue(usageMetadata?.promptTokenCount) ?? 0;
    const cacheRead = numberValue(usageMetadata?.cachedContentTokenCount) ?? 0;
    const candidatesTokenCount = numberValue(usageMetadata?.candidatesTokenCount) ?? 0;
    const thoughtsTokenCount = numberValue(usageMetadata?.thoughtsTokenCount) ?? 0;
    const totalTokenCount = numberValue(usageMetadata?.totalTokenCount);

    output.usage = mapUsage({
      input: promptTokens - cacheRead,
      output: candidatesTokenCount + thoughtsTokenCount,
      cacheRead,
      total: totalTokenCount,
    });

    if (typeof responsePayload.responseId === "string") {
      output.responseId = responsePayload.responseId;
    }

    const finishReason = typeof candidate?.finishReason === "string" ? candidate.finishReason : undefined;
    if (finishReason) {
      output.stopReason = mapStopReason(finishReason, output.content.some((part) => part.type === "toolCall"));
    }
  }

  if (currentBlock) {
    yield currentBlock.type === "text"
      ? { type: "text_end", contentIndex: currentBlock.index, partial: output } as const
      : { type: "thinking_end", contentIndex: currentBlock.index, partial: output } as const;
  }

  output.timestamp = Date.now();
  yield { type: "done", reason: output.stopReason, message: output } as const;
}

function parseGeminiArgs(value: unknown): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function mapStopReason(reason: string, hasToolCalls: boolean) {
  switch (reason) {
    case "STOP":
      return hasToolCalls ? "toolUse" : "stop";
    case "MAX_TOKENS":
      return "length";
    default:
      return "error";
  }
}
