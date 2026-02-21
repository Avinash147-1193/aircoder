/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IEntitlementsData } from '../../../base/common/defaultAccount.js';

export const ForgeAuthChannelName = 'forgeAuth';

export const IForgeAuthService = createDecorator<IForgeAuthService>('forgeAuthService');

export interface ForgeAuthAccount {
	readonly id: string;
	readonly email: string;
	readonly label: string;
	readonly createdAt: number;
	readonly entitlements?: IEntitlementsData;
}

export interface ForgeAuthSession {
	readonly id: string;
	readonly accountId: string;
	readonly accountLabel: string;
	readonly accessToken: string;
	readonly scopes: string[];
	readonly createdAt: number;
}

export interface ForgeAuthListSessionsRequest {
	readonly scopes?: string[];
	readonly accountId?: string;
}

export interface ForgeAuthCreateSessionRequest {
	readonly accountId?: string;
	readonly email?: string;
	readonly displayName?: string;
	readonly scopes: string[];
}

export interface IForgeAuthService {
	readonly _serviceBrand: undefined;
	listAccounts(): Promise<ForgeAuthAccount[]>;
	getAccount(accountId: string): Promise<ForgeAuthAccount | undefined>;
	listSessions(request?: ForgeAuthListSessionsRequest): Promise<ForgeAuthSession[]>;
	createSession(request: ForgeAuthCreateSessionRequest): Promise<ForgeAuthSession>;
	removeSession(sessionId: string): Promise<void>;
	getEntitlements(accountId: string): Promise<IEntitlementsData | undefined>;
}

export class NullForgeAuthService implements IForgeAuthService {
	_serviceBrand: undefined;

	async listAccounts(): Promise<ForgeAuthAccount[]> {
		return [];
	}

	async getAccount(_accountId: string): Promise<ForgeAuthAccount | undefined> {
		return undefined;
	}

	async listSessions(_request?: ForgeAuthListSessionsRequest): Promise<ForgeAuthSession[]> {
		return [];
	}

	async createSession(_request: ForgeAuthCreateSessionRequest): Promise<ForgeAuthSession> {
		throw new Error('Forge authentication is not available.');
	}

	async removeSession(_sessionId: string): Promise<void> {
		// no-op
	}

	async getEntitlements(_accountId: string): Promise<IEntitlementsData | undefined> {
		return undefined;
	}
}
