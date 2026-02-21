/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import path from 'path';
import { Disposable } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { getErrorMessage } from '../../../base/common/errors.js';
import { IEntitlementsData } from '../../../base/common/defaultAccount.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { ILogService } from '../../log/common/log.js';
import { ForgeAuthAccount, ForgeAuthCreateSessionRequest, ForgeAuthListSessionsRequest, ForgeAuthSession, IForgeAuthService } from '../common/forgeAuthService.js';
import type { Database } from '@vscode/sqlite3';

interface AccountRow {
	id: string;
	email: string;
	label: string;
	entitlements: string | null;
	created_at: number;
}

interface SessionRow {
	id: string;
	account_id: string;
	account_label: string;
	access_token: string;
	scopes: string;
	created_at: number;
}

export class ForgeAuthService extends Disposable implements IForgeAuthService {
	readonly _serviceBrand: undefined;

	private readonly dbPath: string;
	private readonly db: Promise<Database>;

	constructor(
		@INativeEnvironmentService environmentService: INativeEnvironmentService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.dbPath = path.join(environmentService.userDataPath, 'forge', 'auth.sqlite');
		this.db = this.connect();
	}

	async listAccounts(): Promise<ForgeAuthAccount[]> {
		const db = await this.db;
		const rows = await this.all<AccountRow>(db, 'SELECT id, email, label, entitlements, created_at FROM accounts', []);
		return rows.map(row => this.toAccount(row));
	}

	async getAccount(accountId: string): Promise<ForgeAuthAccount | undefined> {
		const db = await this.db;
		const row = await this.get<AccountRow>(db, 'SELECT id, email, label, entitlements, created_at FROM accounts WHERE id = ?', [accountId]);
		return row ? this.toAccount(row) : undefined;
	}

	async listSessions(request?: ForgeAuthListSessionsRequest): Promise<ForgeAuthSession[]> {
		const db = await this.db;
		const rows = await this.all<SessionRow>(db, 'SELECT id, account_id, account_label, access_token, scopes, created_at FROM sessions', []);
		const scopes = request?.scopes ?? [];
		const accountId = request?.accountId;
		return rows
			.filter(row => !accountId || row.account_id === accountId)
			.map(row => this.toSession(row))
			.filter(session => scopes.length === 0 || scopes.every(scope => session.scopes.includes(scope)));
	}

	async createSession(request: ForgeAuthCreateSessionRequest): Promise<ForgeAuthSession> {
		const db = await this.db;
		const account = await this.getOrCreateAccount(db, request);
		const now = Date.now();
		const session: ForgeAuthSession = {
			id: generateUuid(),
			accountId: account.id,
			accountLabel: account.label,
			accessToken: `forge-${generateUuid()}`,
			scopes: request.scopes,
			createdAt: now,
		};

		await this.run(
			db,
			'INSERT INTO sessions (id, account_id, account_label, access_token, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
			[session.id, session.accountId, session.accountLabel, session.accessToken, JSON.stringify(session.scopes), session.createdAt]
		);

		return session;
	}

	async removeSession(sessionId: string): Promise<void> {
		const db = await this.db;
		await this.run(db, 'DELETE FROM sessions WHERE id = ?', [sessionId]);
	}

	async getEntitlements(accountId: string): Promise<IEntitlementsData | undefined> {
		const account = await this.getAccount(accountId);
		if (!account) {
			return undefined;
		}
		if (account.entitlements) {
			return account.entitlements;
		}
		const entitlements = this.buildDefaultEntitlements(accountId);
		await this.setEntitlements(accountId, entitlements);
		return entitlements;
	}

	private async getOrCreateAccount(db: Database, request: ForgeAuthCreateSessionRequest): Promise<ForgeAuthAccount> {
		const requestedEmail = this.normalizeEmail(request.email);
		let accountRow: AccountRow | undefined;

		if (request.accountId) {
			accountRow = await this.get<AccountRow>(db, 'SELECT id, email, label, entitlements, created_at FROM accounts WHERE id = ?', [request.accountId]);
		}

		if (!accountRow && requestedEmail) {
			accountRow = await this.get<AccountRow>(db, 'SELECT id, email, label, entitlements, created_at FROM accounts WHERE email = ?', [requestedEmail]);
		}

		if (!accountRow) {
			if (!requestedEmail) {
				throw new Error('Email is required to create a Forge account.');
			}
			const now = Date.now();
			const id = generateUuid();
			const label = (request.displayName ?? '').trim() || requestedEmail;
			const entitlements = this.buildDefaultEntitlements(id);
			await this.run(
				db,
				'INSERT INTO accounts (id, email, label, entitlements, created_at) VALUES (?, ?, ?, ?, ?)',
				[id, requestedEmail, label, JSON.stringify(entitlements), now]
			);
			accountRow = {
				id,
				email: requestedEmail,
				label,
				entitlements: JSON.stringify(entitlements),
				created_at: now,
			};
		} else if (request.displayName && request.displayName.trim() && request.displayName.trim() !== accountRow.label) {
			const updatedLabel = request.displayName.trim();
			await this.run(db, 'UPDATE accounts SET label = ? WHERE id = ?', [updatedLabel, accountRow.id]);
			await this.run(db, 'UPDATE sessions SET account_label = ? WHERE account_id = ?', [updatedLabel, accountRow.id]);
			accountRow = { ...accountRow, label: updatedLabel };
		}

		return this.toAccount(accountRow);
	}

