import { describe, expect, it, vi } from "vitest";

const executionMocks = vi.hoisted(() => ({
  createLanguageModelV2: vi.fn(),
  createLanguageModelV3: vi.fn(),
}));

vi.mock("./core/execution.js", () => ({
  createLanguageModelV2: executionMocks.createLanguageModelV2,
  createLanguageModelV3: executionMocks.createLanguageModelV3,
}));

import {
  createAnthropicProvider,
  createGitHubCopilotProvider,
} from "./provider.js";

describe("provider factories", () => {
  it("creates provider-scoped V2 and V3 models", () => {
    const provider = createAnthropicProvider({ authFile: "D:/tmp/auth.json" });

    provider.languageModelV2("claude-sonnet-4-5");
    provider.languageModelV3("claude-sonnet-4-5");

    expect(executionMocks.createLanguageModelV2).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
    }));
    expect(executionMocks.createLanguageModelV3).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
    }));
  });

  it("keeps the provider id on the returned provider object", () => {
    const provider = createGitHubCopilotProvider({ authFile: "D:/tmp/auth.json" });

    expect(provider.providerId).toBe("github-copilot");
    expect(provider.authFile).toBe("D:/tmp/auth.json");
  });
});
