/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IForgeAiService } from '../../../../platform/forge/common/forgeAiService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { FileMatch, IAITextQuery, ISearchComplete, ISearchProgressItem, ISearchResultProvider, ITextQuery, SearchProviderType, SearchRange, TextSearchMatch } from '../common/search.js';
import { ISearchService } from '../common/search.js';

class ForgeAiSearchProvider implements ISearchResultProvider {
	constructor(
		@IForgeAiService private readonly forgeAiService: IForgeAiService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService,
	) { }

	async getAIName(): Promise<string | undefined> {
		return 'Forge';
	}

	async textSearch(query: ITextQuery, onProgress?: (p: ISearchProgressItem) => void, token?: CancellationToken): Promise<ISearchComplete> {
		const aiQuery = query as unknown as IAITextQuery;
		const cancellationToken = token ?? CancellationToken.None;
		const workspaceId = this.workspaceContextService.getWorkspace().id;
		const roots = aiQuery.folderQueries.map(folder => URI.revive(folder.folder).fsPath);

		try {
			await this.forgeAiService.indexWorkspace({
				workspaceId,
				roots,
			}, cancellationToken);

			const response = await this.forgeAiService.semanticSearch({
				workspaceId,
				query: aiQuery.contentPattern,
				maxResults: aiQuery.maxResults,
			}, cancellationToken);

			const matchesByFile = new Map<string, FileMatch>();
			for (const result of response.results) {
				const uri = URI.file(result.path);
				const fileMatch = matchesByFile.get(result.path) ?? new FileMatch(uri);
				matchesByFile.set(result.path, fileMatch);

				const startLine = Math.max(0, result.startLine - 1);
				const endLine = Math.max(startLine, result.endLine - 1);
				const range = new SearchRange(startLine, 0, endLine, Math.max(1, result.preview.length));
				const textMatch = new TextSearchMatch(result.preview, range, aiQuery.previewOptions);

				fileMatch.results?.push(textMatch);
				onProgress?.(fileMatch);
			}

			return {
				limitHit: false,
				results: Array.from(matchesByFile.values()),
				messages: [],
			};
		} catch (error) {
			this.logService.error(`[ForgeAiSearchProvider] semantic search failed: ${error}`);
			return {
				limitHit: false,
				results: [],
				messages: [],
			};
		}
	}

	async fileSearch(): Promise<ISearchComplete> {
		return {
			limitHit: false,
			results: [],
			messages: [],
		};
	}

	async clearCache(): Promise<void> {
		// no-op
	}
}

class ForgeAiSearchContribution extends Disposable implements IWorkbenchContribution {
	static readonly Id = 'workbench.contrib.forgeAiSearchProvider';

	constructor(
		@ISearchService searchService: ISearchService,
		@IForgeAiService forgeAiService: IForgeAiService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@ILogService logService: ILogService,
	) {
		super();

		const provider = new ForgeAiSearchProvider(forgeAiService, workspaceContextService, logService);
		this._register(searchService.registerSearchResultProvider(Schemas.file, SearchProviderType.aiText, provider));
	}
}

registerWorkbenchContribution2(ForgeAiSearchContribution.Id, ForgeAiSearchContribution, WorkbenchPhase.AfterRestored);
