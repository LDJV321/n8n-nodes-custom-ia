import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { supplyModel, type OpenAiModel } from '@n8n/ai-node-sdk';

function redactUrl(url: string): string {
	return url.replace(/\/\/[^@/]+@/, '//***@');
}

type ModelOptions = {
	temperature?: number;
	maxTokens?: number;
	topP?: number;
	frequencyPenalty?: number;
	presencePenalty?: number;
	responseFormat?: 'text' | 'json_object';
	useResponsesApi?: boolean;
	thinkingMode?: 'default' | 'enabled' | 'disabled';
	reasoningEffort?: 'default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'max';
	timeout?: number;
	maxRetries?: number;
	extraBody?: string;
};

export class CustomAiChatModel implements INodeType {
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
		displayName: 'Custom AI Chat Model',
		name: 'customAiChatModel',
		subtitle: '={{ $parameter["model"] ? $parameter["model"].value : "" }}',
		icon: { light: 'file:../../icons/customAi.svg', dark: 'file:../../icons/customAi.dark.svg' },
		group: ['transform'],
		version: [1],
		description:
			'Chat model for any OpenAI-compatible AI provider (OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Ollama, LM Studio and more)',
		defaults: {
			name: 'Custom AI Chat Model',
		},
		codex: {
			categories: ['assistant'],
			subcategories: {
				AI: ['Language Models', 'Root Nodes'],
				'Language Models': ['Chat Models (Recommended)'],
			},
			resources: {
				primaryDocumentation: [],
			},
		},

		inputs: [],

