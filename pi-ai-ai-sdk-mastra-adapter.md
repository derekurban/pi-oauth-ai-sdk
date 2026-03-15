# Pi-AI Adapter Strategy for AI SDK and Mastra

Status: implementation design. This document describes how to put a stable application-facing layer on top of `pi-ai` so the rest of your system can speak AI SDK and Mastra instead of dealing with provider-specific auth and transport details directly.

## 1. Goal

Build one reusable adapter layer that does all of the following:
- routes model access through `pi-ai`
- centralizes auth and token refresh for subscription-based and coding-focused providers
- exposes AI SDK-compatible language models
- plugs directly into Mastra through AI SDK model compatibility
- keeps provider-specific logic out of your agent runtime

The design target is:

```txt
Mastra agents / AI SDK callers
        ->
AI SDK-compatible adapter
        ->
Pi-AI model + auth layer
        ->
provider-specific OAuth / API-key / backend transport
```

If you route everything through `pi-ai`, you do remove a lot of surface-area headaches. But you do not remove all of them. The auth and backend quirks still exist. You are just isolating them in one place.

## 2. Why this is the right seam

`pi-ai` already owns the hard parts you do not want duplicated across multiple frameworks:
- model discovery
- provider-specific request transforms
- tool-call normalization
- streaming event normalization
- usage normalization
- OAuth helpers for subscription-backed providers
- provider-specific transport decisions like SSE vs WebSocket

The AI SDK and Mastra are good consumers of normalized model behavior, but they are not where you want to own the auth or backend reverse-engineering.

So the clean split is:
- `pi-ai` is your provider runtime and auth substrate
- AI SDK is your application-facing model interface
- Mastra is your orchestration layer on top of the AI SDK-compatible model

## 3. What the integration looks like in practice

## 3.1 One adapter package

Create a dedicated package or module, for example:

- `packages/pi-ai-ai-sdk-adapter`
- or `src/llm/pi-ai-adapter`

That package should expose:
- `createPiAiLanguageModel()` for AI SDK
- `createPiAiProvider()` for AI SDK provider registries
- optional `createPiAiMastraGateway()` for string-based Mastra model selection
- auth helpers that resolve `pi-ai` credentials before model execution

## 3.2 Core design principle

Do not let Mastra or application code talk to subscription model auth directly.

Instead:
- application code asks for a model by logical id
- adapter resolves a `pi-ai` provider/model pair
- adapter resolves auth through `pi-ai` credentials or your own credential store that mirrors `pi-ai`
- adapter calls `pi-ai.complete()` or `pi-ai.stream()`
- adapter translates the result to AI SDK primitives

## 4. The two compatibility layers you need

## 4.1 Layer 1: Pi-AI -> AI SDK

This is the main adapter.

You implement an AI SDK `LanguageModelV2` or `LanguageModelV3` object whose internals call `pi-ai`.

That object needs:
- `specificationVersion`
- `provider`
- `modelId`
- `supportedUrls`
- `doGenerate(options)`
- `doStream(options)`

## 4.2 Layer 2: AI SDK -> Mastra

Mastra already accepts raw AI SDK `LanguageModelV2` and `LanguageModelV3` objects in `MastraModelConfig`.

So the simplest Mastra integration is:
- build the AI SDK model via your adapter
- pass that model directly into Mastra agent config

This means a separate Mastra-specific provider is optional.

Only add a Mastra gateway if you want string-based model ids like:
- `pi/gpt-5.4`
- `pi/openai-codex/gpt-5.4`
- `pi/github-copilot/gpt-4.1`

## 5. Recommended architecture

## 5.1 Public modules

Recommended module split:

- `adapter/model.ts`
  - AI SDK `LanguageModelV2/V3` wrapper around `pi-ai`
- `adapter/provider.ts`
  - AI SDK `customProvider()` or provider registry integration
- `adapter/auth.ts`
  - credential lookup, refresh orchestration, profile selection
- `adapter/mapping/prompt.ts`
  - AI SDK prompt -> `pi-ai` `Context`
- `adapter/mapping/result.ts`
  - `pi-ai` assistant message -> AI SDK content result
- `adapter/mapping/stream.ts`
  - `pi-ai` event stream -> AI SDK stream parts
- `adapter/mastra.ts`
  - direct Mastra convenience helpers or custom gateway
- `adapter/models.ts`
  - logical model catalog and aliases

## 5.2 Internal model identity

Do not expose raw provider implementation details everywhere.

Use a registry like:

```ts
type LogicalModelId =
  | 'coding-default'
  | 'coding-fast'
  | 'coding-max'
  | 'subscription-codex'
  | 'copilot-coding';
```

Then map them internally to `pi-ai` model descriptors such as:
- provider: `openai-codex`
- model: `gpt-5.4`
- auth profile: `openai-codex:default`
- transport preference: `auto`

