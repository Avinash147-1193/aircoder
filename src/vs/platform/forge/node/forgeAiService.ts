/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { getErrorMessage } from '../../../base/common/errors.js';
import { hash } from '../../../base/common/hash.js';
import { URI } from '../../../base/common/uri.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { IFileService } from '../../files/common/files.js';
import { ILogService } from '../../log/common/log.js';
import { IRequestService, asJson, isSuccess } from '../../request/common/request.js';
import { ForgeChatRequest, ForgeChatResponse, ForgeCompletionRequest, ForgeCompletionResponse, ForgeEmbeddingRequest, ForgeEmbeddingResponse, ForgeIndexRequest, ForgeIndexStatus, ForgeMemoryQueryRequest, ForgeMemoryQueryResponse, ForgeMemoryWriteRequest, ForgeMemoryWriteResponse, ForgePolicyCheckRequest, ForgePolicyDecision, ForgeRunCommandRequest, ForgeRunCommandResponse, ForgeSearchRequest, ForgeSearchResponse, IForgeAiService } from '../common/forgeAiService.js';
import { ForgeConfiguration } from '../common/forgeConfiguration.js';

interface ForgeApiError {
	error?: { message?: string };
	message?: string;
}

interface ForgeIndexFile {
	version: 1;
	workspaceId: string;
	files: Record<string, { mtime: number; hash: number }>;
	chunks: Array<{
		id: string;
		path: string;
		startLine: number;
		endLine: number;
		text: string;
		embedding: number[];
	}>;
}

export class ForgeAiService implements IForgeAiService {
	readonly _serviceBrand: undefined;

