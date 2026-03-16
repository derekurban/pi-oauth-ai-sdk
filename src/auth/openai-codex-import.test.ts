import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { importOpenAICodexCredentialsFromCodexAuth } from "./openai-codex-login.js";

const ACCESS_TOKEN =
  "eyJhbGciOiJub25lIn0.eyJleHAiOjQxMDAwMDAwMDAsImh0dHBzOi8vYXBpLm9wZW5haS5jb20vYXV0aCI6eyJjaGF0Z3B0X2FjY291bnRfaWQiOiJhY2N0XzEyMyJ9fQ.";

describe("importOpenAICodexCredentialsFromCodexAuth", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads Codex auth.json tokens into the package credential shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-oauth-codex-import-"));
    tempDirs.push(dir);
    const authFile = join(dir, "auth.json");

    writeFileSync(authFile, JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        id_token: "ignored",
        access_token: ACCESS_TOKEN,
        refresh_token: "refresh-token",
        account_id: "acct_123",
      },
    }));

    const credentials = importOpenAICodexCredentialsFromCodexAuth(authFile);
    expect(credentials).toMatchObject({
      access: ACCESS_TOKEN,
      refresh: "refresh-token",
      accountId: "acct_123",
      expires: 4_100_000_000_000,
    });
  });
});
