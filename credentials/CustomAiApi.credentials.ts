import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class CustomAiApi implements ICredentialType {
	name = 'customAiApi';

	displayName = 'Custom AI API';

	documentationUrl = 'https://www.npmjs.com/package/n8n-nodes-custom-ia#credentials';

	icon: Icon = { light: 'file:../icons/customAi.svg', dark: 'file:../icons/customAi.dark.svg' };

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				"API key sent as 'Authorization: Bearer <key>'. Leave empty if the provider doesn't require authentication (e.g. local servers)",
		},
		{
			displayName: 'Base URL',
			name: 'url',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'e.g. https://api.openai.com/v1',
			description:
				'Base URL of any OpenAI-compatible API. Examples: https://api.openai.com/v1 (OpenAI), https://api.deepseek.com (DeepSeek), https://openrouter.ai/api/v1 (OpenRouter), http://localhost:11434/v1 (Ollama)',
		},
		{
			displayName: 'Add Custom Header',
			name: 'header',
			type: 'boolean',
			default: false,
			description: 'Whether to add an extra header to every request',
		},
		{
			displayName: 'Header Name',
			name: 'headerName',
			type: 'string',
			displayOptions: {
				show: {
					header: [true],
				},
			},
			default: '',
			placeholder: 'e.g. HTTP-Referer',
		},
		{
			displayName: 'Header Value',
			name: 'headerValue',
			type: 'string',
			typeOptions: { password: true },
			displayOptions: {
				show: {
					header: [true],
				},
			},
			default: '',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{ $credentials?.url }}',
			url: '/models',
		},
	};

	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		requestOptions.headers ??= {};

		if (typeof credentials.url === 'string' && credentials.url) {
			requestOptions.baseURL = credentials.url.replace(/\/+$/, '');
		}

		if (credentials.apiKey) {
			requestOptions.headers['Authorization'] = `Bearer ${credentials.apiKey}`;
		}

		if (
			credentials.header &&
			typeof credentials.headerName === 'string' &&
			credentials.headerName &&
			typeof credentials.headerValue === 'string'
		) {
			requestOptions.headers[credentials.headerName] = credentials.headerValue;
		}

		return requestOptions;
	}
}
