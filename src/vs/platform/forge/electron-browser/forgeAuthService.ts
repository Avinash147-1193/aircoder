/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSharedProcessRemoteService } from '../../ipc/electron-browser/services.js';
import { ForgeAuthChannelName, IForgeAuthService } from '../common/forgeAuthService.js';

registerSharedProcessRemoteService(IForgeAuthService, ForgeAuthChannelName);