That gives you freedom to swap underlying providers without changing your agent code.

## 6. End-to-end request flow

## 6.1 Call path

End-to-end flow:

1. Mastra agent or AI SDK caller asks for a language model.
2. Your adapter resolves the logical model id to a `pi-ai` provider/model.
3. Your auth layer resolves credentials for that provider.
4. If OAuth-backed credentials are stale, refresh them.
5. Convert AI SDK prompt format into `pi-ai` `Context`.
6. Convert AI SDK tools into `pi-ai` tool definitions.
7. Call `pi-ai.complete()` for non-streaming or `pi-ai.stream()` for streaming.
8. Convert `pi-ai` output back into AI SDK content or stream parts.
9. Return the AI SDK model result to the caller.
10. If the caller is Mastra, Mastra consumes that model as if it were any other AI SDK model.

## 6.2 Key consequence

This means the outer system only needs to know:
- model id
- optional runtime options
- messages
- tools

It does not need to know:
- whether the provider uses API keys or OAuth
- whether the provider uses direct HTTP or WebSocket
- whether the provider is backed by a coding subscription
- how tokens are refreshed

## 7. Mapping AI SDK prompts into Pi-AI context

## 7.1 AI SDK prompt input

AI SDK `LanguageModelV2CallOptions` gives you:
- `prompt`
- generation params like `temperature` and `maxOutputTokens`
- optional `tools`
- `toolChoice`
- `headers`
- `providerOptions`
- `abortSignal`

## 7.2 Pi-AI context target

`pi-ai` expects a `Context`:
- `systemPrompt?: string`
- `messages: Message[]`
- `tools?: Tool[]`

Its message union is:
- user message
- assistant message
- tool result message

## 7.3 Prompt mapping rules

Recommended mapping:

### System messages

AI SDK:
- `{ role: 'system', content: string }`

Pi-AI:
- put the last or merged system content into `context.systemPrompt`

Do not preserve multiple independent system messages unless you have a reason. Merge them into one string.

### User messages

AI SDK user text/file parts:
- text -> `pi-ai` text content
- image/file -> `pi-ai` image content when supported

Pi-AI user message shape:

```ts
{
  role: 'user',
  content: string | [{ type: 'text', text }, { type: 'image', data, mimeType }],
  timestamp: Date.now(),
}
```

### Assistant messages

AI SDK assistant content can include:
- text
- reasoning
- tool calls
- tool results

Pi-AI assistant content can include:
- text blocks
- thinking blocks
- toolCall blocks

Recommended mapping:
- AI SDK `text` -> `pi-ai` text block
- AI SDK `reasoning` -> `pi-ai` thinking block
- AI SDK `tool-call` -> `pi-ai` toolCall block
- AI SDK `tool-result` embedded in assistant content should usually become a separate `toolResult` message in `pi-ai`

### Tool messages

AI SDK `tool` role messages map naturally to `pi-ai` `toolResult` messages.

### Tool result content

AI SDK tool outputs may be:
- text
- json
- error text
- error json
- mixed content with media

Pi-AI tool results support:
- text blocks
- image blocks

Recommended normalization:
- text/json/error text/error json -> text block
- mixed content -> text/image blocks where possible
- preserve `isError`

## 8. Mapping AI SDK tools into Pi-AI tools

This part is straightforward.

AI SDK tool definitions already carry:
- name
- description
- input schema

Pi-AI tools want:
- `name`
- `description`
- `parameters`

So the adapter can pass the schema through with minimal translation.

Recommended policy:
- support client-executed tools first
- do not try to model provider-executed tools unless you specifically need them
- normalize tool ids so the outer application sees stable ids

## 9. Mapping Pi-AI output back into AI SDK

## 9.1 Non-streaming `doGenerate`

For `doGenerate`, the adapter can simply call:

```ts
const assistant = await complete(model, context, options);
```

Then convert `assistant.content` into AI SDK `LanguageModelV2Content[]`.

Recommended mapping:
- `pi-ai` text -> AI SDK text content
- `pi-ai` thinking -> AI SDK reasoning content
- `pi-ai` toolCall -> AI SDK tool-call content with stringified JSON input

Map stop reasons:
- `stop` -> AI SDK `stop`
- `length` -> AI SDK `length`
- `toolUse` -> AI SDK `tool-calls`
- `error` -> AI SDK error path or `other`
- `aborted` -> abort error path

Map usage:
- `input`
- `output`
- `totalTokens`
- cache fields where available

## 9.2 Streaming `doStream`

For `doStream`, call:

```ts
const s = stream(model, context, options);
```

Then translate each `pi-ai` event into AI SDK `LanguageModelV2StreamPart` values.

Recommended event mapping:

