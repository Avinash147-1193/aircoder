/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Forge. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ForgeInlineCompletionsProvider } from './forgeInlineCompletionsProvider.js';

export class ForgeInlineCompletionsContribution extends Disposable implements IWorkbenchContribution {
	static readonly Id = 'workbench.contrib.forgeInlineCompletions';

	constructor(
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		const provider = this.instantiationService.createInstance(ForgeInlineCompletionsProvider);
		this._register(this.languageFeaturesService.inlineCompletionsProvider.register({ pattern: '**' }, provider));
	}
}

registerWorkbenchContribution2(ForgeInlineCompletionsContribution.Id, ForgeInlineCompletionsContribution, WorkbenchPhase.AfterRestored);
