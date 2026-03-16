import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai/oauth";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CALLBACK_PORT = 1455;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;
const SCOPE = "openid profile email offline_access api.connectors.read api.connectors.invoke";
const ORIGINATOR = "codex_cli_rs";

const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authentication successful</title>
</head>
<body>
  <p>Authentication successful. Return to your terminal to continue.</p>
</body>
</html>`;

type TokenResult =
  | { type: "success"; access: string; refresh: string; expires: number }
  | { type: "failed" };

type OAuthServerInfo = {
  close: () => void;
  cancelWait: () => void;
  waitForCode: () => Promise<{ code: string } | null>;
};

type JwtPayload = {
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
};

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function createState(): string {
  return randomBytes(32).toString("base64url");
}

export function buildOpenAICodexAuthorizeUrl(input: {
  redirectUri: string;
  challenge: string;
  state: string;
  originator?: string;
}): string {
  const originator = input.originator ?? ORIGINATOR;
  const params: Array<[string, string]> = [
    ["response_type", "code"],
    ["client_id", CLIENT_ID],
    ["redirect_uri", input.redirectUri],
    ["scope", SCOPE],
    ["code_challenge", input.challenge],
    ["code_challenge_method", "S256"],
    ["id_token_add_organizations", "true"],
    ["codex_cli_simplified_flow", "true"],
    ["state", input.state],
    ["originator", originator],
  ];

  const query = params
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  return `${AUTHORIZE_URL}?${query}`;
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) return {};

  try {
    const url = new URL(value);
    return compactAuthorizationResult(
      url.searchParams.get("code") ?? undefined,
      url.searchParams.get("state") ?? undefined,
    );
  } catch {
    // Not a URL.
  }

  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return compactAuthorizationResult(
      params.get("code") ?? undefined,
      params.get("state") ?? undefined,
    );
  }

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return compactAuthorizationResult(code, state);
  }

  return { code: value };
}

function compactAuthorizationResult(code?: string, state?: string): { code?: string; state?: string } {
  const result: { code?: string; state?: string } = {};
  if (code) {
    result.code = code;
  }
  if (state) {
    result.state = state;
  }
  return result;
}

function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) {
      return null;
    }
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as JwtPayload;
  } catch {
    return null;
  }
}

function getAccountId(accessToken: string): string | null {
  const payload = decodeJwt(accessToken);
  const accountId = payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
  return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}

async function exchangeAuthorizationCode(code: string, verifier: string, redirectUri: string): Promise<TokenResult> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    return { type: "failed" };
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
    return { type: "failed" };
  }

  return {
    type: "success",
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
  };
}

async function startLocalOAuthServer(state: string): Promise<OAuthServerInfo> {
  let lastCode: string | null = null;
  let cancelled = false;

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || "", "http://localhost");
      if (url.pathname !== "/auth/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      if (url.searchParams.get("state") !== state) {
        res.statusCode = 400;
        res.end("State mismatch");
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res.statusCode = 400;
        res.end("Missing authorization code");
        return;
      }

      lastCode = code;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(SUCCESS_HTML);
    } catch {
      res.statusCode = 500;
      res.end("Internal error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`OpenAI Codex OAuth requires port ${CALLBACK_PORT} to be available on localhost.`));
        return;
      }
      reject(error);
    });
    server.listen(CALLBACK_PORT, "127.0.0.1", () => resolve());
  });

  return {
    close: () => server.close(),
    cancelWait: () => {
      cancelled = true;
    },
    waitForCode: async () => {
      const sleep = () => new Promise((resolve) => setTimeout(resolve, 100));
      for (let i = 0; i < 600; i += 1) {
        if (lastCode) return { code: lastCode };
        if (cancelled) return null;
        await sleep();
      }
      return null;
    },
  };
}

export async function loginOpenAICodexWithOfficialFlow(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const { verifier, challenge } = generatePkce();
  const state = createState();
  const server = await startLocalOAuthServer(state);
  const url = buildOpenAICodexAuthorizeUrl({
    redirectUri: REDIRECT_URI,
    challenge,
    state,
  });

  callbacks.onAuth({
    url,
    instructions: "A browser window should open. Complete login to finish.",
  });

  let code: string | undefined;

  try {
    if (callbacks.onManualCodeInput) {
      let manualCode: string | undefined;
      let manualError: Error | undefined;

      const manualPromise = callbacks.onManualCodeInput()
        .then((input) => {
          manualCode = input;
          server.cancelWait();
        })
        .catch((error) => {
          manualError = error instanceof Error ? error : new Error(String(error));
          server.cancelWait();
        });

      const result = await server.waitForCode();
      if (manualError) {
        throw manualError;
      }

      if (result?.code) {
        code = result.code;
      } else if (manualCode) {
        const parsed = parseAuthorizationInput(manualCode);
        if (parsed.state && parsed.state !== state) {
          throw new Error("State mismatch");
        }
        code = parsed.code;
      }

      if (!code) {
        await manualPromise;
        if (manualError) {
          throw manualError;
        }
        if (manualCode) {
          const parsed = parseAuthorizationInput(manualCode);
          if (parsed.state && parsed.state !== state) {
            throw new Error("State mismatch");
          }
          code = parsed.code;
        }
      }
    } else {
      const result = await server.waitForCode();
      if (result?.code) {
        code = result.code;
      }
    }

    if (!code) {
      const input = await callbacks.onPrompt({
        message: "Paste the authorization code (or full redirect URL):",
      });
      const parsed = parseAuthorizationInput(input);
      if (parsed.state && parsed.state !== state) {
        throw new Error("State mismatch");
      }
      code = parsed.code;
    }

    if (!code) {
      throw new Error("Missing authorization code");
    }

    const tokenResult = await exchangeAuthorizationCode(code, verifier, REDIRECT_URI);
    if (tokenResult.type !== "success") {
      throw new Error("Token exchange failed");
    }

    const accountId = getAccountId(tokenResult.access);
    if (!accountId) {
      throw new Error("Failed to extract accountId from token");
    }

    return {
      access: tokenResult.access,
      refresh: tokenResult.refresh,
      expires: tokenResult.expires,
      accountId,
    };
  } finally {
    server.close();
  }
}