	private toAccount(row: AccountRow): ForgeAuthAccount {
		let entitlements: IEntitlementsData | undefined;
		if (row.entitlements) {
			try {
				entitlements = JSON.parse(row.entitlements) as IEntitlementsData;
			} catch (error) {
				this.logService.debug(`[ForgeAuthService] Failed to parse entitlements: ${getErrorMessage(error)}`);
			}
		}

		return {
			id: row.id,
			email: row.email,
			label: row.label,
			createdAt: row.created_at,
			entitlements,
		};
	}

	private toSession(row: SessionRow): ForgeAuthSession {
		let scopes: string[] = [];
		try {
			const parsed = JSON.parse(row.scopes) as string[];
			if (Array.isArray(parsed)) {
				scopes = parsed;
			}
		} catch (error) {
			this.logService.debug(`[ForgeAuthService] Failed to parse session scopes: ${getErrorMessage(error)}`);
		}

		return {
			id: row.id,
			accountId: row.account_id,
			accountLabel: row.account_label,
			accessToken: row.access_token,
			scopes,
			createdAt: row.created_at,
		};
	}

	private normalizeEmail(value?: string): string | undefined {
		const trimmed = value?.trim().toLowerCase();
		return trimmed ? trimmed : undefined;
	}

	private buildDefaultEntitlements(accountId: string): IEntitlementsData {
		const now = new Date().toISOString();
		return {
			access_type_sku: 'free_limited_copilot',
			assigned_date: now,
			can_signup_for_limited: false,
			copilot_plan: 'free',
			organization_login_list: [],
			analytics_tracking_id: accountId,
			limited_user_reset_date: now,
		};
	}

	private async setEntitlements(accountId: string, entitlements: IEntitlementsData): Promise<void> {
		const db = await this.db;
		await this.run(db, 'UPDATE accounts SET entitlements = ? WHERE id = ?', [JSON.stringify(entitlements), accountId]);
	}

	private async connect(): Promise<Database> {
		await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
		const sqlite3 = await import('@vscode/sqlite3');
		const ctor = sqlite3.default.Database;

		return new Promise((resolve, reject) => {
			const db = new ctor(this.dbPath, error => {
				if (error) {
					return reject(error);
				}
				const sql = [
					'PRAGMA journal_mode=WAL;',
					'PRAGMA foreign_keys=ON;',
					'CREATE TABLE IF NOT EXISTS accounts (',
					'  id TEXT PRIMARY KEY,',
					'  email TEXT UNIQUE,',
					'  label TEXT,',
					'  entitlements TEXT,',
					'  created_at INTEGER',
					');',
					'CREATE TABLE IF NOT EXISTS sessions (',
					'  id TEXT PRIMARY KEY,',
					'  account_id TEXT,',
					'  account_label TEXT,',
					'  access_token TEXT,',
					'  scopes TEXT,',
					'  created_at INTEGER,',
					'  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE',
					');',
					'CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id);',
				].join('\n');

				db.exec(sql, execError => {
					if (execError) {
						db.close(() => reject(execError));
						return;
					}
					resolve(db);
				});
			});
		});
	}

	private run(db: Database, sql: string, params: unknown[]): Promise<void> {
		return new Promise((resolve, reject) => {
			db.run(sql, params, error => {
				if (error) {
					return reject(error);
				}
				resolve();
			});
		});
	}

	private get<T>(db: Database, sql: string, params: unknown[]): Promise<T | undefined> {
		return new Promise((resolve, reject) => {
			db.get(sql, params, (error, row) => {
				if (error) {
					return reject(error);
				}
				resolve(row as T | undefined);
			});
		});
	}

	private all<T>(db: Database, sql: string, params: unknown[]): Promise<T[]> {
		return new Promise((resolve, reject) => {
			db.all(sql, params, (error, rows) => {
				if (error) {
					return reject(error);
				}
				resolve(rows as T[]);
			});
		});
	}
}
