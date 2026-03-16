import type { JSONValue } from "@ai-sdk/provider";

import type { ProviderTransport, TransportCallOptions } from "./shared.js";
import {
  createEmptyAssistantMessage,
  jsonParse,
  mapUsage,
  parseSseEvents,
  sanitizeIdentifier,
} from "./shared.js";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const DEFAULT_INSTRUCTIONS = "You are a helpful assistant.";

type CodexRequestBody = {
  model: string;
  store: boolean;
  stream: boolean;
  instructions: string;
  input: unknown[];
  tools?: unknown[];
  tool_choice?: "auto";
  parallel_tool_calls?: boolean;
  max_output_tokens?: number;
  text?: {
    verbosity: "medium";
  };
};

export const openAICodexTransport: ProviderTransport = {
  providerId: "openai-codex",
  api: "openai-codex-responses",
  async stream(options) {
    const output = createEmptyAssistantMessage("openai-codex-responses", options.providerId, options.modelId);
    const requestBody = buildRequestBody(options);
    const requestInit: RequestInit = {
      method: "POST",
      headers: buildCodexHeaders(options),
      body: JSON.stringify(requestBody),
    };
    if (options.prepared.settings.abortSignal) {
      requestInit.signal = options.prepared.settings.abortSignal;
    }

    const response = await options.fetch(resolveCodexUrl(), requestInit);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`OpenAI Codex API error (${response.status}): ${text || response.statusText}`);
    }

    return codexEventStream(response, options, output);
  },
};

function buildRequestBody(options: TransportCallOptions): CodexRequestBody {
  const body: CodexRequestBody = {
    model: options.modelId,
    store: false,
    stream: true,
    instructions: options.prepared.context.systemPrompt?.trim() || DEFAULT_INSTRUCTIONS,
    input: convertCodexMessages(options.prepared.context.messages),
    text: { verbosity: "medium" },
  };

  if (options.prepared.context.tools?.length) {
    body.tools = options.prepared.context.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false,
    }));
    if (options.prepared.context.toolChoice?.type !== "none") {
      body.tool_choice = "auto";
      body.parallel_tool_calls = true;
    }
  }

  if (options.prepared.settings.maxOutputTokens !== undefined) {
    body.max_output_tokens = options.prepared.settings.maxOutputTokens;
  }

  return body;
}

function convertCodexMessages(messages: TransportCallOptions["prepared"]["context"]["messages"]): unknown[] {
  const converted: unknown[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const text = typeof message.content === "string"
        ? message.content
        : message.content.map((part) => part.text).join("\n");
      converted.push({
        role: "user",
        content: [{ type: "input_text", text }],
      });
      continue;
    }

    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type === "text") {
          converted.push({
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: part.text, annotations: [] }],
            id: sanitizeIdentifier(`msg_${part.text.slice(0, 16)}`, "msg"),
          });
          continue;
        }

        if (part.type === "thinking") {
          converted.push({
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: part.thinking, annotations: [] }],
            id: sanitizeIdentifier(`think_${part.thinking.slice(0, 16)}`, "msg"),
          });
          continue;
        }

        converted.push({
          type: "function_call",
          call_id: sanitizeIdentifier(part.id, "call"),
          id: sanitizeIdentifier(`fc_${part.id}`, "fc"),
          name: part.name,
          arguments: JSON.stringify(part.arguments ?? {}),
        });
      }
      continue;
    }

    converted.push({
      type: "function_call_output",
      call_id: sanitizeIdentifier(message.toolCallId, "call"),
      output: message.content.map((part) => part.text).join("\n"),
    });
  }

  return converted;
}

function buildCodexHeaders(options: TransportCallOptions): Headers {
  const headers = new Headers(options.prepared.settings.headers);
  headers.set("Authorization", `Bearer ${options.credentials.access}`);
  headers.set("chatgpt-account-id", typeof options.credentials.accountId === "string" ? options.credentials.accountId : "");
  headers.set("originator", "pi");
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");
  headers.set("user-agent", "ai-sdk-oauth-providers/0.1.0");
  return headers;
}

function resolveCodexUrl(): string {
  return `${DEFAULT_CODEX_BASE_URL}/codex/responses`;
}

