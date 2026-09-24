import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
	GenericValue,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

function redactUrl(url: string): string {
	return url.replace(/\/\/[^@/]+@/, '//***@');
}

type AudioOptions = {
	extraBody?: string;
	language?: string;
	prompt?: string;
	responseFormat?: string;
	temperature?: number;
	timeout?: number;
};

type ImageOptions = {
	detail?: string;
	extraBody?: string;
	maxTokens?: number;
	timeout?: number;
};

function getRequiredModel(ctx: IExecuteFunctions, itemIndex: number): string {
	const raw = ctx.getNodeParameter('model', itemIndex) as { value?: string } | string;
	const model = typeof raw === 'string' ? raw : (raw.value ?? '');
	if (!model) {
		throw new NodeOperationError(ctx.getNode(), 'Model is not set', {
			itemIndex,
			description: "Select a model from the list or set the model ID in the 'Model' parameter",
		});
	}
	return model;
}

function parseExtraBody(
	ctx: IExecuteFunctions,
	itemIndex: number,
	extraBody: string | undefined,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	if (typeof extraBody !== 'string') return result;

	const trimmed = extraBody.trim();
	if (trimmed === '' || trimmed === '{}') return result;

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (error) {
		throw new NodeOperationError(ctx.getNode(), 'The value in the "Extra Body" field is not valid JSON', {
			itemIndex,
			description: error instanceof Error ? error.message : String(error),
		});
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new NodeOperationError(
			ctx.getNode(),
			'The value in the "Extra Body" field must be a JSON object',
			{ itemIndex },
		);
	}

	const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (!dangerousKeys.includes(key)) {
			result[key] = value;
		}
	}
	return result;
}

async function readBinary(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
	const binaryPropertyName = ctx.getNodeParameter('binaryPropertyName', itemIndex) as string;
	const binary = (ctx.getInputData()[itemIndex].binary ?? {})[binaryPropertyName];

	if (binary === undefined) {
		throw new NodeOperationError(
			ctx.getNode(),
			`The item has no binary property "${binaryPropertyName}"`,
			{
				itemIndex,
				description:
					"Check that the 'Binary Property' parameter matches a binary field on the input item",
			},
		);
	}

	const buffer = await ctx.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
	return {
		buffer,
		fileName: binary.fileName ?? 'file',
		mimeType: binary.mimeType ?? 'application/octet-stream',
	};
}

function coerceAudioResponse(raw: unknown): IDataObject {
	if (typeof raw === 'object' && raw !== null) {
		return raw as IDataObject;
	}
	if (Buffer.isBuffer(raw)) {
		return { text: raw.toString('utf8') };
	}
	const text = String(raw ?? '');
	try {
		const parsed = JSON.parse(text);
		if (parsed !== null && typeof parsed === 'object') {
			return parsed as IDataObject;
		}
	} catch {
		// Not JSON: plain text, SRT or VTT content
	}
	return { text };
}

function extractChoiceText(choice: IDataObject | undefined): string {
	if (!choice) return '';
	const message = choice.message as IDataObject | undefined;
	// Reasoning models may leave content null and put the answer in
	// reasoning_content, so fall back to it when content is empty.
	const content = message?.content || message?.reasoning_content || choice.text;

	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (part !== null && typeof part === 'object') {
					const text = (part as IDataObject).text;
					return typeof text === 'string' ? text : '';
				}
				return '';
			})
			.join('');
	}
	return '';
}