		outputs: [NodeConnectionTypes.AiLanguageModel],
		outputNames: ['Model'],
		credentials: [
			{
				name: 'customAiApi',
				required: true,
			},
		],
		properties: [
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
						placeholder: 'e.g. deepseek-v4-flash',
					},
				],
				description:
					"The model which will generate the completion. Choose from the provider's /models endpoint or set the model ID manually.",
			},
			{
				displayName: 'Options',
				name: 'options',
				placeholder: 'Add Option',
				description: 'Additional options to add',
				type: 'collection',
				default: {},
				options: [
					{
						displayName: 'Extra Body',
						name: 'extraBody',
						type: 'json',
						default: '{}',
						description:
							'Optional additional JSON properties to include in the request body, for provider-specific parameters',
					},
					{
						displayName: 'Frequency Penalty',
						name: 'frequencyPenalty',
						default: 0,
						typeOptions: { maxValue: 2, minValue: -2, numberPrecision: 1 },
						description:
							"Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim",
						type: 'number',
					},
					{
						displayName: 'Max Retries',
						name: 'maxRetries',
						default: 2,
						description: 'Maximum number of retries to attempt',
						type: 'number',
					},
					{
						displayName: 'Maximum Number of Tokens',
						name: 'maxTokens',
						default: -1,
						description:
							'The maximum number of tokens to generate in the completion. Set to -1 to use the provider default.',
						type: 'number',
					},
					{
						displayName: 'Presence Penalty',
						name: 'presencePenalty',
						default: 0,
						typeOptions: { maxValue: 2, minValue: -2, numberPrecision: 1 },
						description:
							"Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics",
						type: 'number',
					},
					{
						displayName: 'Reasoning Effort',
						name: 'reasoningEffort',
						type: 'options',
						default: 'default',
						description:
							"Constrains how much the model 'thinks' before answering. Supported by reasoning models (e.g. DeepSeek: low/high/max, medium maps to high; OpenAI: none/minimal/low/medium/high). Leave as Default for the provider default.",
						options: [
							{
								name: 'Default',
								value: 'default',
								description: 'Use the provider default',
							},
							{
								name: 'High',
								value: 'high',
								description: 'High reasoning effort',
							},
							{
								name: 'Low',
								value: 'low',
								description: 'Low reasoning effort',
							},
							{
								name: 'Max',
								value: 'max',
								description: 'Maximum reasoning effort (DeepSeek)',
							},
							{
								name: 'Medium',
								value: 'medium',
								description: 'Medium reasoning effort (DeepSeek maps it to high)',
							},
							{
								name: 'Minimal',
								value: 'minimal',
								description: 'Minimal reasoning effort',
							},
							{
								name: 'None',
								value: 'none',
								description: 'Disable reasoning (use Thinking Mode for DeepSeek)',
							},
						],
					},
					{
						displayName: 'Response Format',
						name: 'responseFormat',
						default: 'text',
						type: 'options',
						options: [
							{
								name: 'Text',
								value: 'text',
								description: 'Regular text response',
							},
							{
								name: 'JSON',
								value: 'json_object',
								description:
									'Enables JSON mode, which should guarantee the message the model generates is valid JSON. Remember to mention JSON in your prompt.',
							},
						],
					},
					{
						displayName: 'Sampling Temperature',
						name: 'temperature',
						default: 0.7,
						typeOptions: { maxValue: 2, minValue: 0, numberPrecision: 1 },
						description:
							'Controls randomness: Lowering results in less random completions. As the temperature approaches zero, the model will become deterministic and repetitive.',
						type: 'number',
					},
					{
						displayName: 'Thinking Mode',
						name: 'thinkingMode',
						type: 'options',
						default: 'default',
						description:
							'Controls the thinking mode of providers that support it (e.g. DeepSeek sends {"thinking":{"type":...}}). In thinking mode, temperature, top P and penalties have no effect. Leave as Default if your provider does not support it.',
						options: [
							{
								name: 'Default',
								value: 'default',
								description: 'Use the provider default (DeepSeek enables thinking by default)',
							},
							{
								name: 'Disabled',
								value: 'disabled',
								description: 'Disable thinking and answer directly',
							},
							{
								name: 'Enabled',
								value: 'enabled',
								description: 'Force thinking mode on',
							},
						],
					},
					{
						displayName: 'Timeout (Ms)',
						name: 'timeout',
						default: 60000,
						description: 'Maximum amount of time a request is allowed to take in milliseconds',
						type: 'number',
					},
					{
						displayName: 'Top P',
						name: 'topP',
						default: 1,
						typeOptions: { maxValue: 1, minValue: 0, numberPrecision: 1 },
						description:
							'Controls diversity via nucleus sampling: 0.5 means half of all likelihood-weighted options are considered. We generally recommend altering this or temperature but not both.',
						type: 'number',
					},
					{
						displayName: 'Use Responses API',
						name: 'useResponsesApi',
						default: false,
						description:
							'Whether to use the OpenAI Responses API. Enable only for the official OpenAI API or providers that support it. Leave disabled for standard Chat Completions compatibility.',
						type: 'boolean',
					},
				],
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials('customAiApi');

		const modelName = this.getNodeParameter('model.value', itemIndex, '') as string;
		if (!modelName) {
			throw new NodeOperationError(this.getNode(), 'Model is not set', {
				itemIndex,
				description:
					"Select a model from the list or set the model ID in the 'Model' parameter",
			});
		}

		const baseUrl = String(credentials.url ?? '').replace(/\/+$/, '');
		if (!baseUrl) {
			throw new NodeOperationError(
				this.getNode(),
				'Base URL is not set in the Custom AI API credentials',
				{ itemIndex },
			);
		}

		const options = this.getNodeParameter('options', itemIndex, {}) as ModelOptions;

		const defaultHeaders: Record<string, string> = {};
		if (credentials.header && credentials.headerName && credentials.headerValue) {
			defaultHeaders[credentials.headerName as string] = credentials.headerValue as string;
		}

		const useResponsesApi = options.useResponsesApi ?? false;
		const thinkingMode = options.thinkingMode ?? 'default';
		const reasoningEffort =
			options.reasoningEffort && options.reasoningEffort !== 'default'
				? options.reasoningEffort
				: undefined;

		const additionalParams: Record<string, unknown> = {};
		if (options.responseFormat === 'json_object') {
			additionalParams.response_format = { type: 'json_object' };
		}

		let responsesReasoningEffort: string | undefined;
		if (useResponsesApi) {
			if (thinkingMode === 'disabled') {
				responsesReasoningEffort = 'none';
			} else if (reasoningEffort) {
				responsesReasoningEffort = reasoningEffort;
			}
		} else {
			if (thinkingMode === 'enabled' || thinkingMode === 'disabled') {
				additionalParams.thinking = { type: thinkingMode };
			}
			if (reasoningEffort && thinkingMode !== 'disabled') {
				additionalParams.reasoning_effort = reasoningEffort;
			}
		}
		if (
			typeof options.extraBody === 'string' &&
			options.extraBody.trim() !== '' &&
			options.extraBody.trim() !== '{}'
		) {
			let extraBody: unknown;
			try {
				extraBody = JSON.parse(options.extraBody);
			} catch (error) {
				throw new NodeOperationError(
					this.getNode(),
					'The value in the "Extra Body" field is not valid JSON',
					{
						itemIndex,
						description: error instanceof Error ? error.message : String(error),
					},
				);
			}
			if (extraBody === null || typeof extraBody !== 'object' || Array.isArray(extraBody)) {
				throw new NodeOperationError(
					this.getNode(),
					'The value in the "Extra Body" field must be a JSON object',
					{ itemIndex },
				);
			}
			const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
			for (const [key, value] of Object.entries(extraBody as Record<string, unknown>)) {
				if (!dangerousKeys.includes(key)) {
					additionalParams[key] = value;
				}
			}
		}

		const model: OpenAiModel = {
			type: 'openai',
			baseUrl,
			apiKey: (credentials.apiKey as string) || 'sk-no-key-required',
			model: modelName,
			useResponsesApi,
			temperature: options.temperature,
			topP: options.topP,
			frequencyPenalty: options.frequencyPenalty,
			presencePenalty: options.presencePenalty,
			timeout: options.timeout ?? 60000,
			maxRetries: options.maxRetries ?? 2,
		};

		if (typeof options.maxTokens === 'number' && options.maxTokens > 0) {
			model.maxTokens = options.maxTokens;
		}
		if (Object.keys(defaultHeaders).length) {
			model.defaultHeaders = defaultHeaders;
		}
		if (Object.keys(additionalParams).length) {
			model.additionalParams = additionalParams;
		}

		if (responsesReasoningEffort) {
			model.reasoning = {
				effort: responsesReasoningEffort as NonNullable<OpenAiModel['reasoning']>['effort'],
			};
		}

		return supplyModel(this, model);
	}
}
