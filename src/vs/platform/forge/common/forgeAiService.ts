/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const ForgeAiChannelName = 'forgeAi';

export const IForgeAiService = createDecorator<IForgeAiService>('forgeAiService');

export type ForgeChatRole = 'system' | 'user' | 'assistant';

export interface ForgeChatMessage {
	role: ForgeChatRole;
	content: string;
}

export interface ForgeCompletionRequest {
	requestId: string;
	languageId: string;
	filePath?: string;
	prefix: string;
	suffix: string;
	maxTokens?: number;
	temperature?: number;
}

export interface ForgeCompletionResponse {
	id: string;
	text: string;
	isIncomplete?: boolean;
	modelId?: string;
	usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export interface ForgeChatRequest {
	requestId: string;
	messages: ForgeChatMessage[];
	modelId?: string;
	maxTokens?: number;
	temperature?: number;
	metadata?: Record<string, unknown>;
}

export interface ForgeChatResponse {
	id: string;
	content: string;
	modelId?: string;
	usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export interface ForgeEmbeddingRequest {
	requestId: string;
	inputs: string[];
	modelId?: string;
}

export interface ForgeEmbeddingResponse {
	vectors: number[][];
	modelId?: string;
}

export interface ForgePolicyCheckRequest {
	requestId: string;
	action: 'read' | 'write' | 'execute' | 'network';
	toolId?: string;
	details?: Record<string, unknown>;
}

export interface ForgePolicyDecision {
	allowed: boolean;
	reason?: string;
}

export interface ForgeIndexStatus {
	status: 'idle' | 'indexing' | 'paused' | 'error';
	workspaceId?: string;
	lastIndexedAt?: number;
	pendingFiles?: number;
}

export interface ForgeIndexRequest {
	workspaceId: string;
	roots: string[];
	excludeGlobs?: string[];
}

export interface ForgeSearchRequest {
	workspaceId: string;
	query: string;
	maxResults?: number;
}

export interface ForgeSearchResult {
	path: string;
	startLine: number;
	endLine: number;
	preview: string;
	score: number;
}

export interface ForgeSearchResponse {
	results: ForgeSearchResult[];
}

export interface ForgeRunCommandRequest {
	command: string;
	cwd?: string;
	timeoutMs?: number;
}

export interface ForgeRunCommandResponse {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

export interface IForgeAiService {
	readonly _serviceBrand: undefined;
	complete(request: ForgeCompletionRequest, token: CancellationToken): Promise<ForgeCompletionResponse>;
	chat(request: ForgeChatRequest, token: CancellationToken): Promise<ForgeChatResponse>;
	embed(request: ForgeEmbeddingRequest, token: CancellationToken): Promise<ForgeEmbeddingResponse>;
	policyCheck(request: ForgePolicyCheckRequest, token: CancellationToken): Promise<ForgePolicyDecision>;
	getIndexStatus(): Promise<ForgeIndexStatus>;
	indexWorkspace(request: ForgeIndexRequest, token: CancellationToken): Promise<ForgeIndexStatus>;
	semanticSearch(request: ForgeSearchRequest, token: CancellationToken): Promise<ForgeSearchResponse>;
	runCommand(request: ForgeRunCommandRequest, token: CancellationToken): Promise<ForgeRunCommandResponse>;
}

export class NullForgeAiService implements IForgeAiService {
	_serviceBrand: undefined;

	async complete(_request: ForgeCompletionRequest, _token: CancellationToken): Promise<ForgeCompletionResponse> {
		throw new Error('Forge AI service not available');
	}

	async chat(_request: ForgeChatRequest, _token: CancellationToken): Promise<ForgeChatResponse> {
		throw new Error('Forge AI service not available');
	}

	async embed(_request: ForgeEmbeddingRequest, _token: CancellationToken): Promise<ForgeEmbeddingResponse> {
		throw new Error('Forge AI service not available');
	}

	async policyCheck(_request: ForgePolicyCheckRequest, _token: CancellationToken): Promise<ForgePolicyDecision> {
		return { allowed: false, reason: 'Forge AI service not available' };
	}

	async getIndexStatus(): Promise<ForgeIndexStatus> {
		return { status: 'error' };
	}

	async indexWorkspace(_request: ForgeIndexRequest, _token: CancellationToken): Promise<ForgeIndexStatus> {
		return { status: 'error' };
	}

	async semanticSearch(_request: ForgeSearchRequest, _token: CancellationToken): Promise<ForgeSearchResponse> {
		return { results: [] };
	}

	async runCommand(_request: ForgeRunCommandRequest, _token: CancellationToken): Promise<ForgeRunCommandResponse> {
		return { exitCode: null, stdout: '', stderr: 'Forge AI service not available', timedOut: false };
	}
}
