import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stderr, stdin, stdout } from "node:process";

import { PiOAuthAuthStore } from "./auth/store.js";
import { resolveDefaultCodexAuthFile } from "./auth/openai-codex-login.js";
import type { PiOAuthProviderId } from "./types.js";

type UiIo = {
  question(prompt: string): Promise<string>;
  write(message: string): void;
  error(message: string): void;
  close(): void;
};

type UiOptions = {
  authFile: string;
  codexHome?: string;
};

export async function runInteractiveUi(options: UiOptions): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  const io: UiIo = {
    question: (prompt) => rl.question(prompt),
    write: (message) => stdout.write(message),
    error: (message) => stderr.write(message),
    close: () => rl.close(),
  };

  try {
    await runInteractiveUiWithIo(options, io);
  } finally {
    io.close();
  }
}

export async function runInteractiveUiWithIo(options: UiOptions, io: UiIo): Promise<void> {
  const store = new PiOAuthAuthStore(options.authFile);

  while (true) {
    io.write("\npi-oauth-ai-sdk\n");
    io.write(`auth file: ${options.authFile}\n`);
    io.write("1. Login\n");
    io.write("2. Import Codex auth\n");
    io.write("3. Status\n");
    io.write("4. Logout\n");
    io.write("5. Providers\n");
    io.write("6. Exit\n");

    const choice = (await io.question("Choose an action: ")).trim().toLowerCase();
    switch (choice) {
      case "1":
      case "login":
        await runLoginAction(store, io, options);
        break;
      case "2":
      case "import":
        await runImportAction(store, io, options);
        break;
      case "3":
      case "status":
        await runStatusAction(store, io);
        break;
      case "4":
      case "logout":
        await runLogoutAction(store, io);
        break;
      case "5":
      case "providers":
        runProvidersAction(store, io);
        break;
      case "6":
      case "exit":
      case "quit":
      case "q":
        return;
      default:
        io.error("Unknown action.\n");
    }
  }
}

async function runLoginAction(store: PiOAuthAuthStore, io: UiIo, options: UiOptions): Promise<void> {
  const providerId = await promptForProvider(store, io);
  let deviceAuth = false;

  if (providerId === "openai-codex") {
    io.write("1. Browser login\n");
    io.write("2. Device auth\n");
    io.write("3. Import existing Codex auth.json\n");
    const method = (await io.question("Choose OpenAI Codex auth method: ")).trim().toLowerCase();

    if (method === "2" || method === "device") {
      deviceAuth = true;
    } else if (method === "3" || method === "import") {
      await runImportAction(store, io, options);
      return;
    }
  }

  const record = await store.login(providerId, {
    onAuth(info) {
      io.error(`Open this URL to continue authentication:\n${info.url}\n`);
      if (info.instructions) {
        io.error(`${info.instructions}\n`);
      }
      void openExternalUrl(info.url);
    },
    async onPrompt(prompt) {
      return io.question(`${prompt.message}${prompt.placeholder ? ` (${prompt.placeholder})` : ""}: `);
    },
    async onManualCodeInput() {
      return io.question("Paste the callback URL or device code: ");
    },
    onProgress(message) {
      io.error(`${message}\n`);
    },
  }, { deviceAuth });

  io.write(`Stored OAuth credentials for ${providerId} in ${store.authFile}\n`);
  io.write(`expiresAt: ${new Date(record.expires).toISOString()}\n`);
}

async function runImportAction(store: PiOAuthAuthStore, io: UiIo, options: UiOptions): Promise<void> {
  const detected = resolveDefaultCodexAuthFile(options.codexHome);
  let source = detected;

  if (!existsSync(source)) {
    io.error(`No Codex auth.json found at ${source}\n`);
    source = (await io.question("Enter the path to Codex auth.json: ")).trim();
  } else {
    io.write(`Using Codex auth.json at ${source}\n`);
  }

  const record = await store.importOpenAICodexAuth(source);
  io.write(`Imported OpenAI Codex credentials from ${source}\n`);
  io.write(`expiresAt: ${new Date(record.expires).toISOString()}\n`);
}

async function runStatusAction(store: PiOAuthAuthStore, io: UiIo): Promise<void> {
  const providerId = await promptForProvider(store, io);
  const status = await store.getStatus(providerId);

  io.write(`${providerId}\n`);
  io.write(`stored: ${status.stored}\n`);
  io.write(`expired: ${status.expired ?? false}\n`);
  if (status.expiresAt) {
    io.write(`expiresAt: ${new Date(status.expiresAt).toISOString()}\n`);
  }
}

async function runLogoutAction(store: PiOAuthAuthStore, io: UiIo): Promise<void> {
  const providerId = await promptForProvider(store, io);
  await store.logout(providerId);
  io.write(`Removed stored OAuth credentials for ${providerId}\n`);
}

function runProvidersAction(store: PiOAuthAuthStore, io: UiIo): void {
  for (const provider of store.getProviders()) {
    io.write(`${provider.id}\t${provider.name}`);
    if (provider.usesCallbackServer) {
      io.write("\tcallback-server");
    }
    io.write("\n");
  }
}

async function promptForProvider(store: PiOAuthAuthStore, io: UiIo): Promise<PiOAuthProviderId> {
  const providers = store.getProviders();
  providers.forEach((provider, index) => {
    io.write(`${index + 1}. ${provider.id} - ${provider.name}\n`);
  });

  const answer = (await io.question("Choose a provider: ")).trim();
  const numeric = Number.parseInt(answer, 10);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= providers.length) {
    return providers[numeric - 1]!.id as PiOAuthProviderId;
  }

  const matched = providers.find((provider) => provider.id === answer);
  if (!matched) {
    throw new Error(`Unknown provider '${answer}'.`);
  }

  return matched.id as PiOAuthProviderId;
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
