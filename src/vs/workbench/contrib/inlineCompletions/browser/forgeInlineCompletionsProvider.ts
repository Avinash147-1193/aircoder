/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { Schemas } from '../../../../base/common/network.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { InlineCompletions, InlineCompletionsProvider, InlineCompletionContext } from '../../../../editor/common/languages.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IForgeAiService } from '../../../../platform/forge/common/forgeAiService.js';

const MAX_CONTEXT_LINES = 200;
const MAX_CONTEXT_CHARS = 8000;

export class ForgeInlineCompletionsProvider implements InlineCompletionsProvider {
	public readonly groupId = 'forge.inline';
	public readonly displayName = 'Forge';
	public readonly debounceDelayMs = 75;

	constructor(
		@IForgeAiService private readonly forgeAiService: IForgeAiService,
		@ILogService private readonly logService: ILogService,
	) { }

	async provideInlineCompletions(model: ITextModel, position: Position, _context: InlineCompletionContext, token: CancellationToken): Promise<InlineCompletions> {
		if (token.isCancellationRequested) {
			return { items: [] };
		}

		const { prefix, suffix, filePath } = this.extractContext(model, position);
		if (!prefix && !suffix) {
			return { items: [] };
		}

		try {
			const response = await this.forgeAiService.complete({
				requestId: generateUuid(),
				languageId: model.getLanguageId(),
				filePath,
				prefix,
				suffix,
				maxTokens: 256,
				temperature: 0.2,
			}, token);

			const insertText = this.normalizeInsertText(model, position, response.text);
			if (!insertText) {
				return { items: [] };
			}

			return {
				items: [{
					insertText,
					range: this.createRange(model, position, insertText),
				}]
			};
		} catch (error) {
			this.logService.debug(`[ForgeInlineCompletions] request failed: ${error}`);
			return { items: [] };
		}
	}

	disposeInlineCompletions(_completions: InlineCompletions): void {
		// no-op
	}

	private extractContext(model: ITextModel, position: Position): { prefix: string; suffix: string; filePath?: string } {
		const startLine = Math.max(1, position.lineNumber - MAX_CONTEXT_LINES);
		const endLine = Math.min(model.getLineCount(), position.lineNumber + MAX_CONTEXT_LINES);
		const range = new Range(startLine, 1, endLine, model.getLineMaxColumn(endLine));

		const windowText = model.getValueInRange(range);
		const windowOffset = model.getOffsetAt(position) - model.getOffsetAt(new Position(startLine, 1));
		const rawPrefix = windowText.slice(0, windowOffset);
		const rawSuffix = windowText.slice(windowOffset);

		const prefix = rawPrefix.slice(Math.max(0, rawPrefix.length - MAX_CONTEXT_CHARS));
		const suffix = rawSuffix.slice(0, MAX_CONTEXT_CHARS);

		const filePath = model.uri.scheme === Schemas.file ? model.uri.fsPath : undefined;
		return { prefix, suffix, filePath };
	}

	private createRange(model: ITextModel, position: Position, insertText: string): Range {
		const endColumn = insertText.includes('\n') ? model.getLineMaxColumn(position.lineNumber) : position.column;
		return new Range(position.lineNumber, position.column, position.lineNumber, endColumn);
	}

	private normalizeInsertText(model: ITextModel, position: Position, rawText: string | undefined): string | undefined {
		const text = (rawText ?? '').trimEnd();
		if (!text) {
			return undefined;
		}

		const lineSuffix = model.getLineContent(position.lineNumber).slice(position.column - 1);
		if (!lineSuffix) {
			return text;
		}

		if (text.startsWith(lineSuffix)) {
			return text;
		}

		return lineSuffix + text;
	}
}
