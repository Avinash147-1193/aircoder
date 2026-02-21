/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IDefaultAccountService } from '../../../../../platform/defaultAccount/common/defaultAccount.js';
import { IChatEntitlementService } from '../../../../services/chat/common/chatEntitlementService.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { URI } from '../../../../../base/common/uri.js';
import { registerWorkbenchContribution2, IWorkbenchContribution, WorkbenchPhase } from '../../../../common/contributions.js';
import { ChatAgentLocation, ChatModeKind } from '../../common/constants.js';
import { IChatAgentService } from '../../common/participants/chatAgents.js';
import { ILanguageModelsService } from '../../common/languageModels.js';
import { ForgeAgent } from './forgeAgent.js';
import { ForgeLanguageModelProvider, FORGE_LANGUAGE_MODEL_VENDOR } from './forgeLanguageModelProvider.js';

const FORGE_AGENT_ID = 'forge';
const FORGE_EXTENSION_ID = new ExtensionIdentifier('forge.ai');

export class ForgeChatContribution extends Disposable implements IWorkbenchContribution {
	static readonly Id = 'workbench.contrib.forgeChat';

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
	) {
		super();

		this.languageModelsService.deltaLanguageModelChatProviderDescriptors([
			{
				vendor: FORGE_LANGUAGE_MODEL_VENDOR,
				displayName: 'Forge',
				configuration: undefined,
				managementCommand: undefined,
				when: undefined,
			}
		], []);

		const provider = this.instantiationService.createInstance(ForgeLanguageModelProvider);
		this._register(this.languageModelsService.registerLanguageModelProvider(FORGE_LANGUAGE_MODEL_VENDOR, provider));
		void this.languageModelsService.selectLanguageModels({ vendor: FORGE_LANGUAGE_MODEL_VENDOR });

		this._register(this.chatAgentService.registerAgent(FORGE_AGENT_ID, {
			id: FORGE_AGENT_ID,
			name: 'forge',
			fullName: 'Forge',
			description: 'AI coding assistant',
			isDefault: true,
			isCore: true,
			metadata: {},
			slashCommands: [],
			disambiguation: [],
			locations: [
				ChatAgentLocation.Chat,
				ChatAgentLocation.EditorInline,
				ChatAgentLocation.Notebook,
				ChatAgentLocation.Terminal,
			],
			modes: [ChatModeKind.Ask, ChatModeKind.Edit, ChatModeKind.Agent],
			extensionId: FORGE_EXTENSION_ID,
			extensionVersion: undefined,
			extensionDisplayName: 'Forge',
			extensionPublisherId: 'forge',
			publisherDisplayName: 'Forge',
		}));

		const agentImpl = this.instantiationService.createInstance(ForgeAgent);
		this._register(this.chatAgentService.registerAgentImplementation(FORGE_AGENT_ID, agentImpl));

		this.registerCommands();
	}

	private registerCommands(): void {
		this._register(CommandsRegistry.registerCommand('forge.ai.open.walkthrough', accessor => {
			return accessor.get(IOpenerService).open(URI.parse('https://forge.ai/docs'));
		}));

		this.registerInfoCommand('forge.ai.toggleStatusMenu', 'Forge status menu is not available yet.');
		this._register(CommandsRegistry.registerCommand('forge.ai.signIn', accessor => {
			return accessor.get(IDefaultAccountService).signIn();
		}));
		this._register(CommandsRegistry.registerCommand('forge.ai.refreshToken', async accessor => {
			const defaultAccountService = accessor.get(IDefaultAccountService);
			const entitlementService = accessor.get(IChatEntitlementService);
			await defaultAccountService.refresh();
			await entitlementService.update(CancellationToken.None);
		}));
		this.registerInfoCommand('forge.ai.git.generateCommitMessage', 'Forge commit message generation is not available yet.');
		this.registerInfoCommand('forge.ai.git.resolveMergeConflicts', 'Forge merge conflict helper is not available yet.');
	}

	private registerInfoCommand(commandId: string, message: string): void {
		this._register(CommandsRegistry.registerCommand(commandId, accessor => {
			accessor.get(INotificationService).info(message);
		}));
	}
}

registerWorkbenchContribution2(ForgeChatContribution.Id, ForgeChatContribution, WorkbenchPhase.BlockRestore);
