import type { OAuthCredentialRecord, OAuthProviderId } from "../types.js";
import type {
  PreparedRuntimeCall,
  RuntimeAssistantMessage,
  RuntimeMessage,
  RuntimeStreamEvent,
  TransportApi,
} from "../core/runtime-types.js";

export interface TransportCallOptions {
  providerId: OAuthProviderId;
  modelId: string;
  prepared: PreparedRuntimeCall<unknown>;
  credentials: OAuthCredentialRecord;
  fetch: typeof globalThis.fetch;
}

export interface ProviderTransport {
  readonly providerId: OAuthProviderId;
  readonly api: TransportApi;
  stream(options: TransportCallOptions): Promise<AsyncIterable<RuntimeStreamEvent>>;
}

export type ParsedSseEvent = {
  event?: string;
  data: string;
};

export function createEmptyAssistantMessage(
  api: TransportApi,
  providerId: OAuthProviderId,
  modelId: string,
): RuntimeAssistantMessage {
  return {
    role: "assistant",
    api,
    provider: providerId,
    model: modelId,
    content: [],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

export async function* parseSseEvents(response: Response): AsyncGenerator<ParsedSseEvent> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        const lines = rawEvent.split(/\r?\n/);
        let eventName: string | undefined;
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
            continue;
          }
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        const data = dataLines.join("\n").trim();
        if (data && data !== "[DONE]") {
          yield {
            ...(eventName ? { event: eventName } : {}),
            data,
          };
        }

        separatorIndex = buffer.indexOf("\n\n");
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore shutdown failures.
    }
    try {
      reader.releaseLock();
    } catch {
      // Ignore shutdown failures.
    }
  }
}

export function jsonParse<T>(value: string, message: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function normalizeTextContent(message: RuntimeMessage): string {
  if (message.role === "user") {
    return typeof message.content === "string"
      ? message.content
      : message.content.map((part) => part.text).join("\n");
  }

  if (message.role === "toolResult") {
    return message.content.map((part) => part.text).join("\n");
  }

  return message.content.map((part) => {
    switch (part.type) {
      case "text":
        return part.text;
      case "thinking":
        return part.thinking;
      case "toolCall":
        return JSON.stringify(part.arguments ?? {});
      default: {
        const exhaustive: never = part;
        return exhaustive;
      }
    }
  }).join("\n");
}

export function sanitizeIdentifier(value: string, prefix: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+$/, "");
  const withPrefix = sanitized.length > 0 ? sanitized : prefix;
  return withPrefix.length > 64 ? withPrefix.slice(0, 64) : withPrefix;
}

export function mapUsage(input: {
  input?: number | undefined;
  output?: number | undefined;
  cacheRead?: number | undefined;
  cacheWrite?: number | undefined;
  total?: number | undefined;
}) {
  const resolvedInput = input.input ?? 0;
  const resolvedOutput = input.output ?? 0;
  const resolvedCacheRead = input.cacheRead ?? 0;
  const resolvedCacheWrite = input.cacheWrite ?? 0;

  return {
    input: resolvedInput,
    output: resolvedOutput,
    cacheRead: resolvedCacheRead,
    cacheWrite: resolvedCacheWrite,
    totalTokens: input.total ?? resolvedInput + resolvedOutput + resolvedCacheRead + resolvedCacheWrite,
  };
}
