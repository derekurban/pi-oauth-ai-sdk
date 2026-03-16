# pi-oauth-ai-sdk

`pi-oauth-ai-sdk` exposes OAuth-backed Pi AI providers as AI SDK language models.

It is built for one job: reuse the OAuth flows and token refresh behavior from [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai), then surface those providers through a small API that fits the AI SDK provider model.

## Features

- Supports Pi AI OAuth providers without reimplementing their login flows
- Persists credentials to a JSON auth file you control
- Refreshes expired tokens automatically
- Exposes AI SDK `LanguageModelV2` and `LanguageModelV3` adapters
- Includes a CLI for `login`, `logout`, `status`, and provider discovery

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

First, authenticate a provider and write credentials to an auth file:

```bash
npx pi-oauth-ai-sdk login --provider anthropic --auth-file ./.auth/pi-oauth.json
```

Then use that auth file from your application:

```ts
import { generateText } from "ai";
import { createAnthropicProvider } from "pi-oauth-ai-sdk";

const provider = createAnthropicProvider({
  authFile: "./.auth/pi-oauth.json",
});

const result = await generateText({
  model: provider.languageModelV3("claude-sonnet-4-5"),
  prompt: "Write a short release note for a new SDK package.",
});

console.log(result.text);
```

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

## CLI

```bash
pi-oauth-ai-sdk providers
pi-oauth-ai-sdk login --provider anthropic --auth-file ./.auth/pi-oauth.json
pi-oauth-ai-sdk status --provider anthropic --auth-file ./.auth/pi-oauth.json
pi-oauth-ai-sdk logout --provider anthropic --auth-file ./.auth/pi-oauth.json
```

`providers` prints the provider ids supported by the installed version of `@mariozechner/pi-ai`.

## Auth Storage

Credentials are stored in a JSON file keyed by provider id. The file is managed by the package and refreshed credentials are written back automatically after token renewal.

Example:

```json
{
  "anthropic": {
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
