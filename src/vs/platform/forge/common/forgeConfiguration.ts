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
		}
	}
});
