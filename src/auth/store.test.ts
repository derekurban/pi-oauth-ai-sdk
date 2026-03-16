import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const oauthMocks = vi.hoisted(() => ({
  provider: {
    login: vi.fn(),
    refreshToken: vi.fn(),
    getApiKey: vi.fn(),
  },
  getOAuthProvider: vi.fn(),
  getOAuthProviders: vi.fn(),
  getOAuthApiKey: vi.fn(),
  importOpenAICodexCredentialsFromCodexAuth: vi.fn(),
  loginOpenAICodexWithDeviceAuth: vi.fn(),
  loginOpenAICodexWithOfficialFlow: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai/oauth", () => ({
  getOAuthProvider: oauthMocks.getOAuthProvider,
  getOAuthProviders: oauthMocks.getOAuthProviders,
  getOAuthApiKey: oauthMocks.getOAuthApiKey,
}));

vi.mock("./openai-codex-login.js", () => ({
  importOpenAICodexCredentialsFromCodexAuth: oauthMocks.importOpenAICodexCredentialsFromCodexAuth,
  loginOpenAICodexWithDeviceAuth: oauthMocks.loginOpenAICodexWithDeviceAuth,
  loginOpenAICodexWithOfficialFlow: oauthMocks.loginOpenAICodexWithOfficialFlow,
}));

import { PiOAuthAuthStore } from "./store.js";

describe("PiOAuthAuthStore", () => {
  let tempDir: string;
  let authFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pi-oauth-ai-sdk-"));
    authFile = join(tempDir, "auth.json");

    oauthMocks.provider.login.mockReset();
    oauthMocks.provider.refreshToken.mockReset();
    oauthMocks.provider.getApiKey.mockReset();
    oauthMocks.getOAuthProvider.mockReset();
    oauthMocks.getOAuthProviders.mockReset();
    oauthMocks.getOAuthApiKey.mockReset();
    oauthMocks.importOpenAICodexCredentialsFromCodexAuth.mockReset();
    oauthMocks.loginOpenAICodexWithDeviceAuth.mockReset();
    oauthMocks.loginOpenAICodexWithOfficialFlow.mockReset();

    oauthMocks.getOAuthProvider.mockReturnValue(oauthMocks.provider);
    oauthMocks.getOAuthProviders.mockReturnValue([]);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("stores credentials returned by login", async () => {
    oauthMocks.provider.login.mockResolvedValue({
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60_000,
    });

    const store = new PiOAuthAuthStore(authFile);
    const record = await store.login("anthropic", {
      onAuth: vi.fn(),
      onPrompt: vi.fn(),
    });

    expect(record).toMatchObject({
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
    });

    const file = JSON.parse(readFileSync(authFile, "utf8"));
    expect(file.anthropic).toMatchObject({
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
    });
  });

  it("returns a direct API key for unexpired credentials", async () => {
    const expires = Date.now() + 60_000;
    writeFileSync(authFile, JSON.stringify({
      anthropic: {
        type: "oauth",
        access: "fresh-access",
        refresh: "fresh-refresh",
        expires,
      },
    }));

    oauthMocks.provider.getApiKey.mockReturnValue("resolved-api-key");

    const store = new PiOAuthAuthStore(authFile);
    const resolved = await store.resolveApiKey("anthropic");

    expect(resolved.apiKey).toBe("resolved-api-key");
    expect(resolved.credentials.access).toBe("fresh-access");
    expect(oauthMocks.getOAuthApiKey).not.toHaveBeenCalled();
  });

  it("refreshes expired credentials and persists the update", async () => {
    writeFileSync(authFile, JSON.stringify({
      anthropic: {
        type: "oauth",
        access: "stale-access",
        refresh: "stale-refresh",
        expires: Date.now() - 1_000,
      },
    }));

    oauthMocks.getOAuthApiKey.mockResolvedValue({
      apiKey: "refreshed-api-key",
      newCredentials: {
        access: "new-access",
        refresh: "new-refresh",
        expires: Date.now() + 120_000,
      },
    });

    const store = new PiOAuthAuthStore(authFile);
    const resolved = await store.resolveApiKey("anthropic");

    expect(resolved.apiKey).toBe("refreshed-api-key");
    expect(resolved.credentials.access).toBe("new-access");

    const file = JSON.parse(readFileSync(authFile, "utf8"));
    expect(file.anthropic.access).toBe("new-access");
    expect(file.anthropic.refresh).toBe("new-refresh");
  });

  it("throws a parse error for invalid auth file JSON", async () => {
    writeFileSync(authFile, "{not-json");

    const store = new PiOAuthAuthStore(authFile);

    await expect(store.getStatus("anthropic")).rejects.toThrow(/Failed to parse auth file/);
  });

  it("uses the package-local OpenAI Codex login flow", async () => {
    oauthMocks.loginOpenAICodexWithOfficialFlow.mockResolvedValue({
      access: "codex-access",
      refresh: "codex-refresh",
      expires: Date.now() + 60_000,
      accountId: "acct_123",
    });

    const store = new PiOAuthAuthStore(authFile);
    const record = await store.login("openai-codex", {
      onAuth: vi.fn(),
      onPrompt: vi.fn(),
    });

    expect(oauthMocks.loginOpenAICodexWithOfficialFlow).toHaveBeenCalledTimes(1);
    expect(oauthMocks.provider.login).not.toHaveBeenCalled();
    expect(record.accountId).toBe("acct_123");
  });

  it("uses device auth for OpenAI Codex when requested", async () => {
    oauthMocks.loginOpenAICodexWithDeviceAuth.mockResolvedValue({
      access: "codex-device-access",
      refresh: "codex-device-refresh",
      expires: Date.now() + 60_000,
      accountId: "acct_device",
    });

    const store = new PiOAuthAuthStore(authFile);
    const record = await store.login("openai-codex", {
      onAuth: vi.fn(),
      onPrompt: vi.fn(),
    }, { deviceAuth: true });

    expect(oauthMocks.loginOpenAICodexWithDeviceAuth).toHaveBeenCalledTimes(1);
    expect(oauthMocks.loginOpenAICodexWithOfficialFlow).not.toHaveBeenCalled();
    expect(record.accountId).toBe("acct_device");
  });

  it("imports OpenAI Codex credentials from auth.json", async () => {
    oauthMocks.importOpenAICodexCredentialsFromCodexAuth.mockReturnValue({
      access: "imported-access",
      refresh: "imported-refresh",
      expires: Date.now() + 60_000,
      accountId: "acct_imported",
    });

    const store = new PiOAuthAuthStore(authFile);
    const record = await store.importOpenAICodexAuth("D:/tmp/.codex/auth.json");

    expect(oauthMocks.importOpenAICodexCredentialsFromCodexAuth).toHaveBeenCalledWith("D:/tmp/.codex/auth.json");
    expect(record.accountId).toBe("acct_imported");

    const file = JSON.parse(readFileSync(authFile, "utf8"));
    expect(file["openai-codex"]).toMatchObject({
      type: "oauth",
      access: "imported-access",
      refresh: "imported-refresh",
    });
  });
});
