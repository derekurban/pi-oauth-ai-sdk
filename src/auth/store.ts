import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import lockfile from "proper-lockfile";

import {
  getOAuthApiKey,
  getOAuthProvider,
  getOAuthProviders,
  type OAuthCredentials,
  type OAuthLoginCallbacks,
} from "@mariozechner/pi-ai/oauth";

import {
  importOpenAICodexCredentialsFromCodexAuth,
  loginOpenAICodexWithDeviceAuth,
  loginOpenAICodexWithOfficialFlow,
} from "./openai-codex-login.js";
import {
  type PiOAuthAuthFile,
  type PiOAuthCredentialRecord,
  type PiOAuthProviderId,
  type PiOAuthProviderStatus,
} from "../types.js";

type PiOAuthAuthData = Partial<Record<PiOAuthProviderId, PiOAuthCredentialRecord>>;

type LockedMutationResult<T> = {
  result: T;
  next?: PiOAuthAuthData;
};

export class PiOAuthAuthStore {
  constructor(readonly authFile: PiOAuthAuthFile) {}

  async login(
    providerId: PiOAuthProviderId,
    callbacks: OAuthLoginCallbacks,
    options?: { deviceAuth?: boolean },
  ): Promise<PiOAuthCredentialRecord> {
    const provider = getOAuthProvider(providerId);
    if (!provider) {
      throw new Error(`Unknown OAuth provider: ${providerId}`);
    }

    const credentials = providerId === "openai-codex"
      ? options?.deviceAuth
        ? await loginOpenAICodexWithDeviceAuth(callbacks)
        : await loginOpenAICodexWithOfficialFlow(callbacks)
      : await provider.login(callbacks);
    const record: PiOAuthCredentialRecord = { type: "oauth", ...credentials };

    await this.writeRecord(providerId, record);

    return record;
  }

  async importOpenAICodexAuth(sourceAuthFile: string): Promise<PiOAuthCredentialRecord> {
    const credentials = importOpenAICodexCredentialsFromCodexAuth(sourceAuthFile);
    const record: PiOAuthCredentialRecord = { type: "oauth", ...credentials };
    await this.writeRecord("openai-codex", record);
    return record;
  }

  async logout(providerId: PiOAuthProviderId): Promise<void> {
    await this.withLock(async (data) => {
      const next = { ...data };
      delete next[providerId];
      return { result: undefined, next };
    });
  }

  async getStatus(providerId: PiOAuthProviderId): Promise<PiOAuthProviderStatus> {
    const data = await this.read();
    const record = data[providerId];
    if (!record) {
      return { providerId, stored: false };
    }

    return {
      providerId,
      stored: true,
      expiresAt: record.expires,
      expired: Date.now() >= record.expires,
    };
  }

  async getRecord(providerId: PiOAuthProviderId): Promise<PiOAuthCredentialRecord | undefined> {
    const data = await this.read();
    return data[providerId];
  }

  async resolveApiKey(
    providerId: PiOAuthProviderId,
  ): Promise<{ apiKey: string; credentials: PiOAuthCredentialRecord }> {
    return this.withLock(async (data) => {
      const current = data[providerId];
      if (!current) {
        throw new Error(`No stored OAuth credentials for provider: ${providerId}`);
      }

      if (Date.now() < current.expires) {
        const provider = getOAuthProvider(providerId);
        if (!provider) {
          throw new Error(`Unknown OAuth provider: ${providerId}`);
        }

        return {
          result: {
            apiKey: provider.getApiKey(current),
            credentials: current,
          },
        };
      }

      const oauthEntries = Object.entries(data).filter(
        (entry): entry is [string, PiOAuthCredentialRecord] => Boolean(entry[1]) && entry[1].type === "oauth",
      );

      const oauthMap = Object.fromEntries(oauthEntries) as Record<string, OAuthCredentials>;

      const refreshed = await getOAuthApiKey(providerId, oauthMap);
      if (!refreshed) {
        throw new Error(`No stored OAuth credentials for provider: ${providerId}`);
      }

      const nextRecord: PiOAuthCredentialRecord = {
        type: "oauth",
        ...refreshed.newCredentials,
      };

      return {
        result: {
          apiKey: refreshed.apiKey,
          credentials: nextRecord,
        },
        next: { ...data, [providerId]: nextRecord },
      };
    });
  }

  getProviders() {
    return getOAuthProviders();
  }

  private async writeRecord(providerId: PiOAuthProviderId, record: PiOAuthCredentialRecord): Promise<void> {
    await this.withLock(async (data) => ({
      result: undefined,
      next: { ...data, [providerId]: record },
    }));
  }

  private async read(): Promise<PiOAuthAuthData> {
    this.ensureFile();
    return this.parseData(readFileSync(this.authFile, "utf8"));
  }

  private async withLock<T>(mutate: (data: PiOAuthAuthData) => Promise<LockedMutationResult<T>>): Promise<T> {
    this.ensureFile();

    const release = await lockfile.lock(this.authFile, {
      realpath: false,
      retries: {
        retries: 10,
        factor: 2,
        minTimeout: 50,
        maxTimeout: 2000,
        randomize: true,
      },
      stale: 30_000,
    });

    try {
      const current = this.parseData(readFileSync(this.authFile, "utf8"));
      const { result, next } = await mutate(current);
      if (next) {
        writeFileSync(this.authFile, JSON.stringify(next, null, 2), "utf8");
        chmodSync(this.authFile, 0o600);
      }
      return result;
    } finally {
      await release();
    }
  }

  private ensureFile(): void {
    const parent = dirname(this.authFile);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true, mode: 0o700 });
    }
    if (!existsSync(this.authFile)) {
      writeFileSync(this.authFile, "{}", "utf8");
      chmodSync(this.authFile, 0o600);
    }
  }

  private parseData(content: string): PiOAuthAuthData {
    try {
      const parsed = JSON.parse(content) as PiOAuthAuthData;
      return parsed ?? {};
    } catch (error) {
      throw new Error(`Failed to parse auth file '${this.authFile}': ${String(error)}`);
    }
  }
}