async function executeAudioOperation(
	ctx: IExecuteFunctions,
	item: INodeExecutionData,
	itemIndex: number,
): Promise<IDataObject> {
	const operation = ctx.getNodeParameter('operation', itemIndex) as string;
	const model = getRequiredModel(ctx, itemIndex);
	const options = ctx.getNodeParameter('options', itemIndex, {}) as AudioOptions;

	const binaryPropertyName = ctx.getNodeParameter('binaryPropertyName', itemIndex) as string;
	const binary = item.binary?.[binaryPropertyName];
	if (binary === undefined) {
		throw new NodeOperationError(
			ctx.getNode(),
			`The item has no binary property "${binaryPropertyName}"`,
			{
				itemIndex,
				description:
					"Check that the 'Binary Property' parameter matches a binary field on the input item",
			},
		);
	}
	const buffer = await ctx.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);

	const formData = new FormData();
	formData.append(
		'file',
		new Blob([buffer], { type: binary.mimeType ?? 'application/octet-stream' }),
		binary.fileName ?? 'audio',
	);
	formData.append('model', model);

	if (options.language) formData.append('language', options.language);
	if (options.prompt) formData.append('prompt', options.prompt);
	if (options.responseFormat) formData.append('response_format', options.responseFormat);
	if (options.temperature !== undefined) formData.append('temperature', String(options.temperature));

	for (const [key, value] of Object.entries(
		parseExtraBody(ctx, itemIndex, options.extraBody),
	)) {
		formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
	}

	const url = operation === 'translate' ? '/audio/translate' : '/audio/transcriptions';
	const response = await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		'customAiApi',
		{
			method: 'POST',
			url,
			body: formData,
			json: false,
			timeout: options.timeout ?? 300000,
		},
	);

	const parsed = coerceAudioResponse(response);

	const simplify = ctx.getNodeParameter('simplify', itemIndex, false) as boolean;
	if (!simplify) return parsed;

	const simplified: IDataObject = { text: parsed.text ?? '' };
	for (const key of ['language', 'duration', 'segments'] as const) {
		if (parsed[key] !== undefined) simplified[key] = parsed[key];
	}
	return simplified;
}

async function executeImageOperation(
	ctx: IExecuteFunctions,
	item: INodeExecutionData,
	itemIndex: number,
): Promise<IDataObject> {
	const model = getRequiredModel(ctx, itemIndex);
	const inputType = ctx.getNodeParameter('inputType', itemIndex) as string;
	const prompt = ctx.getNodeParameter('prompt', itemIndex) as string;
	const options = ctx.getNodeParameter('options', itemIndex, {}) as ImageOptions;

	const imageUrls: string[] = [];
	if (inputType === 'url') {
		const raw = ctx.getNodeParameter('imageUrls', itemIndex) as string;
		const urls = raw
			.split(',')
			.map((entry) => entry.trim())
			.filter(Boolean);
		const invalid = urls.filter((url) => !/^(https?:|data:image\/)/i.test(url));
		if (invalid.length > 0) {
			throw new NodeOperationError(
				ctx.getNode(),
				`Invalid image URL scheme: ${invalid[0]}`,
				{
					itemIndex,
					description:
						'Only http://, https:// and data:image URLs are supported (file:// and other schemes are blocked)',
				},
			);
		}
		imageUrls.push(...urls);
		if (imageUrls.length === 0) {
			throw new NodeOperationError(ctx.getNode(), 'No image URL provided', {
				itemIndex,
				description: "Enter at least one URL in the 'Image URL' parameter",
			});
		}
	} else {
		const { buffer, mimeType } = await readBinary(ctx, itemIndex);
		imageUrls.push(`data:${mimeType};base64,${buffer.toString('base64')}`);
	}

	const content: IDataObject[] = [{ type: 'text', text: prompt }];
	for (const url of imageUrls) {
		const imagePart: IDataObject = { type: 'image_url', image_url: { url } };
		if (options.detail && options.detail !== 'auto') {
			(imagePart.image_url as IDataObject).detail = options.detail;
		}
		content.push(imagePart);
	}

	const body: IDataObject = {
		model,
		messages: [{ role: 'user', content }],
	};
	if (typeof options.maxTokens === 'number' && options.maxTokens > 0) {
		body.max_tokens = options.maxTokens;
	}
	for (const [key, value] of Object.entries(
		parseExtraBody(ctx, itemIndex, options.extraBody),
	)) {
		body[key] = value as GenericValue;
	}

	const response = await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		'customAiApi',
		{
			method: 'POST',
			url: '/chat/completions',
			body,
			json: true,
			timeout: options.timeout ?? 120000,
		},
	);

	const responseObj = response as IDataObject;
	const choices = responseObj.choices as IDataObject[] | undefined;
	const text = extractChoiceText(choices?.[0]);

	const simplify = ctx.getNodeParameter('simplify', itemIndex, false) as boolean;
	if (simplify) return { text };

	return responseObj;
}

