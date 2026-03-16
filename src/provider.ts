import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import type { OAuthLoginCallbacks } from "@mariozechner/pi-ai/oauth";

import { resolveDefaultCodexAuthFile } from "./auth/openai-codex-login.js";
import { OAuthAuthStore } from "./auth/store.js";
import { createLanguageModel, createLanguageModelV2 } from "./core/execution.js";
import type {
  CodexOAuthManager,
  CodexOAuthProvider,
  OAuthManagedProvider,
  OAuthManager,
  OAuthProviderId,
  OAuthProviderOptions,
} from "./types.js";

export function createOpenAICodexOAuth(options: OAuthProviderOptions): CodexOAuthProvider {
  return createProvider("openai-codex", options) as CodexOAuthProvider;
}

export function createAnthropicOAuth(options: OAuthProviderOptions): OAuthManagedProvider {
  return createProvider("anthropic", options);
}

export function createGeminiCliOAuth(options: OAuthProviderOptions): OAuthManagedProvider {
  return createProvider("google-gemini-cli", options);
}

function createProvider(providerId: OAuthProviderId, options: OAuthProviderOptions): OAuthManagedProvider {
  const authStore = new OAuthAuthStore(options.authFile);
  const auth = createAuthManager(providerId, authStore);

  return {
    specificationVersion: "v3",
    providerId,
    authFile: options.authFile,
    auth,
    languageModelV2(modelId: string) {
      return createLanguageModelV2({
        providerId,
        modelId,
        authStore,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
    },
    languageModel(modelId: string) {
      return createLanguageModel({
        providerId,
        modelId,
        authStore,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
    },
    embeddingModel() {
      throw unsupportedSurface("embeddingModel");
    },
    textEmbeddingModel() {
      throw unsupportedSurface("textEmbeddingModel");
    },
    imageModel() {
      throw unsupportedSurface("imageModel");
    },
    transcriptionModel() {
      throw unsupportedSurface("transcriptionModel");
    },
    speechModel() {
      throw unsupportedSurface("speechModel");
    },
    rerankingModel() {
      throw unsupportedSurface("rerankingModel");
    },
  };
}

function createAuthManager(providerId: OAuthProviderId, authStore: OAuthAuthStore): OAuthManager | CodexOAuthManager {
  const base: OAuthManager = {
    providerId,
    authFile: authStore.authFile,
    async login(callbacks?: OAuthLoginCallbacks, options?: { deviceAuth?: boolean }) {
      if (!callbacks) {
        throw new Error("OAuth login requires interactive callbacks. Use the package CLI or pass OAuthLoginCallbacks explicitly.");
      }
      return authStore.login(providerId, callbacks, options);
    },
    async logout() {
      await authStore.logout(providerId);
    },
    async status() {
      return authStore.getStatus(providerId);
    },
  };

  if (providerId !== "openai-codex") {
    return base;
  }

  return {
    ...base,
    async importFromCodexAuth(sourceAuthFile?: string) {
      return authStore.importOpenAICodexAuth(sourceAuthFile ?? resolveDefaultCodexAuthFile());
    },
  };
}

function unsupportedSurface(surface: string): UnsupportedFunctionalityError {
  return new UnsupportedFunctionalityError({
    functionality: surface,
    message: "This package only implements AI SDK language models.",
  });
}
