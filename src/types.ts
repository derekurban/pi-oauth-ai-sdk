import type { LanguageModelV2, LanguageModelV3 } from "@ai-sdk/provider";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";

export const PI_OAUTH_PROVIDER_IDS = [
  "anthropic",
  "github-copilot",
  "openai-codex",
  "google-gemini-cli",
  "google-antigravity",
] as const;

export type PiOAuthProviderId = (typeof PI_OAUTH_PROVIDER_IDS)[number];

export type PiOAuthCredentialRecord = {
  type: "oauth";
} & OAuthCredentials;

export type PiOAuthAuthFile = string;

export interface PiOAuthProviderOptions {
  authFile: PiOAuthAuthFile;
  fetch?: typeof globalThis.fetch;
}

export interface PiOAuthProvider {
  readonly providerId: PiOAuthProviderId;
  readonly authFile: PiOAuthAuthFile;
  languageModelV2(modelId: string): LanguageModelV2;
  languageModelV3(modelId: string): LanguageModelV3;
}

export interface PiOAuthProviderStatus {
  providerId: PiOAuthProviderId;
  stored: boolean;
  expiresAt?: number;
  expired?: boolean;
}

export function isPiOAuthProviderId(value: string): value is PiOAuthProviderId {
  return (PI_OAUTH_PROVIDER_IDS as readonly string[]).includes(value);
}
