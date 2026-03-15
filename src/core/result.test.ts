import { describe, expect, it } from "vitest";

import { toV2GenerateResult, toV3GenerateResult } from "./result.js";

const assistantMessage = {
  role: "assistant" as const,
  api: "anthropic-messages" as const,
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  content: [
    { type: "text" as const, text: "hello" },
    { type: "thinking" as const, thinking: "reasoning" },
    { type: "toolCall" as const, id: "call-1", name: "weather", arguments: { city: "Calgary" } },
  ],
  usage: {
    input: 10,
    output: 5,
    cacheRead: 2,
    cacheWrite: 1,
    totalTokens: 18,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "toolUse" as const,
  timestamp: Date.now(),
};

describe("result mapping", () => {
  it("maps pi-ai output into V2 generate results", () => {
    const result = toV2GenerateResult(assistantMessage, []);

    expect(result.finishReason).toBe("tool-calls");
    expect(result.content).toEqual([
      { type: "text", text: "hello" },
      { type: "reasoning", text: "reasoning" },
      { type: "tool-call", toolCallId: "call-1", toolName: "weather", input: JSON.stringify({ city: "Calgary" }) },
    ]);
    expect(result.usage.totalTokens).toBe(18);
  });

  it("maps pi-ai output into V3 generate results", () => {
    const result = toV3GenerateResult(assistantMessage, []);

    expect(result.finishReason).toEqual({ unified: "tool-calls", raw: "toolUse" });
    expect(result.usage.inputTokens).toEqual({
      total: 13,
      noCache: 10,
      cacheRead: 2,
      cacheWrite: 1,
    });
    expect(result.usage.outputTokens.total).toBe(5);
  });
});
