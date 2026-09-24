# n8n-nodes-custom-ia

This is an n8n community node package with **two nodes** that work with **any OpenAI-compatible AI provider**:

- **Custom AI Chat Model** — a Chat Model sub-node for the **AI Agent**, **Basic LLM Chain** and any other AI node that accepts a Chat Model.
- **Custom AI Media** — an action node that **transcribes audio** (`/audio/transcriptions`, `/audio/translate`) and **analyzes images** (vision via `/chat/completions`).

Configure a custom **Base URL**, API key and optional custom headers once in the credentials, and use them from both nodes.

Supported providers include (but are not limited to):

- OpenAI (`https://api.openai.com/v1`)
- DeepSeek (`https://api.deepseek.com`)
- OpenRouter (`https://openrouter.ai/api/v1`)
- Groq (`https://api.groq.com/openai/v1`)
- Mistral (`https://api.mistral.ai/v1`)
- xAI / Grok (`https://api.x.ai/v1`)
- Ollama (`http://localhost:11434/v1`)
- LM Studio (`http://localhost:1234/v1`)
- Any other service exposing an OpenAI-compatible `/chat/completions` API

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Credentials](#credentials)
[Custom AI Chat Model](#custom-ai-chat-model)
[Custom AI Media](#custom-ai-media)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

In short, on a self-hosted instance:

1. Go to **Settings > Community Nodes**.
2. Select **Install**.
3. Enter `n8n-nodes-custom-ia` and confirm.

## Credentials

The **Custom AI API** credential has the following fields:

| Field | Description |
| --- | --- |
| **API Key** | Sent as `Authorization: Bearer <key>`. Leave empty for providers that don't require authentication (e.g. local servers). |
| **Base URL** | Base URL of the OpenAI-compatible API, including the version path when the provider uses one (e.g. `https://api.openai.com/v1`). The nodes call `<Base URL>/chat/completions`, `<Base URL>/audio/transcriptions` and `<Base URL>/models`. |
| **Add Custom Header** | Optional. Adds one extra header to every request (for example `HTTP-Referer` or `X-Title` required by some gateways). |
| **Header Name** / **Header Value** | Name and value of the custom header. |

When you save the credential, n8n tests it by calling `<Base URL>/models` with the configured authentication.

> **Note:** If your provider doesn't expose `/models` (for example a transcription-only server), n8n reports the credential test as failed when saving. The credential still works for transcription: you can ignore that message.

### Provider examples

| Provider | Base URL | API key required |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | Yes |
| DeepSeek | `https://api.deepseek.com` | Yes |
| OpenRouter | `https://openrouter.ai/api/v1` | Yes |
| Groq | `https://api.groq.com/openai/v1` | Yes |
| Mistral | `https://api.mistral.ai/v1` | Yes |
| xAI (Grok) | `https://api.x.ai/v1` | Yes |
| Ollama | `http://localhost:11434/v1` | No |
| LM Studio | `http://localhost:1234/v1` | No |

## Custom AI Chat Model

This node is a **Chat Model sub-node**. It does not execute on its own: connect it to the model input of a root AI node, such as:

- **AI Agent**
- **Basic LLM Chain**
- Other chains that accept a Chat Model

Node parameters:

- **Model**: choose a model from the provider's `/models` endpoint or set the model ID manually.
- **Options**: temperature, maximum number of tokens, top P, frequency/presence penalty, response format (text or JSON), timeout, max retries, "Use Responses API" (OpenAI only), **Thinking Mode**, **Reasoning Effort** and **Extra Body** for provider-specific request parameters as JSON.

**Extra Body** is merged into the request body last, so it can intentionally override any of the options above or the effective model/stream parameters. Do not put credentials in the Base URL: use the API Key and custom header fields, which are stored encrypted.

### Thinking and reasoning

Models that support thinking/reasoning can be controlled with two options:

- **Thinking Mode**: `Default`, `Enabled` or `Disabled`. Sent as `{"thinking":{"type":"enabled"|"disabled"}}` (DeepSeek).
- **Reasoning Effort**: `Default`, `None`, `Minimal`, `Low`, `Medium`, `High` or `Max`. Sent as `reasoning_effort` on Chat Completions, or as `reasoning.effort` when using the Responses API. When Thinking Mode is `Disabled`, no effort value is sent.

DeepSeek notes:

- Current models are `deepseek-v4-flash` and `deepseek-v4-pro` (thinking enabled by default; `deepseek-chat` and `deepseek-reasoner` are deprecated aliases).
- DeepSeek accepts `low`, `high` and `max` (`medium` maps to `high`).
- In thinking mode, `temperature`, `top P` and penalties have no effect.

## Custom AI Media

Action node that sends media from the input item to any OpenAI-compatible provider.

| Resource | Operation | Endpoint |
| --- | --- | --- |
| Audio | **Transcribe** | `POST <Base URL>/audio/transcriptions` |
| Audio | **Translate** (to English) | `POST <Base URL>/audio/translate` |
| Image | **Analyze** | `POST <Base URL>/chat/completions` with `image_url` content |

### Audio

- **Binary Property**: name of the input binary property containing the audio file (flac, mp3, mp4, m4a, ogg, wav or webm). Watch provider file-size limits (25 MB on OpenAI).
- **Model**: a transcription model, e.g. `whisper-1` (OpenAI), `groq/whisper-large-v3` (Groq) or your local whisper model.
- **Options** (only sent when you add them): **Language** (ISO 639-1 code such as `en` or `es`), **Prompt** (hint for proper nouns), **Response Format** (`json`, `text`, `verbose_json` with timestamped segments, `srt`, `vtt`), **Sampling Temperature**, **Timeout** and **Extra Body**.
- **Simplify** returns `text` (plus `language`, `duration` and `segments` when the provider returns them). With it disabled you get the raw provider response. The input binary is passed through to the output.

### Image

- **Input Type**: `Binary` (default: a base64 data URL is built from the input item) or `URL` (one or more comma-separated URLs).
- **Model**: a vision model, e.g. `gpt-4o` (OpenAI), a `*-vision-preview` model (Groq) or a multimodal model served by Ollama/LM Studio.
- **Prompt**: the question or instruction about the image (default `What's in this image?`).
- **Options**: **Detail** (`auto`/`low`/`high`, OpenAI only — `auto` is not sent so other providers are unaffected), **Maximum Number of Tokens**, **Timeout** and **Extra Body** (e.g. `temperature`, `response_format`).
- **Simplify** returns `text` with the model's answer. With it disabled you get the raw chat completion.

### Notes

- Audio transcription needs a provider with an `/audio/transcriptions`-compatible endpoint (OpenAI, Groq, local whisper servers...). Image analysis only needs `/chat/completions` with vision support.
- **Extra Body** accepts a JSON object and is merged last (it can override any option above). Unknown keys such as `__proto__`, `constructor` and `prototype` are ignored.
- The node can also be used as an AI tool; in that case prefer the `URL` input type for images.

## Compatibility

- Requires a recent self-hosted n8n version that includes the AI node SDK (peer dependency `@n8n/ai-node-sdk`).
- Unverified community nodes are not available on n8n Cloud.
- Tested against current n8n 2.x releases.

## Usage

### Chat model

1. Add an **AI Agent** (or **Basic LLM Chain**) node to your workflow.
2. Open the **Chat Model** connector and select **Custom AI Chat Model**.
3. Create a **Custom AI API** credential with your provider's Base URL and API key.
4. Select a model from the list or type the model ID.
5. Run the workflow.

### Media (audio / image)

1. Get a file into the workflow as binary (e.g. Read Binary Files, HTTP Request, Email Trigger...).
2. Add a **Custom AI Media** node and keep the same **Custom AI API** credential.
3. Choose `Audio` → `Transcribe` (or `Image` → `Analyze`), set the model and run the workflow.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [OpenAI API reference](https://platform.openai.com/docs/api-reference/chat)
- [OpenAI audio transcription reference](https://platform.openai.com/docs/api-reference/audio/createTranscription)

## Version history

### 0.2.0

- New **Custom AI Media** node: transcribe and translate audio (`/audio/transcriptions`, `/audio/translate`) and analyze images (vision via `/chat/completions`) with any OpenAI-compatible provider, reusing the same **Custom AI API** credential.
- The media node can also be used as an AI tool.

### 0.1.2

- Security hardening: sanitized **Extra Body** keys, redacted URLs in errors, normalized Base URL trailing slash, and a leaner published package.

### 0.1.1

- Added **Thinking Mode** and **Reasoning Effort** options for reasoning models.
- Simplified node icons to a solid purple chat bubble.
- Updated DeepSeek model references to `deepseek-v4-flash` / `deepseek-v4-pro`.

### 0.1.0

- Initial release: OpenAI-compatible Chat Model node with custom Base URL, API key and custom header support.
