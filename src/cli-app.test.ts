import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cliMocks = vi.hoisted(() => ({
  getOAuthProviders: vi.fn(),
  getStatus: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  authStoreCtor: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai/oauth", () => ({
  getOAuthProviders: cliMocks.getOAuthProviders,
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
  },
}));

import { runCli } from "./cli-app.js";

describe("runCli", () => {
  beforeEach(() => {
    cliMocks.getOAuthProviders.mockReset();
    cliMocks.getStatus.mockReset();
    cliMocks.login.mockReset();
    cliMocks.logout.mockReset();
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
});
