# Changelog

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
