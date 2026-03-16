import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cliMocks = vi.hoisted(() => ({
  getOAuthProviders: vi.fn(),
  getStatus: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  importOpenAICodexAuth: vi.fn(),
  runInteractiveUi: vi.fn(),
  resolveDefaultCodexAuthFile: vi.fn(),
  authStoreCtor: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai/oauth", () => ({
  getOAuthProviders: cliMocks.getOAuthProviders,
}));

vi.mock("./auth/openai-codex-login.js", () => ({
  resolveDefaultCodexAuthFile: cliMocks.resolveDefaultCodexAuthFile,
}));

vi.mock("./cli-ui.js", () => ({
  runInteractiveUi: cliMocks.runInteractiveUi,
}));

vi.mock("./auth/store.js", () => ({
  PiOAuthAuthStore: class {
    authFile: string;

    constructor(authFile: string) {
      this.authFile = authFile;
      cliMocks.authStoreCtor(authFile);
    }

    getStatus = cliMocks.getStatus;
    login = cliMocks.login;
    logout = cliMocks.logout;
    importOpenAICodexAuth = cliMocks.importOpenAICodexAuth;
  },
}));

import { runCli } from "./cli-app.js";

describe("runCli", () => {
  beforeEach(() => {
    cliMocks.getOAuthProviders.mockReset();
    cliMocks.getStatus.mockReset();
    cliMocks.login.mockReset();
    cliMocks.logout.mockReset();
    cliMocks.importOpenAICodexAuth.mockReset();
    cliMocks.runInteractiveUi.mockReset();
    cliMocks.resolveDefaultCodexAuthFile.mockReset();
    cliMocks.authStoreCtor.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints available providers", async () => {
    cliMocks.getOAuthProviders.mockReturnValue([
      { id: "anthropic", name: "Anthropic", usesCallbackServer: true },
    ]);

    await runCli(["providers"]);

    expect(cliMocks.getOAuthProviders).toHaveBeenCalledTimes(1);
  });

  it("prints provider status", async () => {
    cliMocks.getStatus.mockResolvedValue({
      providerId: "anthropic",
      stored: true,
      expired: false,
      expiresAt: 1_700_000_000_000,
    });

    await runCli(["status", "--provider", "anthropic", "--auth-file", "D:/tmp/auth.json"]);

    expect(cliMocks.authStoreCtor).toHaveBeenCalledWith("D:/tmp/auth.json");
    expect(cliMocks.getStatus).toHaveBeenCalledWith("anthropic");
  });

  it("passes the device auth flag through to login", async () => {
    cliMocks.login.mockResolvedValue({
      expires: 1_700_000_000_000,
    });

    await runCli(["login", "--provider", "openai-codex", "--auth-file", "D:/tmp/auth.json", "--device-auth"]);

    expect(cliMocks.login.mock.calls[0]?.[2]).toEqual({ deviceAuth: true });
  });

  it("imports Codex auth from the detected default path", async () => {
    cliMocks.resolveDefaultCodexAuthFile.mockReturnValue("D:/Users/test/.codex/auth.json");
    cliMocks.importOpenAICodexAuth.mockResolvedValue({
      expires: 1_700_000_000_000,
    });

    await runCli(["import-codex-auth", "--auth-file", "D:/tmp/auth.json"]);

    expect(cliMocks.importOpenAICodexAuth).toHaveBeenCalledWith("D:/Users/test/.codex/auth.json");
  });

  it("runs the interactive UI command", async () => {
    await runCli(["ui", "--auth-file", "D:/tmp/auth.json", "--codex-home", "D:/Users/test/.codex"]);

    expect(cliMocks.runInteractiveUi).toHaveBeenCalledWith({
      authFile: "D:/tmp/auth.json",
      codexHome: "D:/Users/test/.codex",
    });
  });
});
