import { describe, expect, it } from "vitest";

import { prepareV2Call, prepareV3Call } from "./prompt.js";

describe("prompt mapping", () => {
  it("maps V2 prompt messages and filters tools for a specific tool choice", () => {
    const prepared = prepareV2Call({
      prompt: [
        { role: "system", content: "system rule" },
        { role: "user", content: [{ type: "text", text: "hello" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "thinking out loud" },
            { type: "tool-call", toolCallId: "call-1", toolName: "weather", input: { city: "Calgary" } },
          ],
        },
        {
          role: "tool",
          content: [
            { type: "tool-result", toolCallId: "call-1", toolName: "weather", output: { type: "json", value: { temp: 18 } } },
          ],
        },
      ],
      maxOutputTokens: 256,
      temperature: 0.2,
      toolChoice: { type: "tool", toolName: "weather" },
      tools: [
        { type: "function", name: "weather", description: "Weather lookup", inputSchema: { type: "object" } },
        { type: "function", name: "calendar", description: "Calendar lookup", inputSchema: { type: "object" } },
      ],
    });

    expect(prepared.context.systemPrompt).toBe("system rule");
    expect(prepared.context.tools).toHaveLength(1);
    expect(prepared.context.tools?.[0]?.name).toBe("weather");
    expect(prepared.context.messages).toHaveLength(3);
    expect(prepared.streamOptions.maxTokens).toBe(256);
    expect(prepared.streamOptions.temperature).toBe(0.2);
  });

  it("emits warnings for unsupported V3 settings", () => {
    const prepared = prepareV3Call({
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      responseFormat: { type: "json" },
      includeRawChunks: true,
      tools: [],
    });

    expect(prepared.warnings).toEqual([
      expect.objectContaining({ type: "unsupported", feature: "responseFormat" }),
      expect.objectContaining({ type: "unsupported", feature: "includeRawChunks" }),
    ]);
  });
});
