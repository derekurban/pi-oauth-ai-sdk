import type { LanguageModelV2, LanguageModelV3, ProviderV3 } from "@ai-sdk/provider";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai/oauth";

export const OAUTH_PROVIDER_IDS = [
  "openai-codex",
  "anthropic",
  "google-gemini-cli",
] as const;

export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

export type OAuthCredentialRecord = {
  type: "oauth";
  accountId?: string;
  email?: string;
  projectId?: string;
} & OAuthCredentials;

export type OAuthAuthFile = string;

export interface OAuthProviderOptions {
  authFile: OAuthAuthFile;
  fetch?: typeof globalThis.fetch;
}

export interface OAuthProviderStatus {
  providerId: OAuthProviderId;
  stored: boolean;
  expiresAt?: number;
  expired?: boolean;
}

export interface OAuthManager {
  readonly providerId: OAuthProviderId;
  readonly authFile: OAuthAuthFile;
  login(callbacks?: OAuthLoginCallbacks, options?: { deviceAuth?: boolean }): Promise<OAuthCredentialRecord>;
  logout(): Promise<void>;
  status(): Promise<OAuthProviderStatus>;
}

export interface CodexOAuthManager extends OAuthManager {
  importFromCodexAuth(sourceAuthFile?: string): Promise<OAuthCredentialRecord>;
}

export interface OAuthManagedProvider extends ProviderV3 {
  readonly providerId: OAuthProviderId;
  readonly authFile: OAuthAuthFile;
  readonly auth: OAuthManager;
  languageModelV2(modelId: string): LanguageModelV2;
  languageModel(modelId: string): LanguageModelV3;
}

export interface CodexOAuthProvider extends OAuthManagedProvider {
  readonly auth: CodexOAuthManager;
}

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return (OAUTH_PROVIDER_IDS as readonly string[]).includes(value);
}
