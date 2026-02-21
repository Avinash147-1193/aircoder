/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSharedProcessRemoteService } from '../../ipc/electron-browser/services.js';
import { ForgeAiChannelName, IForgeAiService } from '../common/forgeAiService.js';

registerSharedProcessRemoteService(IForgeAiService, ForgeAiChannelName);