export class CustomAiMedia implements INodeType {
	methods = {
		listSearch: {
			async listModels(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const credentials = await this.getCredentials('customAiApi');
				const baseUrl = String(credentials.url ?? '').replace(/\/+$/, '');

				if (!baseUrl) {
					throw new NodeOperationError(
						this.getNode(),
						'Base URL is not set in the Custom AI API credentials',
					);
				}

				let response: IDataObject;
				try {
					response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'customAiApi',
						{
							method: 'GET',
							url: `${baseUrl}/models`,
							json: true,
						},
					)) as IDataObject;
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Could not load models from ${redactUrl(baseUrl)}/models`,
						{
							description: redactUrl(
								error instanceof Error ? error.message : String(error),
							),
						},
					);
				}

				const rawList = (response.data ?? response.models ?? []) as Array<Record<string, unknown>>;
				const results = rawList
					.map((entry) => {
						const id = (entry.id ?? entry.name ?? entry.model) as string | undefined;
						return id ? { name: id, value: id } : undefined;
					})
					.filter((item): item is { name: string; value: string } => item !== undefined)
					.filter((item) => !filter || item.name.toLowerCase().includes(filter.toLowerCase()))
					.sort((a, b) => a.name.localeCompare(b.name));

				return { results };
			},
		},
	};

	description: INodeTypeDescription = {
		displayName: 'Custom AI Media',
		name: 'customAiMedia',
		icon: { light: 'file:../../icons/customAi.svg', dark: 'file:../../icons/customAi.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{ $parameter["operation"] }}',
		description:
			'Transcribe audio and analyze images with any OpenAI-compatible AI provider (OpenAI, Groq, DeepSeek, Ollama, LM Studio and more)',
		defaults: {
			name: 'Custom AI Media',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'customAiApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Audio',
						value: 'audio',
						description: 'Transcribe or translate speech into text',
					},
					{
						name: 'Image',
						value: 'image',
						description: 'Describe an image or answer questions about it',
					},
				],
				default: 'audio',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['audio'],
					},
				},
				options: [
					{
						name: 'Transcribe',
						value: 'transcribe',
						description: 'Convert speech into text in the original language',
						action: 'Transcribe audio',
					},
					{
						name: 'Translate',
						value: 'translate',
						description: 'Convert speech into English text',
						action: 'Translate audio',
					},
				],
				default: 'transcribe',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['image'],
					},
				},
				options: [
					{
						name: 'Analyze',
						value: 'analyze',
						description: 'Describe the image or answer a question about it',
						action: 'Analyze image',
					},
				],
				default: 'analyze',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						placeholder: 'Select a model...',
						typeOptions: {
							searchListMethod: 'listModels',
							searchable: true,
						},
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						placeholder: 'e.g. whisper-1',
					},
				],
				description:
					"The model to use. Choose from the provider's /models endpoint or set the model ID manually. For audio use a transcription model (e.g. whisper-1, groq/whisper-large-v3), for images a vision model (e.g. gpt-4o, gemini-2.0-flash).",
			},
			{
				displayName: 'Input Type',
				name: 'inputType',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['image'],
					},
				},
				options: [
					{
						name: 'Binary',
						value: 'binary',
						description: 'Use an image attached to the input item',
					},
					{
						name: 'URL',
						value: 'url',
						description: 'Use a public image URL',
					},
				],
				default: 'binary',
				description: 'Where the image to analyze comes from',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: {
					show: {
						resource: ['audio'],
					},
				},
				description:
					'Name of the input binary property containing the audio file to transcribe (flac, mp3, mp4, m4a, ogg, wav or webm)',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: {
					show: {
						resource: ['image'],
						inputType: ['binary'],
					},
				},
				description: 'Name of the input binary property containing the image to analyze',
			},
			{
				displayName: 'Image URL',
				name: 'imageUrls',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. https://example.com/image.png',
				displayOptions: {
					show: {
						resource: ['image'],
						inputType: ['url'],
					},
				},
				description: 'URL of the image to analyze. To use several images, separate the URLs with commas.',
			},
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				default: "What's in this image?",
				required: true,
				typeOptions: {
					rows: 3,
				},
				displayOptions: {
					show: {
						resource: ['image'],
					},
				},
				description: 'Question or instruction about the image that the model should answer',
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: false,
				description: 'Whether to return a simplified version of the response instead of the raw data. Off by default: providers differ in where they place the answer (e.g. content vs reasoning_content), so the raw response is the safest starting point.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['audio'],
					},
				},
				options: [
					{
						displayName: 'Extra Body',
						name: 'extraBody',
						type: 'json',
						default: '{}',
						description:
							'Additional JSON properties to include in the request body, for provider-specific parameters',
					},
					{
						displayName: 'Language',
						name: 'language',
						type: 'string',
						default: '',
						placeholder: 'e.g. es',
						description: 'Language of the input audio as an ISO 639-1 code (e.g. en, es). Improves accuracy and latency when set.',
					},
					{
						displayName: 'Prompt',
						name: 'prompt',
						type: 'string',
						default: '',
						typeOptions: {
							rows: 2,
						},
						description:
							'Optional hint to guide the transcription, such as proper nouns or product names',
					},
					{
						displayName: 'Response Format',
						name: 'responseFormat',
						type: 'options',
						default: 'json',
						description: 'Format of the transcription. Support depends on the model and provider.',
						options: [
							{
								name: 'JSON',
								value: 'json',
								description: 'JSON object with a text field (provider default)',
							},
							{
								name: 'SRT',
								value: 'srt',
								description: 'SubRip subtitle file with timestamps',
							},
							{
								name: 'Text',
								value: 'text',
								description: 'Plain text response',
							},
							{
								name: 'Verbose JSON',
								value: 'verbose_json',
								description: 'JSON with text, language, duration and timestamped segments',
							},
							{
								name: 'VTT',
								value: 'vtt',
								description: 'WebVTT subtitle file with timestamps',
							},
						],
					},
					{
						displayName: 'Sampling Temperature',
						name: 'temperature',
						type: 'number',
						default: 0,
						typeOptions: {
							maxValue: 1,
							minValue: 0,
							numberPrecision: 2,
						},
						description: 'Randomness of the transcription. 0 is deterministic; higher values may hallucinate less but vary more.',
					},
					{
						displayName: 'Timeout (Ms)',
						name: 'timeout',
						type: 'number',
						default: 300000,
						description:
							'Maximum amount of time the request is allowed to take in milliseconds',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['image'],
					},
				},
				options: [
					{
						displayName: 'Detail',
						name: 'detail',
						type: 'options',
						default: 'auto',
						description:
							'Level of detail to analyze the image with. Low is cheaper and faster, High is the most accurate. Ignored by providers without detail support',
						options: [
							{
								name: 'Auto',
								value: 'auto',
								description: 'Let the model decide (not sent to the provider)',
							},
							{
								name: 'High',
								value: 'high',
								description: 'Analyze the image using the highest detail level',
							},
							{
								name: 'Low',
								value: 'low',
								description: 'Analyze the image using the lowest detail level',
							},
						],
					},
					{
						displayName: 'Extra Body',
						name: 'extraBody',
						type: 'json',
						default: '{}',
						description:
							'Additional JSON properties to include in the request body, for provider-specific parameters (e.g. temperature, response_format)',
					},
					{
						displayName: 'Maximum Number of Tokens',
						name: 'maxTokens',
						type: 'number',
						default: 0,
						description: 'Maximum number of tokens to generate in the answer. Set to 0 to use the provider default.',
					},
					{
						displayName: 'Timeout (Ms)',
						name: 'timeout',
						type: 'number',
						default: 120000,
						description:
							'Maximum amount of time the request is allowed to take in milliseconds',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;

				const json =
					resource === 'audio'
						? await executeAudioOperation(this, items[itemIndex], itemIndex)
						: await executeImageOperation(this, items[itemIndex], itemIndex);

				const newItem: INodeExecutionData = {
					json,
					pairedItem: { item: itemIndex },
				};

				if (items[itemIndex].binary !== undefined) {
					newItem.binary = items[itemIndex].binary;
				}

				returnData.push(newItem);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: redactUrl((error as Error)?.message ?? String(error)),
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (error instanceof NodeOperationError) {
					// Our own validation/config errors: keep message, description and item index.
					// NodeOperationError returns the same instance when passed one.
					throw new NodeOperationError(this.getNode(), error, { itemIndex });
				}

				const message = (error as Error)?.message ?? String(error);
				throw new NodeApiError(this.getNode(), error as JsonObject, {
					itemIndex,
					message: redactUrl(message),
				});
			}
		}

		return [returnData];
	}
}
