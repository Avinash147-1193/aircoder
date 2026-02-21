/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { localize } from '../../../../../nls.js';
import { IChatProgress } from '../../common/chatService/chatService.js';
import { ChatMessageRole, getTextResponseFromStream, IChatMessage, IChatMessageToolResultPart, ILanguageModelsService } from '../../common/languageModels.js';
import { IChatAgentHistoryEntry, IChatAgentRequest, IChatAgentResult } from '../../common/participants/chatAgents.js';
import { IChatRequestVariableEntry } from '../../common/attachments/chatVariableEntries.js';
import { IToolData, IToolInvocation, IToolResult, toolContentToA11yString, toolMatchesModel } from '../../common/tools/languageModelToolsService.js';
import { ILanguageModelToolsService } from '../../common/tools/languageModelToolsService.js';
import { ForgeConfiguration } from '../../../../../platform/forge/common/forgeConfiguration.js';
import { ForgeMemoryItem, ForgeMemoryQueryResponse, ForgeSearchResponse, IForgeAiService } from '../../../../../platform/forge/common/forgeAiService.js';

const ForgeAgentExtensionId = new ExtensionIdentifier('forge.ai');

type ForgeToolCall = {
	toolId: string;
	parameters: Record<string, unknown>;
	reason?: string;
};

type ForgePlannerOutput = {
	toolCalls?: ForgeToolCall[];
	final?: string;
};

type ForgeContextBundle = {
	retrieval: string[];
	memory: string[];
	attachments: string[];
};

type ForgeAgentSettings = {
	enableTools: boolean;
	enableRetrieval: boolean;
	enableMemory: boolean;
	planningEnabled: boolean;
	toolAllowlist: string[];
	maxToolCalls: number;
	maxContextItems: number;
	maxMemoryItems: number;
};

type ForgeAgentRequestTelemetry = {
	toolCalls: number;
	retrievalItems: number;
	memoryItems: number;
	planningEnabled: boolean;
	durationMs: number;
};

type ForgeAgentRequestClassification = {
	toolCalls: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth' };
	retrievalItems: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth' };
	memoryItems: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth' };
	planningEnabled: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth' };
	durationMs: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth' };
};

export class ForgeOrchestrator extends Disposable {
	constructor(
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@ILanguageModelToolsService private readonly toolsService: ILanguageModelToolsService,
		@IForgeAiService private readonly forgeAiService: IForgeAiService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async run(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], modelId: string, token: CancellationToken): Promise<IChatAgentResult> {
		const startTime = Date.now();
		const settings = this.getSettings();
		progress([{
			kind: 'progressMessage',
			content: new MarkdownString(localize('forgePreparing', "Preparing request")),
			shimmer: true,
		}]);

		const context = await this.collectContext(request, settings, token);
		const retrievalCount = context.retrieval.length;
		const memoryCount = context.memory.length;
		const messages: IChatMessage[] = this.buildBaseMessages(request, context, history);

		const toolCatalog = settings.enableTools ? this.getToolCatalog(modelId, settings.toolAllowlist) : [];
		let toolCallsExecuted = 0;
		if (settings.enableTools && settings.planningEnabled && toolCatalog.length > 0) {
			const plan = await this.planToolCalls(request, messages, toolCatalog, modelId, token);
			const toolCalls = (plan.toolCalls ?? []).slice(0, settings.maxToolCalls);

			if (!toolCalls.length && plan.final) {
				progress([{
					kind: 'markdownContent',
					content: new MarkdownString(plan.final),
				}]);
				if (settings.enableMemory) {
					await this.writeMemory(request, plan.final, token);
				}
				return {};
			}

			if (toolCalls.length) {
				const toolResults = await this.runToolCalls(toolCalls, request, modelId, progress, settings.toolAllowlist, token);
				toolCallsExecuted = toolResults.length;
				if (toolResults.length) {
					messages.push({ role: ChatMessageRole.Assistant, content: toolResults });
				}
			}
		}

		const responseText = await this.callModel(messages, request, modelId, token);
		progress([{
			kind: 'markdownContent',
			content: new MarkdownString(responseText),
		}]);

		if (settings.enableMemory) {
			await this.writeMemory(request, responseText, token);
		}

		this.logTelemetry({
			toolCalls: toolCallsExecuted,
			retrievalItems: retrievalCount,
			memoryItems: memoryCount,
			planningEnabled: settings.planningEnabled,
			durationMs: Date.now() - startTime,
		});

		return {};
	}

