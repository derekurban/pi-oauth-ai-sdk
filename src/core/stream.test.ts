import { describe, expect, it } from "vitest";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";

import { toV3Stream } from "./stream.js";

describe("stream mapping", () => {
  it("serializes tool call input to JSON for V3 streams", async () => {
    const events: AssistantMessageEvent[] = [{
        type: "start" as const,
        partial: {
          role: "assistant" as const,
          api: "openai-codex-responses" as const,
          provider: "openai-codex",
          model: "gpt-5.4",
          content: [{ type: "toolCall" as const, id: "call-1", name: "weather", arguments: { city: "Calgary" } }],
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "toolUse" as const,
          timestamp: Date.now(),
        },
      },
    {
        type: "toolcall_end" as const,
        contentIndex: 0,
        toolCall: {
          type: "toolCall",
          id: "call-1",
          name: "weather",
          arguments: { city: "Calgary" },
        },
        partial: {
          role: "assistant" as const,
          api: "openai-codex-responses" as const,
          provider: "openai-codex",
          model: "gpt-5.4",
          content: [{ type: "toolCall" as const, id: "call-1", name: "weather", arguments: { city: "Calgary" } }],
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "toolUse" as const,
          timestamp: Date.now(),
        },
      },
    {
        type: "done" as const,
        reason: "toolUse" as const,
        message: {
          role: "assistant" as const,
          api: "openai-codex-responses" as const,
          provider: "openai-codex",
          model: "gpt-5.4",
          content: [],
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "toolUse" as const,
          timestamp: Date.now(),
        },
      }];

    const source = (async function* () {
      for (const event of events) {
        yield event;
      }
    })();

    const stream = toV3Stream(source, []);
    const reader = stream.getReader();
    const parts = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      parts.push(value);
    }

    expect(parts).toContainEqual({
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "weather",
      input: JSON.stringify({ city: "Calgary" }),
    });
  });
});
