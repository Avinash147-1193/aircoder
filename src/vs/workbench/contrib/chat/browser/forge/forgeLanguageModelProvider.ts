/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { IForgeAiService } from '../../../../../platform/forge/common/forgeAiService.js';
import { ChatAgentLocation } from '../../common/constants.js';
import { ChatMessageRole, IChatMessage, IChatMessagePart, IChatResponsePart, ILanguageModelChatInfoOptions, ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier, ILanguageModelChatProvider, ILanguageModelChatResponse } from '../../common/languageModels.js';

export const FORGE_LANGUAGE_MODEL_VENDOR = 'forge';
export const FORGE_DEFAULT_MODEL_ID = 'forge.default';
export const FORGE_OPENAI_MODEL_ID = 'forge.openai.gpt-4o-mini';
export const FORGE_GEMINI_MODEL_ID = 'forge.gemini.2.5-flash';

const BASE_MODEL: Omit<ILanguageModelChatMetadata, 'id' | 'name' | 'family' | 'isDefaultForLocation'> = {
	extension: new ExtensionIdentifier('forge.ai'),
	vendor: FORGE_LANGUAGE_MODEL_VENDOR,
	version: '1',
	maxInputTokens: 32768,
	maxOutputTokens: 4096,
	isUserSelectable: true,
	modelPickerCategory: { label: 'Forge', order: 1 },
	capabilities: {
		toolCalling: true,
		agentMode: true,
	},
};

const DEFAULT_MODEL: ILanguageModelChatMetadata = {
	...BASE_MODEL,
	name: 'Forge (Auto)',
	id: FORGE_DEFAULT_MODEL_ID,
	family: 'forge',
	isDefaultForLocation: {
		[ChatAgentLocation.Chat]: true,
		[ChatAgentLocation.EditorInline]: true,
		[ChatAgentLocation.Notebook]: true,
		[ChatAgentLocation.Terminal]: true,
	},
};

const OPENAI_MODEL: ILanguageModelChatMetadata = {
	...BASE_MODEL,
	name: 'OpenAI GPT-4o mini',
	id: FORGE_OPENAI_MODEL_ID,
	family: 'openai',
	isDefaultForLocation: {},
};

const GEMINI_MODEL: ILanguageModelChatMetadata = {
	...BASE_MODEL,
	name: 'Gemini 1.5 Flash',
	id: FORGE_GEMINI_MODEL_ID,
	family: 'gemini',
	isDefaultForLocation: {},
};

export class ForgeLanguageModelProvider implements ILanguageModelChatProvider {
	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		@IForgeAiService private readonly forgeAiService: IForgeAiService,
	) { }

	async provideLanguageModelChatInfo(_options: ILanguageModelChatInfoOptions, _token: CancellationToken): Promise<ILanguageModelChatMetadataAndIdentifier[]> {
		return [
			{ metadata: DEFAULT_MODEL, identifier: DEFAULT_MODEL.id },
			{ metadata: OPENAI_MODEL, identifier: OPENAI_MODEL.id },
			{ metadata: GEMINI_MODEL, identifier: GEMINI_MODEL.id },
		];
	}

	async sendChatRequest(modelId: string, messages: IChatMessage[], _from: ExtensionIdentifier, options: { [name: string]: unknown }, token: CancellationToken): Promise<ILanguageModelChatResponse> {
		const requestId = typeof options?.requestId === 'string' ? options.requestId : generateUuid();
		const forgeMessages = messages.map(message => ({
			role: this.toForgeRole(message.role),
			content: this.flattenMessageContent(message.content),
		}));

		const response = await this.forgeAiService.chat({
			requestId,
			modelId,
			messages: forgeMessages,
		}, token);

		const stream = (async function* (): AsyncIterable<IChatResponsePart> {
			yield { type: 'text', value: response.content };
		})();

		return {
			stream,
			result: Promise.resolve(response),
		};
	}

	async provideTokenCount(_modelId: string, message: string | IChatMessage, _token: CancellationToken): Promise<number> {
		const text = typeof message === 'string' ? message : this.flattenMessageContent(message.content);
		return Math.max(1, Math.ceil(text.length / 4));
	}

	private toForgeRole(role: ChatMessageRole): 'system' | 'user' | 'assistant' {
		switch (role) {
			case ChatMessageRole.System:
				return 'system';
			case ChatMessageRole.Assistant:
				return 'assistant';
			default:
				return 'user';
		}
	}

	private flattenMessageContent(content: IChatMessagePart[]): string {
		const parts = content.map(part => {
			if (part.type === 'text') {
				return part.value;
			}
			if (part.type === 'thinking') {
				return Array.isArray(part.value) ? part.value.join('\n') : part.value;
			}
			if (part.type === 'tool_result') {
				return part.value
					.map(toolPart => toolPart.type === 'text' ? toolPart.value : '')
					.filter(Boolean)
					.join('\n');
			}
			return '';
		}).filter(Boolean);

		return parts.length ? parts.join('\n') : '[non-text content omitted]';
	}
}