- `start` -> `stream-start`
- `text_start` -> `text-start`
- `text_delta` -> `text-delta`
- `text_end` -> `text-end`
- `thinking_start` -> `reasoning-start`
- `thinking_delta` -> `reasoning-delta`
- `thinking_end` -> `reasoning-end`
- `toolcall_start` -> `tool-input-start`
- `toolcall_delta` -> `tool-input-delta`
- `toolcall_end` -> emit:
  - `tool-input-end`
  - `tool-call`
- `done` -> `finish`
- `error` -> `error`

Use deterministic block ids so related stream chunks share the same id.

For example:
- text block id: `text-<contentIndex>`
- reasoning block id: `reasoning-<contentIndex>`
- tool block id: `tool-<contentIndex>` or `toolCall.id`

## 10. Minimal AI SDK adapter shape

A minimal adapter can look like this:

```ts
import type { LanguageModelV2 } from '@ai-sdk/provider';

export function createPiAiLanguageModel(config: {
  provider: string;
  modelId: string;
  resolveAuth: () => Promise<{ apiKey?: string; headers?: Record<string, string> }>;
}): LanguageModelV2 {
  return {
    specificationVersion: 'v2',
    provider: 'pi-ai',
    modelId: config.modelId,
    supportedUrls: {},

    async doGenerate(options) {
      const auth = await config.resolveAuth();
      const { model, context, providerOptions } = await mapAiSdkToPiAi(options, config, auth);
      const result = await piComplete(model, context, providerOptions);
      return mapPiAiGenerateResultToAiSdk(result);
    },

    async doStream(options) {
      const auth = await config.resolveAuth();
      const { model, context, providerOptions } = await mapAiSdkToPiAi(options, config, auth);
      const piStream = piStreamCall(model, context, providerOptions);
      return {
        stream: mapPiAiStreamToAiSdk(piStream),
      };
    },
  };
}
```

This is the key reusable seam.

## 11. AI SDK provider wrapper

Once you have `createPiAiLanguageModel()`, expose an AI SDK provider surface.

Two good options:

### Option A: simple factory

```ts
const model = createPiAiLanguageModel({ logicalModel: 'coding-default' });
```

### Option B: AI SDK custom provider

Use AI SDK `customProvider()` so callers can request named models:

```ts
const piProvider = customProvider({
  languageModels: {
    'coding-default': createPiAiLanguageModel(...),
    'coding-fast': createPiAiLanguageModel(...),
    'subscription-codex': createPiAiLanguageModel(...),
  },
});
```

That makes it easy to use with provider registries and middleware.

## 12. Mastra integration options

## 12.1 Easiest path: pass the AI SDK model directly

Mastra accepts AI SDK `LanguageModelV2/V3` in `MastraModelConfig`.

So you can do:

```ts
const agent = new Agent({
  name: 'coder',
  model: createPiAiLanguageModel({ logicalModel: 'coding-default' }),
});
```

This is the simplest and best initial approach.

## 12.2 Optional path: create a Mastra gateway

Only do this if you want string-based lookup and central registry behavior inside Mastra.

Example shape:

```ts
class PiAiGateway extends MastraModelGateway {
  async resolveLanguageModel({ modelId, apiKey, headers }) {
    return createPiAiLanguageModel({
      logicalModel: modelId,
      injectedApiKey: apiKey,
      injectedHeaders: headers,
    });
  }
}
```

That gives you nice model strings while still routing execution through the same adapter.

## 13. Auth strategy through Pi-AI

## 13.1 Principle

Keep auth inside the adapter boundary.

The rest of the application should not know whether a model is backed by:
- API key
- OAuth token
- refreshable subscription token
- local CLI credentials
- custom header injection

## 13.2 Auth resolver responsibilities

Your `resolveAuth()` function should:
- identify the logical provider for the requested model
- load the right credential profile
- refresh tokens when stale
- return the auth material needed by `pi-ai`

Example return shape:

```ts
{
  apiKey: '...',
  headers: {
    Authorization: 'Bearer ...',
    'chatgpt-account-id': '...'
  }
}
```

For some `pi-ai` providers, `apiKey` alone is enough. For subscription-backed and compatibility-backed providers, you may also need fixed header behavior or custom provider options.

## 13.3 Suggested profile model

Use logical auth profiles such as:
- `codex-subscription-default`
- `copilot-default`
- `anthropic-subscription-default`

Map those internally to `pi-ai` provider-specific credential storage.

## 13.4 Why this matters

This lets you support models like:
- Codex subscription-backed coding models
- Copilot-backed coding models
- any future OAuth-backed coding model

without rewriting the AI SDK or Mastra layer every time.

## 14. Why routing through Pi-AI helps

