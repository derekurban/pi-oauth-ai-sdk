# pi-oauth-ai-sdk

`pi-oauth-ai-sdk` exposes OAuth-backed Pi AI providers as AI SDK language models.

It is built for one job: reuse the OAuth flows and token refresh behavior from [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai), then surface those providers through a small API that fits the AI SDK provider model.

## Features

- Supports Pi AI OAuth providers without reimplementing their login flows
- Persists credentials to a JSON auth file you control
- Refreshes expired tokens automatically
- Exposes AI SDK `LanguageModelV2` and `LanguageModelV3` adapters
- Includes a CLI for `login`, `logout`, `status`, and provider discovery
- Supports OpenAI Codex device auth
- Can import existing OpenAI Codex credentials from `~/.codex/auth.json`
- Includes a minimal interactive terminal UI

## Supported Providers

- `anthropic`
- `github-copilot`
- `openai-codex`
- `google-gemini-cli`
- `google-antigravity`

## Installation

```bash
npm install pi-oauth-ai-sdk
```

## Quick Start

If you already use the official Codex CLI, import that login into a local auth file:

```bash
npx pi-oauth-ai-sdk import-codex-auth --auth-file ./.auth/pi-oauth.json
```

If you want this package to handle Codex login directly, use device auth:

```bash
npx pi-oauth-ai-sdk login --provider openai-codex --auth-file ./.auth/pi-oauth.json --device-auth
```

You can also use the browser login flow:

```bash
npx pi-oauth-ai-sdk login --provider openai-codex --auth-file ./.auth/pi-oauth.json
```

Then use that auth file from your application:

```ts
import { generateText, streamText } from "ai";
import { createOpenAICodexProvider } from "pi-oauth-ai-sdk";

const provider = createOpenAICodexProvider({
  authFile: "./.auth/pi-oauth.json",
});

const model = provider.languageModelV3("gpt-5.4");

const result = await generateText({
  model,
  prompt: "Reply with exactly: pong-from-codex",
  maxOutputTokens: 32,
});

console.log(result.text);

const streamed = streamText({
  model,
  prompt: "Reply with exactly: streamed-pong-from-codex",
  maxOutputTokens: 32,
});

for await (const chunk of streamed.textStream) {
  process.stdout.write(chunk);
}
```

That flow was tested live against imported Codex credentials during package development.

## API

The package exports one factory per supported provider:

- `createAnthropicProvider`
- `createGitHubCopilotProvider`
- `createOpenAICodexProvider`
- `createGeminiCliProvider`
- `createAntigravityProvider`

Each factory accepts:

```ts
{
  authFile: string;
  fetch?: typeof globalThis.fetch;
}
```

Each provider instance exposes:

- `languageModelV2(modelId: string)`
- `languageModelV3(modelId: string)`

## Mastra Compatibility

Latest Mastra currently has two agent-level issues that affect this package's AI SDK models:

- `Agent.generate(..., { output })` drops `output` before it reaches Mastra's structured output path
- per-call `clientTools` lose their executor during Mastra tool conversion

This package includes a small workaround helper for that case:

```ts
import { Agent } from "@mastra/core/agent";
import { tool } from "ai";
import { z } from "zod";

import { createOpenAICodexProvider, withMastraCompat } from "pi-oauth-ai-sdk";

const provider = createOpenAICodexProvider({
  authFile: "./.auth/pi-oauth.json",
});

const model = provider.languageModelV3("gpt-5.4");

const weather = tool({
  description: "Return a canned weather string for a city.",
  inputSchema: z.object({
    city: z.string(),
  }),
  execute: async ({ city }) => {
    return { forecast: `clear-skies-for-${city.toLowerCase()}` };
  },
});

const agent = withMastraCompat(new Agent({
  id: "codex-master",
  name: "Codex Master",
  instructions: "You are a concise assistant.",
  model,
}));

const toolResult = await agent.generate(
  "Use the weather tool for Calgary, then reply with exactly the forecast string and nothing else.",
  {
    clientTools: { weather },
    maxSteps: 3,
  },
);

console.log(toolResult.text);

const structured = await agent.generate(
  "Return an object with status set to ok and code set to 7.",
  {
    output: z.object({
      status: z.string(),
      code: z.number(),
    }),
  },
);

console.log(structured.object);
```

`withMastraCompat(...)` does two things:

- maps `output` to Mastra's `structuredOutput` option
- temporarily promotes per-call `clientTools` into agent tools for that call, then restores the original tool set

## CLI

```bash
pi-oauth-ai-sdk providers
pi-oauth-ai-sdk import-codex-auth --auth-file ./.auth/pi-oauth.json
pi-oauth-ai-sdk login --provider openai-codex --auth-file ./.auth/pi-oauth.json --device-auth
pi-oauth-ai-sdk login --provider openai-codex --auth-file ./.auth/pi-oauth.json
pi-oauth-ai-sdk status --provider openai-codex --auth-file ./.auth/pi-oauth.json
pi-oauth-ai-sdk logout --provider openai-codex --auth-file ./.auth/pi-oauth.json
pi-oauth-ai-sdk ui --auth-file ./.auth/pi-oauth.json
```

`providers` prints the provider ids supported by the installed version of `@mariozechner/pi-ai`.

### OpenAI Codex options

- Browser login: `login --provider openai-codex --auth-file <path>`
- Device auth: `login --provider openai-codex --auth-file <path> --device-auth`
- Import from official Codex auth: `import-codex-auth --auth-file <path>`

`import-codex-auth` auto-detects `CODEX_HOME/auth.json` or `~/.codex/auth.json` unless you provide `--source` or `--codex-home`.

### Interactive UI

The `ui` command opens a minimal terminal menu for login, Codex auth import, status checks, logout, and provider listing:

```bash
pi-oauth-ai-sdk ui --auth-file ./.auth/pi-oauth.json
```

## Auth Storage

Credentials are stored in a JSON file keyed by provider id. The file is managed by the package and refreshed credentials are written back automatically after token renewal.

Example:

```json
{
  "openai-codex": {
    "type": "oauth",
    "access": "...",
    "refresh": "...",
    "expires": 1760000000000
  }
}
```

## Release Process

This repository includes GitHub Actions for:

- CI on pushes to `main` and pull requests
- npm publishing on version tags matching `v*`
- manual publish reruns for an existing tag through `workflow_dispatch`

To publish from GitHub Actions, add an `NPM_TOKEN` repository secret with permission to publish the package.
