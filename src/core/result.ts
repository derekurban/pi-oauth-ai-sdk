import type {
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2ResponseMetadata,
  LanguageModelV2,
  LanguageModelV2Usage,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3ResponseMetadata,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";
import type { AssistantMessage } from "@mariozechner/pi-ai";

export function toV2GenerateResult(
  message: AssistantMessage,
  warnings: LanguageModelV2CallWarning[],
): Awaited<ReturnType<LanguageModelV2["doGenerate"]>> {
  return {
    content: toV2Content(message),
    finishReason: toV2FinishReason(message.stopReason),
    usage: toV2Usage(message),
    response: {
      ...toResponseMetadata(message),
    },
    warnings,
  };
}

export function toV3GenerateResult(
  message: AssistantMessage,
  warnings: SharedV3Warning[],
): LanguageModelV3GenerateResult {
  return {
    content: toV3Content(message),
    finishReason: toV3FinishReason(message.stopReason),
    usage: toV3Usage(message),
    response: {
      ...toResponseMetadata(message),
    },
    warnings,
  };
}

export function toResponseMetadata(message: AssistantMessage): LanguageModelV2ResponseMetadata & LanguageModelV3ResponseMetadata {
  return {
    timestamp: new Date(message.timestamp),
    modelId: message.model,
  };
}

export function toV2FinishReason(reason: AssistantMessage["stopReason"]): LanguageModelV2FinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "toolUse":
      return "tool-calls";
    case "error":
    case "aborted":
      return "error";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export function toV3FinishReason(reason: AssistantMessage["stopReason"]): LanguageModelV3FinishReason {
  return {
    unified: toV3UnifiedFinishReason(reason),
    raw: reason,
  };
}

export function toV2Usage(message: AssistantMessage): LanguageModelV2Usage {
  return {
    inputTokens: message.usage.input,
    outputTokens: message.usage.output,
    totalTokens: message.usage.totalTokens,
    cachedInputTokens: message.usage.cacheRead,
  };
}

export function toV3Usage(message: AssistantMessage): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
      noCache: message.usage.input,
      cacheRead: message.usage.cacheRead,
      cacheWrite: message.usage.cacheWrite,
    },
    outputTokens: {
      total: message.usage.output,
      text: message.usage.output,
      reasoning: undefined,
    },
    raw: {
      totalTokens: message.usage.totalTokens,
    },
  };
}

function toV3UnifiedFinishReason(reason: AssistantMessage["stopReason"]): LanguageModelV3FinishReason["unified"] {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "toolUse":
      return "tool-calls";
    case "error":
    case "aborted":
      return "error";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function toV2Content(message: AssistantMessage): LanguageModelV2Content[] {
  return message.content.map((part) => {
    switch (part.type) {
      case "text":
        return {
          type: "text",
          text: part.text,
        };
      case "thinking":
        return {
          type: "reasoning",
          text: part.thinking,
        };
      case "toolCall":
        return {
          type: "tool-call",
          toolCallId: part.id,
          toolName: part.name,
          input: JSON.stringify(part.arguments ?? {}),
        };
      default: {
        const exhaustive: never = part;
        return exhaustive;
      }
    }
  });
}

function toV3Content(message: AssistantMessage): LanguageModelV3Content[] {
  return message.content.map((part) => {
    switch (part.type) {
      case "text":
        return {
          type: "text",
          text: part.text,
        };
      case "thinking":
        return {
          type: "reasoning",
          text: part.thinking,
        };
      case "toolCall":
        return {
          type: "tool-call",
          toolCallId: part.id,
          toolName: part.name,
          input: JSON.stringify(part.arguments ?? {}),
        };
      default: {
        const exhaustive: never = part;
        return exhaustive;
      }
    }
  });
}
