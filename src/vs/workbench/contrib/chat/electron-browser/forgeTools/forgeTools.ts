/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { isAbsolute } from '../../../../../base/common/path.js';
import { isEqualOrParent, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IForgeAiService } from '../../../../../platform/forge/common/forgeAiService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { ISearchService, QueryType } from '../../../../services/search/common/search.js';
import { CountTokensCallback, IToolImpl, IToolData, IToolInvocation, IToolInvocationPreparationContext, IToolResult, ToolDataSource, ToolProgress } from '../../common/tools/languageModelToolsService.js';
import { ILanguageModelToolsService } from '../../common/tools/languageModelToolsService.js';

const MAX_FILE_CHARS = 200000;

export const ForgeReadFileToolId = 'forge_readFile';
export const ForgeListDirectoryToolId = 'forge_listDirectory';
export const ForgeSearchTextToolId = 'forge_searchText';
export const ForgeRunCommandToolId = 'forge_runCommand';

const ForgeReadFileToolData: IToolData = {
	id: ForgeReadFileToolId,
	displayName: 'Read File',
	modelDescription: 'Read the contents of a file from the workspace.',
	source: ToolDataSource.Internal,
	canBeReferencedInPrompt: true,
	toolReferenceName: 'read_file',
	inputSchema: {
		type: 'object',
		properties: {
			filePath: { type: 'string', description: 'Path to the file to read.' }
		},
		required: ['filePath']
	}
};

const ForgeListDirectoryToolData: IToolData = {
	id: ForgeListDirectoryToolId,
	displayName: 'List Directory',
	modelDescription: 'List files and folders within a directory.',
	source: ToolDataSource.Internal,
	canBeReferencedInPrompt: true,
	toolReferenceName: 'list_dir',
	inputSchema: {
		type: 'object',
		properties: {
			path: { type: 'string', description: 'Path to the directory to list.' }
		},
		required: ['path']
	}
};

const ForgeSearchTextToolData: IToolData = {
	id: ForgeSearchTextToolId,
	displayName: 'Search Text',
	modelDescription: 'Search for text in the workspace.',
	source: ToolDataSource.Internal,
	canBeReferencedInPrompt: true,
	toolReferenceName: 'search_text',
	inputSchema: {
		type: 'object',
		properties: {
			query: { type: 'string', description: 'Search query.' },
			maxResults: { type: 'number', description: 'Maximum number of results.' }
		},
		required: ['query']
	}
};

const ForgeRunCommandToolData: IToolData = {
	id: ForgeRunCommandToolId,
	displayName: 'Run Command',
	modelDescription: 'Run a terminal command in the workspace.',
	source: ToolDataSource.Internal,
	canBeReferencedInPrompt: true,
	toolReferenceName: 'run_command',
	inputSchema: {
		type: 'object',
		properties: {
			command: { type: 'string', description: 'Command to execute.' },
			cwd: { type: 'string', description: 'Working directory.' },
			timeoutMs: { type: 'number', description: 'Timeout in milliseconds.' }
		},
		required: ['command']
	}
};

interface ReadFileParams {
	filePath: string;
}

interface ListDirectoryParams {
	path: string;
}

interface SearchTextParams {
	query: string;
	maxResults?: number;
}

interface RunCommandParams {
	command: string;
	cwd?: string;
	timeoutMs?: number;
}

