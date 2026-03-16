import { describe, expect, it } from "vitest";

import { buildOpenAICodexAuthorizeUrl } from "./openai-codex-login.js";

describe("buildOpenAICodexAuthorizeUrl", () => {
  it("uses the current official Codex originator and scope", () => {
    const url = new URL(buildOpenAICodexAuthorizeUrl({
      redirectUri: "http://localhost:1455/auth/callback",
      challenge: "challenge-value",
      state: "state-value",
    }));

    expect(url.origin + url.pathname).toBe("https://auth.openai.com/oauth/authorize");
    expect(url.searchParams.get("originator")).toBe("codex_cli_rs");
    expect(url.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    expect(url.searchParams.get("id_token_add_organizations")).toBe("true");
    expect(url.searchParams.get("scope")).toBe(
      "openid profile email offline_access api.connectors.read api.connectors.invoke",
    );
  });
});
