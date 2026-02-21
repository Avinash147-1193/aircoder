/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { AuthenticationSession, AuthenticationSessionsChangeEvent, IAuthenticationProvider, IAuthenticationProviderSessionOptions, IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ForgeAuthAccount, IForgeAuthService, ForgeAuthSession } from '../../../../platform/forge/common/forgeAuthService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';

class ForgeAuthenticationProvider extends Disposable implements IAuthenticationProvider {
	private readonly _onDidChangeSessions = this._register(new Emitter<AuthenticationSessionsChangeEvent>());
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	constructor(
		public readonly id: string,
		public readonly label: string,
		private readonly authService: IForgeAuthService,
		private readonly quickInputService: IQuickInputService,
	) {
		super();
	}

	readonly supportsMultipleAccounts = true;

	async getSessions(scopes: string[] | undefined, options: IAuthenticationProviderSessionOptions): Promise<readonly AuthenticationSession[]> {
		const sessions = await this.authService.listSessions({
			scopes,
			accountId: options.account?.id,
		});
		return sessions.map(session => this.toAuthenticationSession(session));
	}

	async createSession(scopes: string[], options: IAuthenticationProviderSessionOptions): Promise<AuthenticationSession> {
		const accountChoice = await this.resolveAccountChoice(options);
		const session = await this.authService.createSession({
			accountId: accountChoice.accountId,
			email: accountChoice.email,
			displayName: accountChoice.displayName,
			scopes,
		});
		const authSession = this.toAuthenticationSession(session);
		this._onDidChangeSessions.fire({ added: [authSession], removed: [], changed: [] });
		return authSession;
	}

	async removeSession(sessionId: string): Promise<void> {
		const sessions = await this.authService.listSessions();
		const toRemove = sessions.find(session => session.id === sessionId);
		await this.authService.removeSession(sessionId);
		if (toRemove) {
			this._onDidChangeSessions.fire({ added: [], removed: [this.toAuthenticationSession(toRemove)], changed: [] });
		}
	}

	private toAuthenticationSession(session: ForgeAuthSession): AuthenticationSession {
		return {
			id: session.id,
			accessToken: session.accessToken,
			account: {
				id: session.accountId,
				label: session.accountLabel,
			},
			scopes: session.scopes,
		};
	}

	private async resolveAccountChoice(options: IAuthenticationProviderSessionOptions): Promise<{ accountId?: string; email?: string; displayName?: string }> {
		if (options.account?.id) {
			return { accountId: options.account.id, displayName: options.account.label };
		}

		const accounts = await this.authService.listAccounts();
		if (!accounts.length) {
			return this.promptForNewAccount();
		}

		type AccountPickItem = { label: string; description?: string; account?: ForgeAuthAccount };
		const pickItems: AccountPickItem[] = accounts.map(account => ({
			label: account.label,
			description: account.email,
			account,
		}));
		pickItems.push({
			label: localize('forgeAuth.addAccount', "Add a new Forge account"),
			description: '',
		});

		const picked = await this.quickInputService.pick(pickItems, {
			placeHolder: localize('forgeAuth.pickAccount', "Select a Forge account"),
			ignoreFocusLost: true,
		});

		if (!picked) {
			throw new CancellationError();
		}

		if (picked.account) {
			return { accountId: picked.account.id, displayName: picked.account.label };
		}

		return this.promptForNewAccount();
	}

	private async promptForNewAccount(): Promise<{ email: string; displayName?: string }> {
		const email = await this.quickInputService.input({
			prompt: localize('forgeAuth.emailPrompt', "Forge email"),
			placeHolder: 'you@example.com',
			ignoreFocusLost: true,
			validateInput: async value => {
				const trimmed = value.trim();
				if (!trimmed) {
					return localize('forgeAuth.emailRequired', "Email is required.");
				}
				if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
					return localize('forgeAuth.emailInvalid', "Enter a valid email address.");
				}
				return undefined;
			}
		});

		if (!email) {
			throw new CancellationError();
		}

		const displayName = await this.quickInputService.input({
			prompt: localize('forgeAuth.namePrompt', "Display name (optional)"),
			placeHolder: localize('forgeAuth.namePlaceholder', "Jane Doe"),
			ignoreFocusLost: true,
		});

		return { email, displayName: displayName?.trim() || undefined };
	}
}

class ForgeAuthenticationContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.forgeAuthentication';

	constructor(
		@IAuthenticationService authenticationService: IAuthenticationService,
		@IForgeAuthService forgeAuthService: IForgeAuthService,
		@IQuickInputService quickInputService: IQuickInputService,
		@ILogService logService: ILogService,
		@IProductService productService: IProductService,
	) {
		super();

		const defaultProvider = productService.defaultChatAgent?.provider?.default;
		const enterpriseProvider = productService.defaultChatAgent?.provider?.enterprise;

		if (defaultProvider?.id) {
			this.registerProvider(authenticationService, forgeAuthService, quickInputService, logService, defaultProvider.id, defaultProvider.name ?? 'Forge');
		}
		if (enterpriseProvider?.id && enterpriseProvider.id !== defaultProvider?.id) {
			this.registerProvider(authenticationService, forgeAuthService, quickInputService, logService, enterpriseProvider.id, enterpriseProvider.name ?? 'Forge Enterprise');
		}
	}

	private registerProvider(
		authenticationService: IAuthenticationService,
		forgeAuthService: IForgeAuthService,
		quickInputService: IQuickInputService,
		logService: ILogService,
		id: string,
		label: string,
	): void {
		if (authenticationService.isAuthenticationProviderRegistered(id)) {
			return;
		}
		try {
			authenticationService.registerDeclaredAuthenticationProvider({ id, label });
		} catch (error) {
			logService.debug(`[ForgeAuth] provider declaration skipped: ${error}`);
		}

		const provider = this._register(new ForgeAuthenticationProvider(id, label, forgeAuthService, quickInputService));
		authenticationService.registerAuthenticationProvider(id, provider);
	}
}

registerWorkbenchContribution2(ForgeAuthenticationContribution.ID, ForgeAuthenticationContribution, WorkbenchPhase.BlockStartup);
