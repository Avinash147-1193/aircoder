/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry, ConfigurationScope } from '../../configuration/common/configurationRegistry.js';
import { Registry } from '../../registry/common/platform.js';

export const ForgeConfiguration = {
	apiBaseUrl: 'forge.api.baseUrl',
	apiAuthToken: 'forge.api.authToken',
	commandAllowlist: 'forge.tools.commandAllowlist',
	commandDenylist: 'forge.tools.commandDenylist',
	agentEnableTools: 'forge.agent.enableTools',
	agentEnableRetrieval: 'forge.agent.enableRetrieval',
	agentEnableMemory: 'forge.agent.enableMemory',
	agentPlanningEnabled: 'forge.agent.planningEnabled',
	agentToolAllowlist: 'forge.agent.toolAllowlist',
	agentMaxToolCalls: 'forge.agent.maxToolCalls',
	agentMaxContextItems: 'forge.agent.maxContextItems',
	agentMaxMemoryItems: 'forge.agent.maxMemoryItems',
} as const;

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'forge',
	order: 70,
	title: localize('forgeConfigurationTitle', "Forge"),
	type: 'object',
	properties: {
		[ForgeConfiguration.apiBaseUrl]: {
			type: 'string',
			description: localize('forgeApiBaseUrl', "Base URL for the Forge backend API."),
			default: 'http://localhost:8787',
			scope: ConfigurationScope.APPLICATION,
			tags: ['usesOnlineServices']
		},
		[ForgeConfiguration.apiAuthToken]: {
			type: 'string',
			description: localize('forgeApiAuthToken', "API token for authenticating Forge backend requests."),
			default: '',
			scope: ConfigurationScope.APPLICATION,
			tags: ['usesOnlineServices']
		},
		[ForgeConfiguration.commandAllowlist]: {
			type: 'array',
			items: { type: 'string' },
			description: localize('forgeToolsCommandAllowlist', "List of substrings that are allowed to run via Forge tools. If empty, all commands not in the denylist are allowed."),
			default: [],
			scope: ConfigurationScope.APPLICATION,
		},
		[ForgeConfiguration.commandDenylist]: {
			type: 'array',
			items: { type: 'string' },
			description: localize('forgeToolsCommandDenylist', "List of substrings that are blocked from running via Forge tools."),
			default: ['rm -rf', 'mkfs', 'shutdown', 'reboot', 'poweroff', 'sudo'],
			scope: ConfigurationScope.APPLICATION,
		},
		[ForgeConfiguration.agentEnableTools]: {
			type: 'boolean',
			description: localize('forgeAgentEnableTools', "Enable tool usage in the Forge agent."),
			default: true,
			scope: ConfigurationScope.APPLICATION,
		},
		[ForgeConfiguration.agentEnableRetrieval]: {
			type: 'boolean',
			description: localize('forgeAgentEnableRetrieval', "Enable retrieval (semantic search) for the Forge agent."),
			default: true,
			scope: ConfigurationScope.APPLICATION,
		},
		[ForgeConfiguration.agentEnableMemory]: {
			type: 'boolean',
			description: localize('forgeAgentEnableMemory', "Enable memory (local and optional backend) for the Forge agent."),
			default: false,
			scope: ConfigurationScope.APPLICATION,
		},
		[ForgeConfiguration.agentPlanningEnabled]: {
			type: 'boolean',
			description: localize('forgeAgentPlanningEnabled', "Enable the planning step before tool execution."),
			default: true,
			scope: ConfigurationScope.APPLICATION,
		},
		[ForgeConfiguration.agentToolAllowlist]: {
			type: 'array',
			items: { type: 'string' },
			description: localize('forgeAgentToolAllowlist', "List of tool IDs the Forge agent is allowed to invoke."),
			default: ['forge_readFile', 'forge_listDirectory', 'forge_searchText'],
			scope: ConfigurationScope.APPLICATION,
		},
		[ForgeConfiguration.agentMaxToolCalls]: {
			type: 'number',
			description: localize('forgeAgentMaxToolCalls', "Maximum number of tool calls per request."),
			default: 4,
			scope: ConfigurationScope.APPLICATION,
		},
		[ForgeConfiguration.agentMaxContextItems]: {
			type: 'number',
			description: localize('forgeAgentMaxContextItems', "Maximum number of retrieval context items included in the prompt."),
			default: 6,
			scope: ConfigurationScope.APPLICATION,
		},
		[ForgeConfiguration.agentMaxMemoryItems]: {
			type: 'number',
			description: localize('forgeAgentMaxMemoryItems', "Maximum number of memory items included in the prompt."),
			default: 5,
			scope: ConfigurationScope.APPLICATION,
		},
	}
});