	private logTelemetry(data: ForgeAgentRequestTelemetry): void {
		try {
			this.telemetryService.publicLog2<ForgeAgentRequestTelemetry, ForgeAgentRequestClassification>('forgeAgent.request', data);
		} catch (error) {
			this.logService.debug(`[ForgeOrchestrator] Telemetry failed: ${error}`);
		}
	}

	private getSettings(): ForgeAgentSettings {
		return {
			enableTools: this.configurationService.getValue<boolean>(ForgeConfiguration.agentEnableTools) !== false,
			enableRetrieval: this.configurationService.getValue<boolean>(ForgeConfiguration.agentEnableRetrieval) !== false,
			enableMemory: this.configurationService.getValue<boolean>(ForgeConfiguration.agentEnableMemory) === true,
			planningEnabled: this.configurationService.getValue<boolean>(ForgeConfiguration.agentPlanningEnabled) !== false,
			toolAllowlist: this.configurationService.getValue<string[]>(ForgeConfiguration.agentToolAllowlist) ?? [],
			maxToolCalls: Math.max(0, this.configurationService.getValue<number>(ForgeConfiguration.agentMaxToolCalls) ?? 4),
			maxContextItems: Math.max(0, this.configurationService.getValue<number>(ForgeConfiguration.agentMaxContextItems) ?? 6),
			maxMemoryItems: Math.max(0, this.configurationService.getValue<number>(ForgeConfiguration.agentMaxMemoryItems) ?? 5),
		};
	}

	private buildBaseMessages(request: IChatAgentRequest, context: ForgeContextBundle, history: IChatAgentHistoryEntry[]): IChatMessage[] {
		const systemLines: string[] = [
			'You are Forge, an AI coding assistant.',
			'Respond concisely and prioritize correctness.',
		];
		if (context.attachments.length) {
			systemLines.push('', 'Attachments:', ...context.attachments.map(item => `- ${item}`));
		}
		if (context.retrieval.length) {
			systemLines.push('', 'Retrieved context:', ...context.retrieval.map(item => `- ${item}`));
		}
		if (context.memory.length) {
			systemLines.push('', 'Relevant memory:', ...context.memory.map(item => `- ${item}`));
		}
		if (request.hooks) {
			systemLines.push('', 'Hooks are available for this request.');
		}

		const messages: IChatMessage[] = [{
			role: ChatMessageRole.System,
			content: [{ type: 'text', value: systemLines.join('\n') }],
		}];

		if (history.length) {
			const recent = history.slice(-4).map(entry => `User: ${entry.request.message}\nAssistant: ${entry.response.map(part => part.kind === 'markdownContent' ? part.content.value : '').join('\n')}`);
			if (recent.length) {
				messages.push({
					role: ChatMessageRole.System,
					content: [{ type: 'text', value: `Recent history:\n${recent.join('\n\n')}` }],
				});
			}
		}

		messages.push({
			role: ChatMessageRole.User,
			content: [{ type: 'text', value: request.message }],
		});

		return messages;
	}

	private async collectContext(request: IChatAgentRequest, settings: ForgeAgentSettings, token: CancellationToken): Promise<ForgeContextBundle> {
		const attachments = this.formatAttachments(request.variables.variables);
		const workspaceId = this.workspaceContextService.getWorkspace().id;

		const retrievalPromise = settings.enableRetrieval
			? this.collectRetrieval(workspaceId, request.message, settings.maxContextItems, token)
			: Promise.resolve([]);
		const memoryPromise = settings.enableMemory
			? this.collectMemory(workspaceId, request.message, settings.maxMemoryItems, token)
			: Promise.resolve([]);

		const [retrieval, memory] = await Promise.all([retrievalPromise, memoryPromise]);
		return { retrieval, memory, attachments };
	}

	private async collectRetrieval(workspaceId: string, query: string, maxResults: number, token: CancellationToken): Promise<string[]> {
		try {
			const roots = this.workspaceContextService.getWorkspace().folders.map(folder => folder.uri.fsPath);
			if (!roots.length || !query.trim()) {
				return [];
			}
			await this.forgeAiService.indexWorkspace({ workspaceId, roots }, token);
			const response: ForgeSearchResponse = await this.forgeAiService.semanticSearch({ workspaceId, query, maxResults }, token);
			return response.results.map(result => `${result.path} (${result.startLine}-${result.endLine}): ${result.preview}`);
		} catch (error) {
			this.logService.debug(`[ForgeOrchestrator] Retrieval failed: ${error}`);
			return [];
		}
	}