	private readonly _indexStatus: ForgeIndexStatus = { status: 'idle' };
	private readonly _indexes = new Map<string, ForgeIndexFile>();

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
	) { }

	async complete(request: ForgeCompletionRequest, token: CancellationToken): Promise<ForgeCompletionResponse> {
		return this.postJson<ForgeCompletionResponse>('/v1/completions', request, token);
	}

	async chat(request: ForgeChatRequest, token: CancellationToken): Promise<ForgeChatResponse> {
		return this.postJson<ForgeChatResponse>('/v1/chat', request, token);
	}

	async embed(request: ForgeEmbeddingRequest, token: CancellationToken): Promise<ForgeEmbeddingResponse> {
		return this.postJson<ForgeEmbeddingResponse>('/v1/embeddings', request, token);
	}

	async policyCheck(request: ForgePolicyCheckRequest, token: CancellationToken): Promise<ForgePolicyDecision> {
		try {
			return await this.postJson<ForgePolicyDecision>('/v1/policy/check', request, token);
		} catch (error) {
			this.logService.debug(`[ForgeAiService] Policy check failed, allowing by default: ${getErrorMessage(error)}`);
			return { allowed: true };
		}
	}

	async getIndexStatus(): Promise<ForgeIndexStatus> {
		return this._indexStatus;
	}

	async indexWorkspace(request: ForgeIndexRequest, token: CancellationToken): Promise<ForgeIndexStatus> {
		if (token.isCancellationRequested) {
			return this._indexStatus;
		}

		this._indexStatus.status = 'indexing';
		this._indexStatus.workspaceId = request.workspaceId;

		try {
			const index = await this.loadIndex(request.workspaceId);
			const roots = request.roots.map(root => URI.file(root));
			const exclude = request.excludeGlobs ?? [];

			const files = await this.collectFiles(roots, exclude, token);
			this._indexStatus.pendingFiles = files.length;

			for (const file of files) {
				if (token.isCancellationRequested) {
					break;
				}
				await this.indexFile(index, file, token);
				this._indexStatus.pendingFiles = Math.max(0, (this._indexStatus.pendingFiles ?? 1) - 1);
			}

			await this.saveIndex(index);
			this._indexStatus.status = 'idle';
			this._indexStatus.lastIndexedAt = Date.now();
			return this._indexStatus;
		} catch (error) {
			this.logService.error(`[ForgeAiService] indexing failed: ${getErrorMessage(error)}`);
			this._indexStatus.status = 'error';
			return this._indexStatus;
		}
	}

	async semanticSearch(request: ForgeSearchRequest, token: CancellationToken): Promise<ForgeSearchResponse> {
		const index = await this.loadIndex(request.workspaceId);
		if (!index.chunks.length) {
			return { results: [] };
		}

		const embedding = await this.embed({
			requestId: request.workspaceId,
			inputs: [request.query],
		}, token);

		const queryVector = embedding.vectors[0];
		if (!queryVector?.length) {
			return { results: [] };
		}

		const scored = index.chunks.map(chunk => ({
			chunk,
			score: this.cosineSimilarity(queryVector, chunk.embedding),
		}));

		const maxResults = request.maxResults ?? 5;
		const results = scored
			.filter(entry => Number.isFinite(entry.score))
			.sort((a, b) => b.score - a.score)
			.slice(0, maxResults)
			.map(entry => ({
				path: entry.chunk.path,
				startLine: entry.chunk.startLine,
				endLine: entry.chunk.endLine,
				preview: entry.chunk.text.slice(0, 240),
				score: entry.score,
			}));

		return { results };
	}

	async memoryQuery(request: ForgeMemoryQueryRequest, token: CancellationToken): Promise<ForgeMemoryQueryResponse> {
		return this.postJson<ForgeMemoryQueryResponse>('/v1/memory/query', request, token);
	}

	async memoryWrite(request: ForgeMemoryWriteRequest, token: CancellationToken): Promise<ForgeMemoryWriteResponse> {
		return this.postJson<ForgeMemoryWriteResponse>('/v1/memory/write', request, token);
	}

	async runCommand(request: ForgeRunCommandRequest, token: CancellationToken): Promise<ForgeRunCommandResponse> {
		const allowlist = this.configurationService.getValue<string[]>('forge.tools.commandAllowlist') ?? [];
		const denylist = this.configurationService.getValue<string[]>('forge.tools.commandDenylist') ?? [];

		if (this.matchesAny(request.command, denylist)) {
			throw new Error('Command blocked by Forge policy.');
		}
		if (allowlist.length > 0 && !this.matchesAny(request.command, allowlist)) {
			throw new Error('Command is not in the Forge allowlist.');
		}

		const timeoutMs = request.timeoutMs ?? 120000;
		return this.execCommand(request.command, request.cwd, timeoutMs, token);
	}

	private get apiBaseUrl(): string {
		const configured = this.configurationService.getValue<string>(ForgeConfiguration.apiBaseUrl);
		return this.normalizeBaseUrl(configured);
	}

	private get authToken(): string | undefined {
		const token = this.configurationService.getValue<string>(ForgeConfiguration.apiAuthToken);
		return token?.trim() || undefined;
	}

	private normalizeBaseUrl(baseUrl: string): string {
		const trimmed = (baseUrl || '').trim();
		if (!trimmed) {
			return '';
		}
		return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
	}

	private async postJson<T>(path: string, body: unknown, token: CancellationToken): Promise<T> {
		const requestToken = this.normalizeToken(token);
		const baseUrl = this.apiBaseUrl;
		if (!baseUrl) {
			throw new Error('Forge API base URL is not configured.');
		}

		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};
		const authToken = this.authToken;
		if (authToken) {
			headers.Authorization = `Bearer ${authToken}`;
		}

		const response = await this.requestService.request({
			type: 'POST',
			url: `${baseUrl}${path}`,
			data: JSON.stringify(body),
			headers
		}, requestToken);

		if (!isSuccess(response)) {
			const errorPayload = await this.safeReadError(response);
			const message = errorPayload?.error?.message || errorPayload?.message || `Forge API request failed (${response.res.statusCode})`;
			throw new Error(message);
		}

		const result = await asJson<T>(response);
		if (!result) {
			throw new Error('Forge API returned an empty response.');
		}

		return result;
	}

	private async safeReadError(response: Parameters<typeof asJson>[0]): Promise<ForgeApiError | undefined> {
		try {
			const parsed = await asJson<ForgeApiError>(response);
			return parsed ?? undefined;
		} catch (error) {
			this.logService.debug(`[ForgeAiService] Failed to parse error response: ${getErrorMessage(error)}`);
			return undefined;
		}
	}

	private matchesAny(command: string, patterns: string[]): boolean {
		const normalized = command.toLowerCase();
		return patterns.some(pattern => pattern && normalized.includes(pattern.toLowerCase()));
	}

	private execCommand(command: string, cwd: string | undefined, timeoutMs: number, token: CancellationToken): Promise<ForgeRunCommandResponse> {
		const requestToken = this.normalizeToken(token);
		return new Promise((resolve, reject) => {
			const child = exec(command, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
				const redactedStdout = this.redactSecrets(stdout ?? '');
				const redactedStderr = this.redactSecrets(stderr ?? '');
				if (error) {
					const anyError = error as NodeJS.ErrnoException & { code?: number; killed?: boolean; signal?: string };
					resolve({
						exitCode: typeof anyError.code === 'number' ? anyError.code : null,
						stdout: redactedStdout,
						stderr: redactedStderr || getErrorMessage(error),
						timedOut: anyError.killed === true && anyError.signal === 'SIGTERM',
					});
					return;
				}
				resolve({ exitCode: 0, stdout: redactedStdout, stderr: redactedStderr, timedOut: false });
			});

			const cancelListener = requestToken.onCancellationRequested(() => {
				child.kill('SIGTERM');
			});

			child.on('exit', () => cancelListener.dispose());
		});
	}

	private normalizeToken(token: CancellationToken): CancellationToken {
		return typeof token?.onCancellationRequested === 'function' ? token : CancellationToken.None;
	}

	private redactSecrets(text: string): string {
		const patterns = [
			/-----BEGIN[\s\S]*?PRIVATE KEY-----/gi,
			/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
			/\bghp_[0-9A-Za-z]{36,}\b/g,
			/\b(GITHUB_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY)\s*=\s*['"]?[^'"\s]+/gi,
		];
		return patterns.reduce((acc, pattern) => acc.replace(pattern, '[REDACTED]'), text);
	}

	private async loadIndex(workspaceId: string): Promise<ForgeIndexFile> {
		const cached = this._indexes.get(workspaceId);
		if (cached) {
			return cached;
		}

		const indexPath = this.getIndexPath(workspaceId);
		try {
			const raw = await fs.readFile(indexPath, 'utf8');
			const parsed = JSON.parse(raw) as ForgeIndexFile;
			if (parsed?.workspaceId === workspaceId) {
				this._indexes.set(workspaceId, parsed);
				return parsed;
			}
		} catch {
			// ignore missing or invalid index
		}

		const fresh: ForgeIndexFile = {
			version: 1,
			workspaceId,
			files: {},
			chunks: [],
		};
		this._indexes.set(workspaceId, fresh);
		return fresh;
	}

	private async saveIndex(index: ForgeIndexFile): Promise<void> {
		const indexPath = this.getIndexPath(index.workspaceId);
		await fs.mkdir(path.dirname(indexPath), { recursive: true });
		await fs.writeFile(indexPath, JSON.stringify(index), 'utf8');
	}

	private getIndexPath(workspaceId: string): string {
		return path.join(this.environmentService.userDataPath, 'forge', 'indexes', `${workspaceId}.json`);
	}

	private async collectFiles(roots: URI[], exclude: string[], token: CancellationToken): Promise<URI[]> {
		const results: URI[] = [];
		for (const root of roots) {
			await this.collectFilesInDirectory(root, exclude, results, token);
		}
		return results;
	}

	private async collectFilesInDirectory(dir: URI, exclude: string[], results: URI[], token: CancellationToken): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}

		let stat;
		try {
			stat = await this.fileService.resolve(dir, { resolveMetadata: true });
		} catch {
			return;
		}

		if (!stat.isDirectory || !stat.children) {
			return;
		}

		for (const child of stat.children) {
			if (token.isCancellationRequested) {
				return;
			}
			if (this.shouldIgnorePath(child.resource.fsPath, exclude)) {
				continue;
			}
			if (child.isDirectory) {
				await this.collectFilesInDirectory(child.resource, exclude, results, token);
			} else if (child.isFile) {
				results.push(child.resource);
			}
		}
	}

	private shouldIgnorePath(filePath: string, exclude: string[]): boolean {
		const lowered = filePath.toLowerCase();
		const defaultIgnores = ['node_modules', '.git', 'dist', 'out', 'build', '.vscode', '.venv'];
		if (defaultIgnores.some(segment => lowered.includes(`/${segment}/`) || lowered.endsWith(`/${segment}`))) {
			return true;
		}
		return exclude.some(pattern => pattern && lowered.includes(pattern.toLowerCase()));
	}

	private async indexFile(index: ForgeIndexFile, uri: URI, token: CancellationToken): Promise<void> {
		const content = await this.fileService.readFile(uri);
		const text = content.value.toString();
		if (!text || this.isBinary(text)) {
			return;
		}

		const fileHash = hash(text);
		const filePath = uri.fsPath;
		const previous = index.files[filePath];
		if (previous && previous.hash === fileHash) {
			return;
		}

		index.files[filePath] = { mtime: content.mtime, hash: fileHash };
		index.chunks = index.chunks.filter(chunk => chunk.path !== filePath);

		const chunks = this.chunkText(text);
		for (const chunk of chunks) {
			if (token.isCancellationRequested) {
				return;
			}
			const embedding = await this.embed({
				requestId: `${filePath}:${chunk.startLine}`,
				inputs: [chunk.text],
			}, token);

			if (embedding.vectors[0]) {
				index.chunks.push({
					id: `${filePath}:${chunk.startLine}-${chunk.endLine}`,
					path: filePath,
					startLine: chunk.startLine,
					endLine: chunk.endLine,
					text: chunk.text,
					embedding: embedding.vectors[0],
				});
			}
		}
	}

	private chunkText(text: string): Array<{ startLine: number; endLine: number; text: string }> {
		const lines = text.split(/\r?\n/);
		const chunks: Array<{ startLine: number; endLine: number; text: string }> = [];
		const linesPerChunk = 200;
		for (let i = 0; i < lines.length; i += linesPerChunk) {
			const startLine = i + 1;
			const endLine = Math.min(lines.length, i + linesPerChunk);
			const chunkText = lines.slice(i, endLine).join('\n');
			if (chunkText.trim().length) {
				chunks.push({ startLine, endLine, text: chunkText });
			}
		}
		return chunks;
	}

	private isBinary(text: string): boolean {
		const sample = text.slice(0, 2000);
		return sample.includes('\u0000');
	}

	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length || a.length === 0) {
			return -1;
		}
		let dot = 0;
		let normA = 0;
		let normB = 0;
		for (let i = 0; i < a.length; i++) {
			dot += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}
		if (normA === 0 || normB === 0) {
			return -1;
		}
		return dot / (Math.sqrt(normA) * Math.sqrt(normB));
	}
}
