# n8n-nodes-custom-ia

This is an n8n community node. It provides a **Chat Model** that works with **any OpenAI-compatible AI provider**.

Configure a custom **Base URL**, API key and optional custom headers once in the credentials, and then use it as the model of the **AI Agent**, **Basic LLM Chain** and any other AI node that accepts a Chat Model sub-node.

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
[Operations](#operations)
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
| **Base URL** | Base URL of the OpenAI-compatible API, including the version path when the provider uses one (e.g. `https://api.openai.com/v1`). The node calls `<Base URL>/chat/completions` and `<Base URL>/models`. |
| **Add Custom Header** | Optional. Adds one extra header to every request (for example `HTTP-Referer` or `X-Title` required by some gateways). |
| **Header Name** / **Header Value** | Name and value of the custom header. |

When you save the credential, n8n tests it by calling `<Base URL>/models` with the configured authentication.

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

## Operations

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

## Compatibility

- Requires a recent self-hosted n8n version that includes the AI node SDK (peer dependency `@n8n/ai-node-sdk`).
- Unverified community nodes are not available on n8n Cloud.
- Tested against current n8n 2.x releases.

## Usage

1. Add an **AI Agent** (or **Basic LLM Chain**) node to your workflow.
2. Open the **Chat Model** connector and select **Custom AI Chat Model**.
3. Create a **Custom AI API** credential with your provider's Base URL and API key.
4. Select a model from the list or type the model ID.
5. Run the workflow.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [OpenAI API reference](https://platform.openai.com/docs/api-reference/chat)

## Version history

### 0.1.2

- Security hardening: sanitized **Extra Body** keys, redacted URLs in errors, normalized Base URL trailing slash, and a leaner published package.

### 0.1.1

- Added **Thinking Mode** and **Reasoning Effort** options for reasoning models.
- Simplified node icons to a solid purple chat bubble.
- Updated DeepSeek model references to `deepseek-v4-flash` / `deepseek-v4-pro`.

### 0.1.0

- Initial release: OpenAI-compatible Chat Model node with custom Base URL, API key and custom header support.
