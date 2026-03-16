import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai/oauth";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CALLBACK_PORT = 1455;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;
const SCOPE = "openid profile email offline_access api.connectors.read api.connectors.invoke";
const ORIGINATOR = "codex_cli_rs";
const DEVICE_AUTH_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const DEVICE_AUTH_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
const DEVICE_AUTH_VERIFICATION_URL = `${AUTH_BASE_URL}/codex/device`;
const DEVICE_AUTH_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;

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
  exp?: number;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
};

type DeviceCodeResponse = {
  device_auth_id: string;
  user_code: string;
  interval: string | number;
};

type DeviceCodePollSuccess = {
  authorization_code: string;
  code_challenge: string;
  code_verifier: string;
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

function getAccessTokenExpiry(accessToken: string): number | null {
  const payload = decodeJwt(accessToken);
  if (typeof payload?.exp !== "number") {
    return null;
  }
  return payload.exp * 1000;
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

async function requestDeviceCode(): Promise<{ deviceAuthId: string; userCode: string; intervalSeconds: number }> {
  const response = await fetch(DEVICE_AUTH_USER_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });

  if (!response.ok) {
    throw new Error(`Device code request failed with status ${response.status}`);
  }

  const json = (await response.json()) as Partial<DeviceCodeResponse>;
  const intervalRaw = typeof json.interval === "string" ? Number.parseInt(json.interval, 10) : json.interval;

  if (
    typeof json.device_auth_id !== "string"
    || typeof json.user_code !== "string"
    || typeof intervalRaw !== "number"
    || !Number.isFinite(intervalRaw)
  ) {
    throw new Error("Invalid device code response");
  }

  return {
    deviceAuthId: json.device_auth_id,
    userCode: json.user_code,
    intervalSeconds: intervalRaw,
  };
}

async function pollDeviceCodeAuthorization(
  deviceAuthId: string,
  userCode: string,
  intervalSeconds: number,
): Promise<DeviceCodePollSuccess> {
  const deadline = Date.now() + 15 * 60 * 1000;

  while (Date.now() < deadline) {
    const response = await fetch(DEVICE_AUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_auth_id: deviceAuthId,
        user_code: userCode,
      }),
    });

    if (response.ok) {
      const json = (await response.json()) as Partial<DeviceCodePollSuccess>;
      if (
        typeof json.authorization_code !== "string"
        || typeof json.code_challenge !== "string"
        || typeof json.code_verifier !== "string"
      ) {
        throw new Error("Invalid device auth completion response");
      }

      return {
        authorization_code: json.authorization_code,
        code_challenge: json.code_challenge,
        code_verifier: json.code_verifier,
      };
    }

    if (response.status !== 403 && response.status !== 404) {
      throw new Error(`Device auth failed with status ${response.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }

  throw new Error("Device auth timed out after 15 minutes");
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

export async function loginOpenAICodexWithDeviceAuth(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const deviceCode = await requestDeviceCode();

  callbacks.onAuth({
    url: DEVICE_AUTH_VERIFICATION_URL,
    instructions: `Enter code: ${deviceCode.userCode}`,
  });
  callbacks.onProgress?.("Waiting for device authorization...");

  const completed = await pollDeviceCodeAuthorization(
    deviceCode.deviceAuthId,
    deviceCode.userCode,
    deviceCode.intervalSeconds,
  );

  const tokenResult = await exchangeAuthorizationCode(
    completed.authorization_code,
    completed.code_verifier,
    DEVICE_AUTH_REDIRECT_URI,
  );

  if (tokenResult.type !== "success") {
    throw new Error("Device code exchange failed");
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
}

export function resolveDefaultCodexAuthFile(codexHome?: string): string {
  const home = codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  return join(home, "auth.json");
}

export function importOpenAICodexCredentialsFromCodexAuth(sourceAuthFile: string): OAuthCredentials {
  if (!existsSync(sourceAuthFile)) {
    throw new Error(`Codex auth file not found: ${sourceAuthFile}`);
  }

  const content = readFileSync(sourceAuthFile, "utf8");
  const parsed = JSON.parse(content) as {
    tokens?: {
      access_token?: string;
      refresh_token?: string;
      account_id?: string | null;
    };
  };

  const access = parsed.tokens?.access_token;
  const refresh = parsed.tokens?.refresh_token;

  if (typeof access !== "string" || typeof refresh !== "string") {
    throw new Error(`Codex auth file does not contain ChatGPT OAuth tokens: ${sourceAuthFile}`);
  }

  const expires = getAccessTokenExpiry(access);
  if (!expires) {
    throw new Error(`Failed to derive access token expiry from Codex auth file: ${sourceAuthFile}`);
  }

  const accountId = parsed.tokens?.account_id ?? getAccountId(access);
  if (typeof accountId !== "string" || accountId.length === 0) {
    throw new Error(`Failed to derive accountId from Codex auth file: ${sourceAuthFile}`);
  }

  return {
    access,
    refresh,
    expires,
    accountId,
  };
}