Routing through `pi-ai` removes a lot of headaches because it centralizes:
- provider request formatting
- provider-specific streaming quirks
- auth refresh behavior
- tool-call normalization
- usage normalization
- model catalog and capability metadata

That means your app-facing contract becomes smaller and more stable.

Instead of every framework learning every provider, only the adapter has to understand `pi-ai`.

## 15. What it does not remove

Routing through `pi-ai` does not magically remove:
- provider policy risk
- undocumented auth flows
- subscription entitlement drift
- backend changes in non-public APIs
- supportability problems for reverse-engineered paths

It reduces the blast radius. It does not remove the underlying risk.

## 16. Specific caveats for Codex-style subscription paths

If you use subscription-backed coding models through `pi-ai`, especially the ChatGPT-backed Codex compatibility path, keep these caveats explicit in your design.

## 16.1 Support caveat

Some of these flows are compatibility paths, not clearly documented public third-party integration surfaces.

Do not treat them as equivalent to a normal public API-key product.

## 16.2 Stability caveat

Any of the following may drift:
- headers
- originator values
- OAuth parameters
- allowed client identities
- response event shapes
- token-refresh behavior

## 16.3 Storage caveat

If your auth layer persists refreshable subscription credentials, those tokens are effectively long-lived secrets. Protect them like passwords.

## 16.4 Contract caveat

Your application contract should be stable even if the provider contract is not.

That means:
- never leak raw provider assumptions up into agent code
- keep provider-specific options inside adapter mapping code
- support feature degradation when a provider loses a capability

## 17. Recommended feature flags and fallback behavior

Add a per-model capability descriptor:

```ts
{
  supportsReasoning: true,
  supportsImages: false,
  supportsTools: true,
  supportsStreaming: true,
  supportsJsonMode: partial,
  authMode: 'oauth-refresh',
  stability: 'reverse-engineered',
}
```

Use that to:
- disable unsupported AI SDK options early
- emit warnings for partially supported features
- route risky models behind an explicit feature flag
- provide fallback models when a subscription path fails

## 18. Error-handling policy

Recommended categories:

### Adapter errors

Examples:
- bad prompt mapping
- unsupported content type
- unsupported tool mode

These should fail fast with explicit messages.

### Auth errors

Examples:
- missing credentials
- refresh failure
- expired token with no fallback

These should surface as retryable or non-retryable errors based on context.

### Provider runtime errors

Examples:
- rate limits
- backend stream failures
- entitlement errors

These should be normalized so callers do not need provider-specific parsing.

## 19. Recommended implementation order

Build this in phases.

### Phase 1

- wrap one `pi-ai` text model as AI SDK `LanguageModelV2`
- support text-only user messages
- support non-streaming `doGenerate`
- support simple streaming text

### Phase 2

- add reasoning mapping
- add tool-call mapping
- add tool-result message mapping
- add usage and finish-reason normalization

### Phase 3

- add auth profile resolution
- add OAuth refresh support
- add logical model registry
- add AI SDK `customProvider()` surface

### Phase 4

- plug the wrapped model directly into Mastra
- add optional Mastra gateway only if string model ids are worth it

### Phase 5

- add fallback model routing
- add observability and structured logging
- add feature flags for unstable providers

## 20. Suggested test matrix

You want tests at three levels.

### Adapter mapping tests

- AI SDK prompt -> `pi-ai` context
- `pi-ai` message -> AI SDK content
- `pi-ai` stream events -> AI SDK stream parts
- finish-reason and usage mapping

### Auth tests

- token refresh path
- expired token path
- missing credential path
- profile selection path

### Integration tests

- AI SDK `generateText` through adapter
- AI SDK `streamText` through adapter
- Mastra agent using wrapped model
- tool-calling round trip through adapter

## 21. Recommended observability

Log at the adapter layer, not in every consumer.

Suggested fields:
- logicalModelId
- piProvider
- piModelId
- authProfileId
- transport
- requestId
- finishReason
- usage.input
- usage.output
- retryCount
- fallbackUsed

Never log raw tokens or authorization headers.

## 22. Practical conclusion

Yes, this is a good architecture.

The right way to do it is not to make Mastra or AI SDK understand subscription-model auth directly. The right way is to put `pi-ai` in the middle and build a thin but strict adapter around it.

That gives you:
- one auth and provider runtime layer
- one AI SDK-compatible interface
- direct Mastra compatibility
- a reusable substrate for coding-focused and subscription-backed models

It does not eliminate the risk of undocumented provider flows, but it contains that risk in one place, which is exactly what you want.

## 23. Short recommendation

If you proceed, build:
- one `pi-ai` -> AI SDK `LanguageModelV2` adapter first
- pass it directly into Mastra
- keep auth resolution inside the adapter
- keep model ids logical and provider-agnostic
- treat reverse-engineered subscription paths as unstable provider backends behind a stable internal contract
