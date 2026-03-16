import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stderr, stdin, stdout } from "node:process";

import { getOAuthProviders } from "@mariozechner/pi-ai/oauth";

import { resolveDefaultCodexAuthFile } from "./auth/openai-codex-login.js";
import { PiOAuthAuthStore } from "./auth/store.js";
import { runInteractiveUi } from "./cli-ui.js";
import { isPiOAuthProviderId, type PiOAuthProviderId } from "./types.js";

export async function runCli(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  switch (command) {
    case "providers":
      printProviders();
      return;
    case "status":
      await handleStatus(rest);
      return;
    case "login":
      await handleLogin(rest);
      return;
    case "logout":
      await handleLogout(rest);
      return;
    case "import-codex-auth":
      await handleImportCodexAuth(rest);
      return;
    case "ui":
      await handleUi(rest);
      return;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown command '${command}'.`);
  }
}

async function handleStatus(args: string[]): Promise<void> {
  const providerId = readProviderId(args);
  const authFile = readRequiredFlag(args, "--auth-file");
  const store = new PiOAuthAuthStore(authFile);
  const status = await store.getStatus(providerId);

  stdout.write(`${providerId}\n`);
  stdout.write(`stored: ${status.stored}\n`);
  stdout.write(`expired: ${status.expired ?? false}\n`);
  if (status.expiresAt) {
    stdout.write(`expiresAt: ${new Date(status.expiresAt).toISOString()}\n`);
  }
}

async function handleLogin(args: string[]): Promise<void> {
  const providerId = readProviderId(args);
  const authFile = readRequiredFlag(args, "--auth-file");
  const deviceAuth = hasFlag(args, "--device-auth");
  if (deviceAuth && providerId !== "openai-codex") {
    throw new Error("--device-auth is only supported for provider 'openai-codex'.");
  }
  const store = new PiOAuthAuthStore(authFile);
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const record = await store.login(providerId, {
      onAuth(info) {
        stderr.write(`Open this URL to continue authentication:\n${info.url}\n`);
        if (info.instructions) {
          stderr.write(`${info.instructions}\n`);
        }
        void openExternalUrl(info.url);
      },
      async onPrompt(prompt) {
        const answer = await rl.question(`${prompt.message}${prompt.placeholder ? ` (${prompt.placeholder})` : ""}: `);
        return answer;
      },
      async onManualCodeInput() {
        return rl.question("Paste the callback URL or device code: ");
      },
      onProgress(message) {
        stderr.write(`${message}\n`);
      },
    }, { deviceAuth });

    stdout.write(`Stored OAuth credentials for ${providerId} in ${authFile}\n`);
    stdout.write(`expiresAt: ${new Date(record.expires).toISOString()}\n`);
  } finally {
    rl.close();
  }
}

async function handleLogout(args: string[]): Promise<void> {
  const providerId = readProviderId(args);
  const authFile = readRequiredFlag(args, "--auth-file");
  const store = new PiOAuthAuthStore(authFile);
  await store.logout(providerId);
  stdout.write(`Removed stored OAuth credentials for ${providerId}\n`);
}

async function handleImportCodexAuth(args: string[]): Promise<void> {
  const authFile = readRequiredFlag(args, "--auth-file");
  const sourceAuthFile = readOptionalFlag(args, "--source")
    ?? resolveDefaultCodexAuthFile(readOptionalFlag(args, "--codex-home"));
  const store = new PiOAuthAuthStore(authFile);
  const record = await store.importOpenAICodexAuth(sourceAuthFile);
  stdout.write(`Imported OpenAI Codex credentials from ${sourceAuthFile}\n`);
  stdout.write(`expiresAt: ${new Date(record.expires).toISOString()}\n`);
}

async function handleUi(args: string[]): Promise<void> {
  const authFile = readRequiredFlag(args, "--auth-file");
  const codexHome = readOptionalFlag(args, "--codex-home");
  await runInteractiveUi({
    authFile,
    ...(codexHome ? { codexHome } : {}),
  });
}

function printProviders(): void {
  for (const provider of getOAuthProviders()) {
    stdout.write(`${provider.id}\t${provider.name}`);
    if (provider.usesCallbackServer) {
      stdout.write("\tcallback-server");
    }
    stdout.write("\n");
  }
}

function printHelp(): void {
  stdout.write("pi-oauth-ai-sdk\n\n");
  stdout.write("Commands:\n");
  stdout.write("  pi-oauth-ai-sdk providers\n");
  stdout.write("  pi-oauth-ai-sdk login --provider <id> --auth-file <path>\n");
  stdout.write("  pi-oauth-ai-sdk login --provider openai-codex --auth-file <path> --device-auth\n");
  stdout.write("  pi-oauth-ai-sdk import-codex-auth --auth-file <path> [--source <auth.json>] [--codex-home <dir>]\n");
  stdout.write("  pi-oauth-ai-sdk logout --provider <id> --auth-file <path>\n");
  stdout.write("  pi-oauth-ai-sdk status --provider <id> --auth-file <path>\n");
  stdout.write("  pi-oauth-ai-sdk ui --auth-file <path> [--codex-home <dir>]\n");
}

function readProviderId(args: string[]): PiOAuthProviderId {
  const value = readRequiredFlag(args, "--provider");
  if (!isPiOAuthProviderId(value)) {
    throw new Error(`Unknown provider '${value}'.`);
  }
  return value;
}

function readRequiredFlag(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index === -1 || !args[index + 1]) {
    throw new Error(`Missing required flag '${flag}'.`);
  }

  return args[index + 1]!;
}

function readOptionalFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1] ?? undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function openExternalUrl(url: string): Promise<void> {
  const command = process.platform === "win32"
    ? { file: "cmd", args: ["/c", "start", "", url] }
    : process.platform === "darwin"
      ? { file: "open", args: [url] }
      : { file: "xdg-open", args: [url] };

  await new Promise<void>((resolve) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
    });

    child.on("error", () => resolve());
    child.unref();
    resolve();
  });
}
