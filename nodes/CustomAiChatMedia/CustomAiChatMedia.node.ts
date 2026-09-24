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

type CommonOptions = {
	extraBody?: string;
	timeout?: number;
};

type ImageOptions = CommonOptions & {
	detail?: string;
	maxTokens?: number;
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

function extractChoiceText(choice: IDataObject | undefined): string {
	if (!choice) return '';
	const message = choice.message as IDataObject | undefined;
	// Reasoning models (e.g. mimo, deepseek reasoner) may leave content null and
	// put the answer in reasoning_content, so fall back to it when content is empty.
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

function audioFormatFrom(mimeType?: string, fileExtension?: string): string {
	const mime = (mimeType ?? '').toLowerCase();
	if (mime === 'audio/mpeg' || mime === 'audio/mp3') return 'mp3';
	if (mime === 'audio/wav' || mime === 'audio/x-wav' || mime === 'audio/wave') return 'wav';
	if (mime === 'audio/mp4' || mime === 'audio/x-m4a' || mime === 'audio/aac') return 'm4a';
	if (mime === 'audio/ogg' || mime === 'audio/opus') return 'ogg';
	if (mime === 'audio/flac' || mime === 'audio/x-flac') return 'flac';

	const extension = (fileExtension ?? '').toLowerCase().replace(/^\./, '');
	if (extension) return extension;
	return 'mp3';
}

async function postChatCompletions(
	ctx: IExecuteFunctions,
	itemIndex: number,
	model: string,
	content: IDataObject[],
	options: CommonOptions & { maxTokens?: number },
): Promise<IDataObject> {
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

	return response as IDataObject;
}

function pickText(response: IDataObject): string {
	const choices = response.choices as IDataObject[] | undefined;
	return extractChoiceText(choices?.[0]);
}

async function executeAudioViaCompletions(
	ctx: IExecuteFunctions,
	item: INodeExecutionData,
	itemIndex: number,
): Promise<IDataObject> {
	const model = getRequiredModel(ctx, itemIndex);
	const options = ctx.getNodeParameter('options', itemIndex, {}) as CommonOptions;
	const prompt = ctx.getNodeParameter('prompt', itemIndex) as string;

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

	const format = audioFormatFrom(binary.mimeType, binary.fileExtension);
	const content: IDataObject[] = [
		{ type: 'text', text: prompt },
		{
			type: 'input_audio',
			input_audio: { data: buffer.toString('base64'), format },
		},
	];

	const response = await postChatCompletions(ctx, itemIndex, model, content, options);

	const simplify = ctx.getNodeParameter('simplify', itemIndex, true) as boolean;
	if (simplify) return { text: pickText(response) };
	return response;
}

async function executeImageViaCompletions(
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
		imageUrls.push(
			...raw
				.split(',')
				.map((entry) => entry.trim())
				.filter(Boolean),
		);
		if (imageUrls.length === 0) {
			throw new NodeOperationError(ctx.getNode(), 'No image URL provided', {
				itemIndex,
				description: "Enter at least one URL in the 'Image URL' parameter",
			});
		}
	} else {
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
		const mimeType = binary.mimeType ?? 'image/png';
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

	const response = await postChatCompletions(ctx, itemIndex, model, content, options);

	const simplify = ctx.getNodeParameter('simplify', itemIndex, true) as boolean;
	if (simplify) return { text: pickText(response) };
	return response;
}

export class CustomAiChatMedia implements INodeType {
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
		displayName: 'Custom AI Chat Media (Via Completions)',
		name: 'customAiChatMedia',
		icon: { light: 'file:../../icons/customAi.svg', dark: 'file:../../icons/customAi.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{ $parameter["operation"] }}',
		description:
			'Transcribe audio and analyze images through the chat completions endpoint, for providers without dedicated media endpoints (e.g. OpenCode Zen)',
		defaults: {
			name: 'Custom AI Chat Media',
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
						description: 'Transcribe speech into text through chat completions',
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
						description: 'Send the audio as an input_audio content part and get the text back',
						action: 'Transcribe audio',
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
						placeholder: 'e.g. mimo-v2-omni',
					},
				],
				description:
					"The model to use. Choose from the provider's /models endpoint or set the model ID manually. For audio the model must accept audio input (e.g. mimo-v2-omni, gpt-4o-audio, Qwen3-ASR), for images a vision model.",
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
					'Name of the input binary property containing the audio file to transcribe (chat uploads land in data0)',
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
				default: 'Transcribe this audio accurately.',
				required: true,
				typeOptions: {
					rows: 3,
				},
				displayOptions: {
					show: {
						resource: ['audio'],
					},
				},
				description: 'Instruction sent with the audio. Write it in the language you want the transcript in.',
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
				default: true,
				description:
					'Whether to return a simplified version of the response instead of the raw data',
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
						displayName: 'Timeout (Ms)',
						name: 'timeout',
						type: 'number',
						default: 120000,
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
						? await executeAudioViaCompletions(this, items[itemIndex], itemIndex)
						: await executeImageViaCompletions(this, items[itemIndex], itemIndex);

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
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (error instanceof NodeOperationError) {
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