	private async collectMemory(workspaceId: string, query: string, maxResults: number, token: CancellationToken): Promise<string[]> {
		if (!query.trim()) {
			return [];
		}
		try {
			const response: ForgeMemoryQueryResponse = await this.forgeAiService.memoryQuery({ workspaceId, query, maxResults }, token);
			return response.items.map(item => item.content);
		} catch (error) {
			this.logService.debug(`[ForgeOrchestrator] Memory query failed: ${error}`);
			return this.readLocalMemory(workspaceId, query, maxResults);
		}
	}

	private readLocalMemory(workspaceId: string, query: string, maxResults: number): string[] {
		const key = this.getMemoryStorageKey(workspaceId);
		const raw = this.storageService.get(key, StorageScope.WORKSPACE, '[]');
		const items = this.parseMemoryItems(raw);
		const normalized = query.toLowerCase();
		return items
			.filter(item => item.content.toLowerCase().includes(normalized))
			.sort((a, b) => (b.lastAccessedAt ?? b.createdAt) - (a.lastAccessedAt ?? a.createdAt))
			.slice(0, maxResults)
			.map(item => item.content);
	}

	private async writeMemory(request: IChatAgentRequest, responseText: string, token: CancellationToken): Promise<void> {
		const workspaceId = this.workspaceContextService.getWorkspace().id;
		const content = this.buildMemoryContent(request.message, responseText);
		const item: ForgeMemoryItem = { id: generateUuid(), content, createdAt: Date.now() };

		try {
			await this.forgeAiService.memoryWrite({ workspaceId, items: [item] }, token);
		} catch (error) {
			this.logService.debug(`[ForgeOrchestrator] Memory write failed: ${error}`);
			this.writeLocalMemory(workspaceId, item);
		}
	}

