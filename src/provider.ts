import { PiOAuthAuthStore } from "./auth/store.js";
import { createLanguageModelV2, createLanguageModelV3 } from "./core/execution.js";
import type { PiOAuthProvider, PiOAuthProviderId, PiOAuthProviderOptions } from "./types.js";

export function createAnthropicProvider(options: PiOAuthProviderOptions): PiOAuthProvider {
  return createProvider("anthropic", options);
}

export function createGitHubCopilotProvider(options: PiOAuthProviderOptions): PiOAuthProvider {
  return createProvider("github-copilot", options);
}

export function createOpenAICodexProvider(options: PiOAuthProviderOptions): PiOAuthProvider {
  return createProvider("openai-codex", options);
}

export function createGeminiCliProvider(options: PiOAuthProviderOptions): PiOAuthProvider {
  return createProvider("google-gemini-cli", options);
}

export function createAntigravityProvider(options: PiOAuthProviderOptions): PiOAuthProvider {
  return createProvider("google-antigravity", options);
}

function createProvider(providerId: PiOAuthProviderId, options: PiOAuthProviderOptions): PiOAuthProvider {
  const authStore = new PiOAuthAuthStore(options.authFile);

  return {
    providerId,
    authFile: options.authFile,
    languageModelV2(modelId: string) {
      return createLanguageModelV2({
        providerId,
        modelId,
        authStore,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
    },
    languageModelV3(modelId: string) {
      return createLanguageModelV3({
        providerId,
        modelId,
        authStore,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
    },
  };
}