class ForgeReadFileTool implements IToolImpl {
	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IForgeAiService private readonly forgeAiService: IForgeAiService,
	) { }

	async prepareToolInvocation(context: IToolInvocationPreparationContext): Promise<{ confirmationMessages?: { title?: string | MarkdownString; message?: string | MarkdownString } } | undefined> {
		const params = context.parameters as ReadFileParams;
		const target = this.resolvePath(params.filePath);
		if (target && !this.isInsideWorkspace(target)) {
			return {
				confirmationMessages: {
					title: new MarkdownString('Read file outside workspace?'),
					message: new MarkdownString(`The request targets \`${target.fsPath}\`, which is outside the workspace.`),
				}
			};
		}
		return undefined;
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as ReadFileParams;
		const target = this.resolvePath(params.filePath);
		if (!target) {
			throw new Error('Invalid file path.');
		}

		const policy = await this.forgeAiService.policyCheck({
			requestId: invocation.callId,
			action: 'read',
			toolId: ForgeReadFileToolId,
			details: { path: target.fsPath }
		}, token);
		if (!policy.allowed) {
			throw new Error(policy.reason ?? 'Read file blocked by policy.');
		}

		const content = await this.fileService.readFile(target, undefined, token);
		let text = content.value.toString();
		if (text.length > MAX_FILE_CHARS) {
			text = `${text.slice(0, MAX_FILE_CHARS)}\n...[truncated]`;
		}

		return { content: [{ kind: 'text', value: text }] };
	}

	private resolvePath(filePath: string): URI | undefined {
		if (!filePath) {
			return undefined;
		}
		if (filePath.startsWith('file://')) {
			return URI.parse(filePath);
		}
		const root = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!root || isAbsolute(filePath)) {
			return URI.file(filePath);
		}
		return joinPath(root, filePath);
	}

	private isInsideWorkspace(target: URI): boolean {
		return this.workspaceContextService.getWorkspace().folders.some(folder => isEqualOrParent(target, folder.uri));
	}
}

class ForgeListDirectoryTool implements IToolImpl {
	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IForgeAiService private readonly forgeAiService: IForgeAiService,
	) { }

	async prepareToolInvocation(context: IToolInvocationPreparationContext): Promise<{ confirmationMessages?: { title?: string | MarkdownString; message?: string | MarkdownString } } | undefined> {
		const params = context.parameters as ListDirectoryParams;
		const target = this.resolvePath(params.path);
		if (target && !this.isInsideWorkspace(target)) {
			return {
				confirmationMessages: {
					title: new MarkdownString('List directory outside workspace?'),
					message: new MarkdownString(`The request targets \`${target.fsPath}\`, which is outside the workspace.`),
				}
			};
		}
		return undefined;
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as ListDirectoryParams;
		const target = this.resolvePath(params.path);
		if (!target) {
			throw new Error('Invalid directory path.');
		}

		const policy = await this.forgeAiService.policyCheck({
			requestId: invocation.callId,
			action: 'read',
			toolId: ForgeListDirectoryToolId,
			details: { path: target.fsPath }
		}, token);
		if (!policy.allowed) {
			throw new Error(policy.reason ?? 'List directory blocked by policy.');
		}

		const stat = await this.fileService.resolve(target, { resolveMetadata: true });
		if (!stat.isDirectory || !stat.children) {
			throw new Error('Target is not a directory.');
		}

		const entries = stat.children.map(child => `${child.isDirectory ? 'dir ' : 'file'}\t${child.name}`).join('\n');
		return { content: [{ kind: 'text', value: entries }] };
	}

	private resolvePath(dirPath: string): URI | undefined {
		if (!dirPath) {
			return undefined;
		}
		if (dirPath.startsWith('file://')) {
			return URI.parse(dirPath);
		}
		const root = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!root || isAbsolute(dirPath)) {
			return URI.file(dirPath);
		}
		return joinPath(root, dirPath);
	}

	private isInsideWorkspace(target: URI): boolean {
		return this.workspaceContextService.getWorkspace().folders.some(folder => isEqualOrParent(target, folder.uri));
	}
}

class ForgeSearchTextTool implements IToolImpl {
	constructor(
		@ISearchService private readonly searchService: ISearchService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IForgeAiService private readonly forgeAiService: IForgeAiService,
		@ILogService private readonly logService: ILogService,
	) { }

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as SearchTextParams;
		const query = params.query?.trim();
		if (!query) {
			throw new Error('Search query is required.');
		}

		const policy = await this.forgeAiService.policyCheck({
			requestId: invocation.callId,
			action: 'read',
			toolId: ForgeSearchTextToolId,
			details: { query }
		}, token);
		if (!policy.allowed) {
			throw new Error(policy.reason ?? 'Search blocked by policy.');
		}

