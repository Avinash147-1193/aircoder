/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IChatProgress } from '../../common/chatService/chatService.js';
import { ChatMessageRole, getTextResponseFromStream, IChatMessage, ILanguageModelsService } from '../../common/languageModels.js';
import { IChatAgentHistoryEntry, IChatAgentImplementation, IChatAgentRequest, IChatAgentResult } from '../../common/participants/chatAgents.js';
import { FORGE_DEFAULT_MODEL_ID } from './forgeLanguageModelProvider.js';
import { ForgeOrchestrator } from './forgeOrchestrator.js';

export class ForgeAgent extends Disposable implements IChatAgentImplementation {
	private static readonly AgentExtensionId = new ExtensionIdentifier('forge.ai');

	constructor(
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async invoke(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> {
		const modelId = await this.resolveModelId(request);
		try {
			const orchestrator = this.instantiationService.createInstance(ForgeOrchestrator);
			return await orchestrator.run(request, progress, history, modelId, token);
		} catch (error) {
			this.logService.error('[ForgeAgent] Orchestrator failed, falling back to simple response', error);
		}

		const messages = this.buildMessages(request);
		const response = await this.languageModelsService.sendChatRequest(
			modelId,
			ForgeAgent.AgentExtensionId,
			messages,
			{
				requestId: request.requestId,
				location: request.location,
				mode: request.modeInstructions?.name,
			},
			token
		);

		const responseText = await getTextResponseFromStream(response);
		progress([{
			kind: 'markdownContent',
			content: new MarkdownString(responseText)
		}]);

		return {};
	}

	private buildMessages(request: IChatAgentRequest): IChatMessage[] {
		return [{
			role: ChatMessageRole.User,
			content: [{ type: 'text', value: request.message }]
		}];
	}

	private async resolveModelId(request: IChatAgentRequest): Promise<string> {
		if (request.userSelectedModelId) {
			const byQualified = this.languageModelsService.lookupLanguageModelByQualifiedName(request.userSelectedModelId);
			if (byQualified?.identifier) {
				return byQualified.identifier;
			}
			if (this.languageModelsService.lookupLanguageModel(request.userSelectedModelId)) {
				return request.userSelectedModelId;
			}
		}

		const forgeModel = this.languageModelsService.lookupLanguageModel(FORGE_DEFAULT_MODEL_ID);
		if (forgeModel) {
			return FORGE_DEFAULT_MODEL_ID;
		}

		const candidates = this.languageModelsService.getLanguageModelIds();
		if (candidates.length) {
			return candidates[0];
		}

		this.logService.error('[ForgeAgent] No language models available.');
		return FORGE_DEFAULT_MODEL_ID;
	}
}
