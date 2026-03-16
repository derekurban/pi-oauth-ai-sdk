# Changelog

All notable changes to `ai-sdk-oauth-providers` will be documented in this
file.

## 0.2.1 - 2026-03-16

### Added

- Added `languageModelV2(modelId)` as a thin compatibility export on each
  OAuth-backed provider instance.

## 0.2.0 - 2026-03-16

### Added

- New `ProviderV3` factories for:
  - OpenAI Codex OAuth
  - Anthropic OAuth
  - Gemini CLI / Google Cloud Code Assist OAuth
- Package-owned OAuth auth store with JSON file persistence and file-locked
  refresh.
- Package-owned language model transports instead of reusing `pi-ai`
  inference/runtime.
- CLI commands for `providers`, `login`, `logout`, `status`, and
  `import-codex-auth`.
- `ai-sdk-oauth-providers/mastra` export with `withMastraCompat(...)`.

### Documentation

- Added contract reference docs for AI SDK V3, Codex OAuth, Anthropic OAuth,
  and Gemini CLI OAuth.
- Added a compatibility matrix and maintenance/update-cycle guide.
- Expanded README with AI SDK, provider registry, Codex auth, and Mastra usage
  examples.

### Release Automation

- Added root CI workflow for the replacement package line.
- Added root publish workflow for tags matching `v*`.
- Added a manual workflow to deprecate `pi-oauth-ai-sdk` on npm.
