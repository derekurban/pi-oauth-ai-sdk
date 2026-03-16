import { describe, expect, it, vi } from "vitest";

const piAiMocks = vi.hoisted(() => ({
  complete: vi.fn(),
  stream: vi.fn(),
}));

const modelResolutionMocks = vi.hoisted(() => ({
  resolvePiModel: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  complete: piAiMocks.complete,
  stream: piAiMocks.stream,
}));

vi.mock("./model-resolution.js", () => ({
  resolvePiModel: modelResolutionMocks.resolvePiModel,
}));

import { createLanguageModelV3 } from "./execution.js";

describe("execution", () => {
  it("adds default instructions for OpenAI Codex when no system prompt is provided", async () => {
    modelResolutionMocks.resolvePiModel.mockReturnValue({
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-5.4",
    });
    piAiMocks.complete.mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "pong" }],
      stopReason: "stop",
      usage: { input: 1, output: 1, totalTokens: 2, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } },
      timestamp: Date.now(),
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-5.4",
    });

    const model = createLanguageModelV3({
      providerId: "openai-codex",
      modelId: "gpt-5.4",
      authStore: {
        resolveApiKey: vi.fn().mockResolvedValue({
          apiKey: "test-api-key",
          credentials: { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 60_000 },
        }),
      } as never,
    });

    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      temperature: 0.7,
    });

    expect(piAiMocks.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        systemPrompt: "You are a helpful assistant.",
      }),
      expect.objectContaining({
        apiKey: "test-api-key",
      }),
    );
    expect(piAiMocks.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.not.objectContaining({
        temperature: expect.anything(),
      }),
    );
  });

  it("preserves missing system prompts for non-Codex providers", async () => {
    modelResolutionMocks.resolvePiModel.mockReturnValue({
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
    piAiMocks.complete.mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "pong" }],
      stopReason: "stop",
      usage: { input: 1, output: 1, totalTokens: 2, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } },
      timestamp: Date.now(),
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });

    const model = createLanguageModelV3({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
      authStore: {
        resolveApiKey: vi.fn().mockResolvedValue({
          apiKey: "test-api-key",
          credentials: { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 60_000 },
        }),
      } as never,
    });

    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
    });

    expect(piAiMocks.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({
        systemPrompt: expect.any(String),
      }),
      expect.objectContaining({
        apiKey: "test-api-key",
      }),
    );
  });
});