	private writeLocalMemory(workspaceId: string, item: ForgeMemoryItem): void {
		const key = this.getMemoryStorageKey(workspaceId);
		const raw = this.storageService.get(key, StorageScope.WORKSPACE, '[]');
		const items = this.parseMemoryItems(raw);
		items.unshift(item);
		const trimmed = items.slice(0, 200);
		this.storageService.store(key, JSON.stringify(trimmed), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private getMemoryStorageKey(workspaceId: string): string {
		return `forge.agent.memory.${workspaceId}`;
	}

	private parseMemoryItems(raw: string): ForgeMemoryItem[] {
		try {
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				return [];
			}
			return parsed.filter((item): item is ForgeMemoryItem => Boolean(item?.content && item?.id));
		} catch {
			return [];
		}
	}

	private buildMemoryContent(prompt: string, responseText: string): string {
		const trimmedPrompt = prompt.trim().slice(0, 500);
		const trimmedResponse = responseText.trim().slice(0, 800);
		return `Q: ${trimmedPrompt}\nA: ${trimmedResponse}`;
	}

	private formatAttachments(entries: readonly IChatRequestVariableEntry[]): string[] {
		return entries.map(entry => {
			const uri = IChatRequestVariableEntry.toUri(entry);
			const label = entry.name ?? entry.kind;
			if (uri) {
				return `${label}: ${uri.fsPath}`;
			}
			if (typeof entry.value === 'string') {
				return `${label}: ${entry.value}`;
			}
			return label;
		});
	}

	private getToolCatalog(modelId: string, allowlist: string[]): IToolData[] {
		const model = this.languageModelsService.lookupLanguageModel(modelId);
		const allowed = new Set(allowlist.map(id => id.trim()).filter(Boolean));
		return Array.from(this.toolsService.getAllToolsIncludingDisabled())
			.filter(tool => allowlist.length === 0 || allowed.has(tool.id))
			.filter(tool => toolMatchesModel(tool, model));
	}

	private async planToolCalls(request: IChatAgentRequest, messages: IChatMessage[], tools: IToolData[], modelId: string, token: CancellationToken): Promise<ForgePlannerOutput> {
		const toolDescriptions = tools.map(tool => ({
			id: tool.id,
			name: tool.toolReferenceName ?? tool.displayName,
			description: tool.modelDescription,
			inputSchema: tool.inputSchema,
		}));

		const planPrompt = [
			'You are a planning agent for Forge.',
			'Decide if tools are needed. If yes, return JSON with toolCalls.',
			'JSON schema: {"toolCalls":[{"toolId":"forge_readFile","parameters":{...},"reason":"..."}],"final":"optional response if no tools are needed"}',
			'Only return JSON. Do not wrap in markdown.',
			`Tools: ${JSON.stringify(toolDescriptions)}`,
		].join('\n');

		const planMessages: IChatMessage[] = [
			{ role: ChatMessageRole.System, content: [{ type: 'text', value: planPrompt }] },
			...messages,
		];

		const responseText = await this.callModel(planMessages, request, modelId, token);
		const parsed = this.parsePlannerOutput(responseText);
		if (parsed) {
			return parsed;
		}

		return {};
	}

	private parsePlannerOutput(text: string): ForgePlannerOutput | undefined {
		const candidate = this.extractJson(text);
		if (!candidate) {
			return undefined;
		}
		try {
			const parsed = JSON.parse(candidate) as ForgePlannerOutput;
			if (parsed && (parsed.toolCalls || parsed.final)) {
				return parsed;
			}
		} catch (error) {
			this.logService.debug(`[ForgeOrchestrator] Failed to parse planner JSON: ${error}`);
		}
		return undefined;
	}

	private extractJson(text: string): string | undefined {
		const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
		if (fenced?.[1]) {
			return fenced[1].trim();
		}

		const start = text.indexOf('{');
		const end = text.lastIndexOf('}');
		if (start >= 0 && end > start) {
			return text.slice(start, end + 1);
		}
		return undefined;
	}

	private async runToolCalls(toolCalls: ForgeToolCall[], request: IChatAgentRequest, modelId: string, progress: (parts: IChatProgress[]) => void, allowlist: string[], token: CancellationToken): Promise<IChatMessageToolResultPart[]> {
		const results: IChatMessageToolResultPart[] = [];
		const allowed = new Set(allowlist.map(id => id.trim()).filter(Boolean));
		for (const call of toolCalls) {
			const tool = this.resolveTool(call);
			if (!tool) {
				this.logService.warn(`[ForgeOrchestrator] Unknown tool requested: ${call.toolId}`);
				continue;
			}
			if (allowlist.length > 0 && !allowed.has(tool.id)) {
				this.logService.warn(`[ForgeOrchestrator] Tool blocked by allowlist: ${tool.id}`);
				continue;
			}

			progress([{
				kind: 'progressMessage',
				content: new MarkdownString(localize('forgeRunningTool', "Running tool: {0}", tool.displayName)),
				shimmer: true,
			}]);

			const callId = generateUuid();
			const invocation: IToolInvocation = {
				callId,
				toolId: tool.id,
				parameters: call.parameters,
				context: { sessionResource: request.sessionResource },
				chatRequestId: request.requestId,
				modelId,
			};

			try {
				const toolResult = await this.toolsService.invokeTool(
					invocation,
					(input, token) => this.languageModelsService.computeTokenLength(modelId, input, token),
					token
				);
				const content = this.renderToolResult(toolResult);
				results.push({
					type: 'tool_result',
					toolCallId: callId,
					value: [{ type: 'text', value: content }],
				});
			} catch (error) {
				results.push({
					type: 'tool_result',
					toolCallId: callId,
					isError: true,
					value: [{ type: 'text', value: `Tool failed: ${String(error)}` }],
				});
			}
		}
		return results;
	}

	private resolveTool(call: ForgeToolCall): IToolData | undefined {
		const byId = this.toolsService.getTool(call.toolId);
		if (byId) {
			return byId;
		}
		return this.toolsService.getToolByName(call.toolId);
	}

	private renderToolResult(result: IToolResult): string {
		const sections: string[] = [];
		if (result.toolResultMessage) {
			sections.push(typeof result.toolResultMessage === 'string' ? result.toolResultMessage : result.toolResultMessage.value);
		}
		if (result.toolResultError) {
			sections.push(`Error: ${result.toolResultError}`);
		}
		if (result.content?.length) {
			sections.push(toolContentToA11yString(result.content));
		}
		return sections.filter(Boolean).join('\n');
	}

	private async callModel(messages: IChatMessage[], request: IChatAgentRequest, modelId: string, token: CancellationToken): Promise<string> {
		const response = await this.languageModelsService.sendChatRequest(
			modelId,
			ForgeAgentExtensionId,
			messages,
			{
				requestId: request.requestId,
				location: request.location,
				mode: request.modeInstructions?.name,
			},
			token
		);

		return getTextResponseFromStream(response);
	}
}