		const folderQueries = this.workspaceContextService.getWorkspace().folders.map(folder => ({ folder: folder.uri }));
		const result = await this.searchService.textSearch({
			type: QueryType.Text,
			contentPattern: {
				pattern: query,
				isRegExp: false,
				isCaseSensitive: false,
				isWordMatch: false,
			},
			previewOptions: { matchLines: 1, charsPerLine: 200 },
			maxResults: params.maxResults ?? 20,
			folderQueries,
		}, token);

		const lines: string[] = [];
		for (const fileMatch of result.results) {
			if (!fileMatch.results) {
				continue;
			}
			for (const match of fileMatch.results) {
				if ('previewText' in match) {
					lines.push(`${URI.revive(fileMatch.resource).fsPath}:${match.previewText}`);
				}
			}
		}

		if (!lines.length) {
			return { content: [{ kind: 'text', value: 'No matches found.' }] };
		}

		this.logService.debug(`[ForgeSearchTextTool] found ${lines.length} matches`);
		return { content: [{ kind: 'text', value: lines.join('\n') }] };
	}
}

class ForgeRunCommandTool implements IToolImpl {
	constructor(
		@IForgeAiService private readonly forgeAiService: IForgeAiService,
	) { }

	async prepareToolInvocation(context: IToolInvocationPreparationContext): Promise<{ confirmationMessages?: { title?: string | MarkdownString; message?: string | MarkdownString } } | undefined> {
		const params = context.parameters as RunCommandParams;
		return {
			confirmationMessages: {
				title: new MarkdownString('Run a command?'),
				message: new MarkdownString(`Forge will run:\n\n\`${params.command}\``),
			}
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as RunCommandParams;
		const command = params.command?.trim();
		if (!command) {
			throw new Error('Command is required.');
		}

		const policy = await this.forgeAiService.policyCheck({
			requestId: invocation.callId,
			action: 'execute',
			toolId: ForgeRunCommandToolId,
			details: { command, cwd: params.cwd }
		}, token);
		if (!policy.allowed) {
			throw new Error(policy.reason ?? 'Command execution blocked by policy.');
		}

		const result = await this.forgeAiService.runCommand({
			command,
			cwd: params.cwd,
			timeoutMs: params.timeoutMs,
		}, token);

		const output = [
			`Exit code: ${result.exitCode ?? 'unknown'}`,
			result.timedOut ? 'Status: timed out' : 'Status: completed',
			result.stdout ? `STDOUT:\n${result.stdout}` : '',
			result.stderr ? `STDERR:\n${result.stderr}` : '',
		].filter(Boolean).join('\n\n');

		return { content: [{ kind: 'text', value: output }] };
	}
}

export class ForgeToolsContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@ILanguageModelToolsService toolsService: ILanguageModelToolsService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		const readTool = instantiationService.createInstance(ForgeReadFileTool);
		const listTool = instantiationService.createInstance(ForgeListDirectoryTool);
		const searchTool = instantiationService.createInstance(ForgeSearchTextTool);
		const commandTool = instantiationService.createInstance(ForgeRunCommandTool);

		this._register(toolsService.registerTool(ForgeReadFileToolData, readTool));
		this._register(toolsService.registerTool(ForgeListDirectoryToolData, listTool));
		this._register(toolsService.registerTool(ForgeSearchTextToolData, searchTool));
		this._register(toolsService.registerTool(ForgeRunCommandToolData, commandTool));

		this._register(toolsService.readToolSet.addTool(ForgeReadFileToolData));
		this._register(toolsService.readToolSet.addTool(ForgeListDirectoryToolData));
		this._register(toolsService.readToolSet.addTool(ForgeSearchTextToolData));

		this._register(toolsService.executeToolSet.addTool(ForgeRunCommandToolData));

		this._register(toolsService.agentToolSet.addTool(ForgeReadFileToolData));
		this._register(toolsService.agentToolSet.addTool(ForgeListDirectoryToolData));
		this._register(toolsService.agentToolSet.addTool(ForgeSearchTextToolData));
		this._register(toolsService.agentToolSet.addTool(ForgeRunCommandToolData));
	}
}