async function* codexEventStream(
  response: Response,
  options: TransportCallOptions,
  output: ReturnType<typeof createEmptyAssistantMessage>,
) {
  let current: { type: "thinking" | "text" | "toolCall"; index: number; partialJson?: string } | undefined;
  yield { type: "start", partial: output } as const;

  for await (const event of parseSseEvents(response)) {
    const payload = jsonParse<Record<string, unknown>>(event.data, "Failed to parse OpenAI Codex SSE event");
    const type = typeof payload.type === "string" ? payload.type : undefined;
    if (!type) {
      continue;
    }

    switch (type) {
      case "response.output_item.added": {
        const item = payload.item as Record<string, unknown> | undefined;
        const itemType = typeof item?.type === "string" ? item.type : undefined;
        if (itemType === "reasoning") {
          output.content.push({ type: "thinking", thinking: "" });
          current = { type: "thinking", index: output.content.length - 1 };
          yield { type: "thinking_start", contentIndex: current.index, partial: output } as const;
        } else if (itemType === "message") {
          output.content.push({ type: "text", text: "" });
          current = { type: "text", index: output.content.length - 1 };
          yield { type: "text_start", contentIndex: current.index, partial: output } as const;
        } else if (itemType === "function_call") {
          const callId = sanitizeIdentifier(String(item?.call_id ?? "call"), "call");
          const itemId = sanitizeIdentifier(String(item?.id ?? `fc_${callId}`), "fc");
          const initialJson = typeof item?.arguments === "string" ? item.arguments : "{}";
          output.content.push({
            type: "toolCall",
            id: `${callId}|${itemId}`,
            name: String(item?.name ?? "tool"),
            arguments: parseJsonObject(initialJson),
          });
          current = { type: "toolCall", index: output.content.length - 1, partialJson: initialJson };
          yield { type: "toolcall_start", contentIndex: current.index, partial: output } as const;
        }
        break;
      }
      case "response.reasoning_summary_text.delta":
        if (current?.type === "thinking") {
          const delta = String(payload.delta ?? "");
          const block = output.content[current.index];
          if (block?.type === "thinking") {
            block.thinking += delta;
            yield { type: "thinking_delta", contentIndex: current.index, delta, partial: output } as const;
          }
        }
        break;
      case "response.output_text.delta":
      case "response.refusal.delta":
        if (current?.type === "text") {
          const delta = String(payload.delta ?? "");
          const block = output.content[current.index];
          if (block?.type === "text") {
            block.text += delta;
            yield { type: "text_delta", contentIndex: current.index, delta, partial: output } as const;
          }
        }
        break;
      case "response.function_call_arguments.delta":
        if (current?.type === "toolCall") {
          const delta = String(payload.delta ?? "");
          const block = output.content[current.index];
          if (block?.type === "toolCall") {
            current.partialJson = `${current.partialJson ?? ""}${delta}`;
            block.arguments = parseJsonObject(current.partialJson);
            yield { type: "toolcall_delta", contentIndex: current.index, delta, partial: output } as const;
          }
        }
        break;
      case "response.output_item.done": {
        const item = payload.item as Record<string, unknown> | undefined;
        const itemType = typeof item?.type === "string" ? item.type : undefined;
        if (itemType === "reasoning" && current?.type === "thinking") {
          const block = output.content[current.index];
          if (block?.type === "thinking") {
            const summary = Array.isArray(item?.summary)
              ? item.summary.map((entry) => String((entry as Record<string, unknown>).text ?? "")).join("\n\n")
              : block.thinking;
            block.thinking = summary;
            yield { type: "thinking_end", contentIndex: current.index, partial: output } as const;
          }
          current = undefined;
        } else if (itemType === "message" && current?.type === "text") {
          const block = output.content[current.index];
          if (block?.type === "text") {
            const content = Array.isArray(item?.content)
              ? item.content
                .map((entry) => {
                  const record = entry as Record<string, unknown>;
                  if (record.type === "output_text") return String(record.text ?? "");
                  if (record.type === "refusal") return String(record.refusal ?? "");
                  return "";
                })
                .join("")
              : block.text;
            block.text = content;
            yield { type: "text_end", contentIndex: current.index, partial: output } as const;
          }
          current = undefined;
        } else if (itemType === "function_call" && current?.type === "toolCall") {
          const block = output.content[current.index];
          if (block?.type === "toolCall") {
            const finalJson = typeof item?.arguments === "string" ? item.arguments : current.partialJson ?? "{}";
            block.arguments = parseJsonObject(finalJson);
            yield {
              type: "toolcall_end",
              contentIndex: current.index,
              toolCall: block,
              partial: output,
            } as const;
          }
          current = undefined;
        }
        break;
      }
      case "response.completed":
      case "response.done":
      case "response.incomplete": {
        const responsePayload = payload.response as Record<string, unknown> | undefined;
        const usage = responsePayload?.usage as Record<string, unknown> | undefined;
        const usageDetails = usage?.input_tokens_details as Record<string, unknown> | undefined;
        const cachedTokens = typeof usageDetails?.cached_tokens === "number" ? usageDetails.cached_tokens : 0;
        if (typeof responsePayload?.id === "string") {
          output.responseId = responsePayload.id;
        }
        output.usage = mapUsage({
          input: typeof usage?.input_tokens === "number" ? usage.input_tokens - cachedTokens : 0,
          output: typeof usage?.output_tokens === "number" ? usage.output_tokens : 0,
          cacheRead: cachedTokens,
          total: typeof usage?.total_tokens === "number" ? usage.total_tokens : undefined,
        });
        output.stopReason = mapCodexStopReason(
          String(responsePayload?.status ?? "completed"),
          output.content.some((part) => part.type === "toolCall"),
        );
        output.timestamp = Date.now();
        yield { type: "done", reason: output.stopReason, message: output } as const;
        return;
      }
      case "response.failed": {
        const responsePayload = payload.response as Record<string, unknown> | undefined;
        const errorPayload = responsePayload?.error as Record<string, unknown> | undefined;
        throw new Error(String(errorPayload?.message ?? "OpenAI Codex response failed"));
      }
      case "error":
        throw new Error(String(payload.message ?? "OpenAI Codex stream error"));
      default:
        break;
    }
  }

  throw new Error("OpenAI Codex stream ended without a completion event");
}

function parseJsonObject(input: string): Record<string, JSONValue> {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return {};
    }
    return parsed as Record<string, JSONValue>;
  } catch {
    return {};
  }
}

function mapCodexStopReason(status: string, hasToolCalls: boolean) {
  switch (status) {
    case "completed":
      return hasToolCalls ? "toolUse" : "stop";
    case "incomplete":
      return "length";
    case "failed":
    case "cancelled":
      return "error";
    default:
      return hasToolCalls ? "toolUse" : "stop";
  }
}
