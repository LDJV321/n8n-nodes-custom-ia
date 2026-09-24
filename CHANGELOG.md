# Changelog

## 0.2.0

- New **Custom AI Chat Media (Via Completions)** node: audio (`input_audio` content part) and images (`image_url`) sent **exclusively through `/chat/completions`**, for providers without dedicated media endpoints (e.g. OpenCode Zen). Audio format inferred from the MIME type, opt-in options collection, `Extra Body` merging and binary pass-through.
- New **Custom AI Media** node (programmatic style) with two resources:
  - **Audio**: `Transcribe` (`POST /audio/transcriptions`) and `Translate` to English (`POST /audio/translate`), multipart upload from the input item's binary property, optional `language`, `prompt`, `response format` (`json`, `text`, `verbose_json`, `srt`, `vtt`), `temperature`, `timeout` and `Extra Body`.
  - **Image**: `Analyze` via `POST /chat/completions` with `image_url` content, from a binary property (base64 data URL) or one or more public URLs, with `prompt`, `detail`, `maxTokens`, `timeout` and `Extra Body`.
  - Shared `Simplify` toggle, binary pass-through on the output item, `continueOnFail` support and redacted URLs in error messages.
- The media node is registered as `usableAsTool`, so it can also be used from AI agents.
- The package description and README now document both nodes and the `/models` credential-test limitation for transcription-only providers.

## 0.1.2

- Hardening: ignore `__proto__`, `constructor` and `prototype` keys from **Extra Body** to avoid prototype pollution.
- Credential checks and model loading now strip a trailing slash from the Base URL.
- URLs in error messages are redacted (`//***@`) so credentials embedded in a Base URL never leak into logs.
- Removed unneeded credential expression-resolution flags.
- Excluded source maps and build metadata from the published package.

## 0.1.1

- Added **Thinking Mode** option (Default/Enabled/Disabled) for providers with thinking support (e.g. DeepSeek `thinking.type`).
- Added **Reasoning Effort** option (Default/None/Minimal/Low/Medium/High/Max), sent as `reasoning_effort` on Chat Completions and as `reasoning.effort` when using the Responses API. It is skipped when thinking is disabled.
- Simplified node icons to a solid purple chat bubble.
- Updated DeepSeek model references to `deepseek-v4-flash` / `deepseek-v4-pro`.

## 0.1.0

- Initial release: OpenAI-compatible Chat Model node with custom Base URL, API key and custom header support.
