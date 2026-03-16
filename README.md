# ai-sdk-oauth-providers

OAuth-backed AI SDK `ProviderV3` implementations for:

- OpenAI Codex
- Anthropic OAuth / Claude Code
- Gemini CLI / Google Cloud Code Assist

This package targets Node 20+, AI SDK v6, and latest Mastra. It uses
`@mariozechner/pi-ai/oauth` for login and refresh only, then talks to each
provider with package-owned transports.

It also exposes a thin `languageModelV2(modelId)` compatibility surface for
older consumers that still need the AI SDK V2 language-model contract.

`pi-oauth-ai-sdk` is being retired in favor of this package. New integration
work should target `ai-sdk-oauth-providers`.

## Scope

This package is intentionally scoped to AI SDK language models:

- text generation
- streaming
- tool calling
- JSON compatibility mode for object generation
- OAuth login, refresh, and local credential persistence

It does not implement embeddings, images, speech, transcription, reranking, or
multimodal file/url handling in `v1`.

## Install

```bash
npm install ai @ai-sdk/provider ai-sdk-oauth-providers
```

## Verified Baseline

Last verified: March 16, 2026

- `ai@6.0.116`
- `@ai-sdk/provider@3.0.8`
- `@mastra/core@1.13.2`
- `@mariozechner/pi-ai@0.58.4` for OAuth only

The detailed compatibility matrix lives in
[`docs/compatibility.md`](./docs/compatibility.md).

## Providers

| Provider factory | OAuth source | Notes |
| --- | --- | --- |
| `createOpenAICodexOAuth` | ChatGPT / Codex OAuth | Experimental. Prefer importing existing Codex auth or device auth. |
| `createAnthropicOAuth` | Anthropic OAuth / Claude Code | Uses direct Messages API transport with Claude Code OAuth headers. |
| `createGeminiCliOAuth` | Gemini CLI / Cloud Code Assist OAuth | Requires persisted `projectId`. |

## CLI

The package ships a CLI for auth management:

```bash
npx ai-sdk-oauth-providers providers
```

```bash
npx ai-sdk-oauth-providers login --provider anthropic --auth-file ./.auth/oauth.json
```

```bash
npx ai-sdk-oauth-providers login --provider openai-codex --auth-file ./.auth/oauth.json --device-auth
```

```bash
npx ai-sdk-oauth-providers import-codex-auth --auth-file ./.auth/oauth.json
```

```bash
npx ai-sdk-oauth-providers status --provider google-gemini-cli --auth-file ./.auth/oauth.json
```

```bash
npx ai-sdk-oauth-providers logout --provider openai-codex --auth-file ./.auth/oauth.json
```

### Codex auth guidance

For Codex, the recommended order is:

1. `import-codex-auth` from an existing official Codex CLI login
2. `login --device-auth`
3. browser OAuth fallback

Browser OAuth is kept for completeness, but the underlying Codex auth contract
has drifted historically and is documented as experimental.

## AI SDK Usage

### Direct provider

```ts
import { generateText } from "ai";
import { createOpenAICodexOAuth } from "ai-sdk-oauth-providers";

const codex = createOpenAICodexOAuth({
  authFile: "./.auth/oauth.json",
});

const result = await generateText({
  model: codex.languageModel("gpt-5.4"),
  prompt: "Reply with exactly: pong",
});

console.log(result.text);
```

### Legacy V2 compatibility

If you still need the older `LanguageModelV2` contract, use the thin
compatibility export on the same provider instance:

```ts
import { createAnthropicOAuth } from "ai-sdk-oauth-providers";

const anthropic = createAnthropicOAuth({
  authFile: "./.auth/oauth.json",
});

const model = anthropic.languageModelV2("claude-sonnet-4-5");

const result = await model.doGenerate({
  prompt: [{ role: "user", content: [{ type: "text", text: "Reply with exactly pong" }] }],
});

console.log(result.content);
```

### Provider registry composition

Use AI SDK's native `createProviderRegistry` when you want one shared registry:

```ts
import { createProviderRegistry, generateText } from "ai";
import {
  createAnthropicOAuth,
  createGeminiCliOAuth,
  createOpenAICodexOAuth,
} from "ai-sdk-oauth-providers";

const authFile = "./.auth/oauth.json";

const registry = createProviderRegistry({
  providers: {
    codex: createOpenAICodexOAuth({ authFile }),
    anthropic: createAnthropicOAuth({ authFile }),
    gemini: createGeminiCliOAuth({ authFile }),
  },
});

const result = await generateText({
  model: registry.languageModel("codex:gpt-5.4"),
  prompt: "Reply with exactly: registry-ok",
});

console.log(result.text);
```

### Object generation

This package currently uses a deterministic JSON compatibility mode rather than
claiming a native vendor-specific JSON schema contract for every OAuth backend.
That means `generateObject` and `streamObject` work by steering the backend to
return raw JSON text that AI SDK then validates.

## Mastra Usage

Latest Mastra still has agent-layer bugs around `output` and `clientTools`.
This package ships `withMastraCompat(...)` as a pragmatic wrapper:

```ts
import { Agent } from "@mastra/core/agent";
import { tool } from "ai";
import { z } from "zod";

import { createOpenAICodexOAuth } from "ai-sdk-oauth-providers";
import { withMastraCompat } from "ai-sdk-oauth-providers/mastra";

const provider = createOpenAICodexOAuth({
  authFile: "./.auth/oauth.json",
});

const weatherTool = tool({
  description: "Return a canned weather forecast.",
  inputSchema: z.object({
    city: z.string(),
  }),
  execute: async ({ city }) => ({
    forecast: `clear-skies-for-${city.toLowerCase()}`,
  }),
});

const agent = withMastraCompat(new Agent({
  id: "oauth-agent",
  name: "OAuth Agent",
  instructions: "You are a concise assistant.",
  model: provider.languageModel("gpt-5.4"),
  tools: {
    weather: weatherTool,
  },
}));

const result = await agent.generate(
  "Use the weather tool for Calgary, then reply with exactly the forecast string and nothing else.",
  { maxSteps: 3 },
);

console.log(result.text);
```

`withMastraCompat(...)` currently does two things:

- maps `output` to `structuredOutput`
- temporarily promotes per-call `clientTools` into agent tools for that call

## Contract Docs

Transport and compatibility references live here:

- [`docs/contracts/ai-sdk-v3-baseline.md`](./docs/contracts/ai-sdk-v3-baseline.md)
- [`docs/contracts/openai-codex-oauth.md`](./docs/contracts/openai-codex-oauth.md)
- [`docs/contracts/anthropic-oauth.md`](./docs/contracts/anthropic-oauth.md)
- [`docs/contracts/gemini-cli-oauth.md`](./docs/contracts/gemini-cli-oauth.md)
- [`docs/compatibility.md`](./docs/compatibility.md)
- [`docs/maintenance.md`](./docs/maintenance.md)

These files are the reference point for future contract drift, compatibility
updates, and release maintenance.
