# pi-oauth-ai-sdk

Lightweight AI SDK adapters for the OAuth-capable providers exposed by [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai).

This package is focused on one thing: reusing Pi AI's OAuth flows and token refresh logic, then exposing those providers as AI SDK language models.

## Supported providers

- `anthropic`
- `github-copilot`
- `openai-codex`
- `google-gemini-cli`
- `google-antigravity`

## Supported AI SDK interfaces

- `LanguageModelV2`
- `LanguageModelV3`

## Install

```bash
npm install pi-oauth-ai-sdk
```

## Usage

```ts
import { createAnthropicProvider } from "pi-oauth-ai-sdk";

const provider = createAnthropicProvider({
  authFile: "./.auth/pi-oauth.json",
});

const model = provider.languageModelV3("claude-sonnet-4-5");
```

## CLI

```bash
pi-oauth-ai-sdk providers
pi-oauth-ai-sdk login --provider anthropic --auth-file ./.auth/pi-oauth.json
pi-oauth-ai-sdk status --provider anthropic --auth-file ./.auth/pi-oauth.json
pi-oauth-ai-sdk logout --provider anthropic --auth-file ./.auth/pi-oauth.json
```

## Release

CI runs on pushes and pull requests.

Publishing is handled by GitHub Actions on version tags:

- tag format: `v*`
- example: `v0.1.0`

To enable npm publishing, add this repository secret in GitHub Actions:

- `NPM_TOKEN`: an npm automation token with publish rights for this package

The publish workflow also supports manual dispatch so an existing tag can be published after secrets are added.
