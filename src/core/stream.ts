import type {
  LanguageModelV2CallWarning,
  LanguageModelV2StreamPart,
  LanguageModelV3StreamPart,
  SharedV3Warning,
} from "@ai-sdk/provider";

import type { RuntimeStreamEvent } from "./runtime-types.js";
import { toFinishReason, toFinishReasonV2, toResponseMetadata, toUsage, toUsageV2 } from "./result.js";

export function toLanguageModelV2Stream(
  source: AsyncIterable<RuntimeStreamEvent>,
  warnings: LanguageModelV2CallWarning[],
): ReadableStream<LanguageModelV2StreamPart> {
  return new ReadableStream<LanguageModelV2StreamPart>({
    async start(controller) {
      controller.enqueue({ type: "stream-start", warnings });

      for await (const event of source) {
        for (const part of mapEventToV2StreamParts(event)) {
          controller.enqueue(part);
        }

        if (event.type === "done" || event.type === "error") {
          controller.close();
          return;
        }
      }

      controller.close();
    },
  });
}

export function toLanguageModelV3Stream(
  source: AsyncIterable<RuntimeStreamEvent>,
  warnings: SharedV3Warning[],
): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream<LanguageModelV3StreamPart>({
    async start(controller) {
      controller.enqueue({ type: "stream-start", warnings });

      for await (const event of source) {
        for (const part of mapEventToV3StreamParts(event)) {
          controller.enqueue(part);
        }

        if (event.type === "done" || event.type === "error") {
          controller.close();
          return;
        }
      }

      controller.close();
    },
  });
}

function mapEventToV2StreamParts(event: RuntimeStreamEvent): LanguageModelV2StreamPart[] {
  switch (event.type) {
    case "start":
      return [{ type: "response-metadata", ...toResponseMetadata(event.partial) }];
    case "text_start":
      return [{ type: "text-start", id: textBlockId(event.contentIndex) }];
    case "text_delta":
      return [{ type: "text-delta", id: textBlockId(event.contentIndex), delta: event.delta }];
    case "text_end":
      return [{ type: "text-end", id: textBlockId(event.contentIndex) }];
    case "thinking_start":
      return [{ type: "reasoning-start", id: reasoningBlockId(event.contentIndex) }];
    case "thinking_delta":
      return [{ type: "reasoning-delta", id: reasoningBlockId(event.contentIndex), delta: event.delta }];
    case "thinking_end":
      return [{ type: "reasoning-end", id: reasoningBlockId(event.contentIndex) }];
    case "toolcall_start": {
      const toolCall = getPartialToolCall(event);
      return [{
        type: "tool-input-start",
        id: toolCall?.id ?? toolBlockId(event.contentIndex),
        toolName: toolCall?.name ?? "tool",
      }];
    }
    case "toolcall_delta": {
      const toolCall = getPartialToolCall(event);
      return [{
        type: "tool-input-delta",
        id: toolCall?.id ?? toolBlockId(event.contentIndex),
        delta: event.delta,
      }];
    }
    case "toolcall_end":
      return [
        { type: "tool-input-end", id: event.toolCall.id },
        {
          type: "tool-call",
          toolCallId: event.toolCall.id,
          toolName: event.toolCall.name,
          input: JSON.stringify(event.toolCall.arguments ?? {}),
        },
      ];
    case "done":
      return [{
        type: "finish",
        usage: toUsageV2(event.message),
        finishReason: toFinishReasonV2(event.reason),
      }];
    case "error":
      return [{
        type: "error",
        error: new Error("OAuth provider stream failed"),
      }];
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function mapEventToV3StreamParts(event: RuntimeStreamEvent): LanguageModelV3StreamPart[] {
  switch (event.type) {
    case "start":
      return [{ type: "response-metadata", ...toResponseMetadata(event.partial) }];
    case "text_start":
      return [{ type: "text-start", id: textBlockId(event.contentIndex) }];
    case "text_delta":
      return [{ type: "text-delta", id: textBlockId(event.contentIndex), delta: event.delta }];
    case "text_end":
      return [{ type: "text-end", id: textBlockId(event.contentIndex) }];
    case "thinking_start":
      return [{ type: "reasoning-start", id: reasoningBlockId(event.contentIndex) }];
    case "thinking_delta":
      return [{ type: "reasoning-delta", id: reasoningBlockId(event.contentIndex), delta: event.delta }];
    case "thinking_end":
      return [{ type: "reasoning-end", id: reasoningBlockId(event.contentIndex) }];
    case "toolcall_start": {
      const toolCall = getPartialToolCall(event);
      return [{
        type: "tool-input-start",
        id: toolCall?.id ?? toolBlockId(event.contentIndex),
        toolName: toolCall?.name ?? "tool",
      }];
    }
    case "toolcall_delta": {
      const toolCall = getPartialToolCall(event);
      return [{
        type: "tool-input-delta",
        id: toolCall?.id ?? toolBlockId(event.contentIndex),
        delta: event.delta,
      }];
    }
    case "toolcall_end":
      return [
        { type: "tool-input-end", id: event.toolCall.id },
        {
          type: "tool-call",
          toolCallId: event.toolCall.id,
          toolName: event.toolCall.name,
          input: JSON.stringify(event.toolCall.arguments ?? {}),
        },
      ];
    case "done":
      return [{
        type: "finish",
        usage: toUsage(event.message),
        finishReason: toFinishReason(event.reason),
      }];
    case "error":
      return [{
        type: "error",
        error: new Error("OAuth provider stream failed"),
      }];
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function getPartialToolCall(
  event:
    | Extract<RuntimeStreamEvent, { type: "toolcall_start" }>
    | Extract<RuntimeStreamEvent, { type: "toolcall_delta" }>,
) {
  const part = event.partial.content[event.contentIndex];
  return part?.type === "toolCall" ? part : undefined;
}

function textBlockId(index: number): string {
  return `text-${index}`;
}

function reasoningBlockId(index: number): string {
  return `reasoning-${index}`;
}

function toolBlockId(index: number): string {
  return `tool-${index}`;
}
