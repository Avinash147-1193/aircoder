# Forge Implementation Notes

This document explains the current Forge integration, what changed, why it changed, and how to extend the system going forward. It reflects the implementation done in the Code-OSS fork located at `aircoder` plus the `forge-backend` Node/TypeScript scaffold.

## Executive summary
- **Forge is wired into Code-OSS core** as a shared-process AI service with IPC, plus workbench-side integrations for chat, inline completions, and AI search.
- **Open VSX is the default extension gallery** and product branding is changed to Forge.
- **A minimal backend** (`forge-backend`) is provided with optional stub mode plus OpenAI/Gemini adapters for chat, completions, embeddings, and policy.
- **Agent, tools, and search are functional** but intentionally minimal; they are designed to be extended.

## What changed and why

### 1) Product branding + Open VSX
**Files**
- `product.json`
- `build/hygiene.ts`
- `resources/linux/code.desktop`
- `resources/linux/code-url-handler.desktop`
- `resources/linux/code.appdata.xml`

**Why**
- Forks must not use Microsoft Marketplace. Open VSX is the standard alternative.
- Branding changes are required for a fork and to avoid VS Code naming conflicts.

**What**
- `product.json` now points to Forge identity and uses the Open VSX gallery.
- Hygiene allows Open VSX endpoints.
- Linux desktop metadata updated to Forge branding.

### 2) Forge shared-process AI service (IPC)
**Files**
- `src/vs/platform/forge/common/forgeAiService.ts`
- `src/vs/platform/forge/node/forgeAiService.ts`
- `src/vs/platform/forge/electron-browser/forgeAiService.ts`
- `src/vs/code/electron-utility/sharedProcess/sharedProcessMain.ts`
- `src/vs/platform/forge/common/forgeConfiguration.ts`
- `src/vs/workbench/workbench.common.main.ts`
- `src/vs/workbench/workbench.desktop.main.ts`
- `src/vs/workbench/workbench.web.main.ts`

**Why**
- Heavy AI work (indexing, IO, networking) should live off the UI thread.
- Shared process is the standard Code-OSS pattern for background services.

**What**
- `IForgeAiService` defines the core API: chat, completions, embeddings, policy checks, indexing, semantic search, and command execution.
- The shared-process implementation (`forgeAiService.ts`) calls the backend and manages a local JSON index for semantic search.
- Renderer uses a shared-process remote stub to call this service.
- Configuration keys live under the `forge.*` namespace.

### 3) Forge language model provider + core agent
**Files**
- `src/vs/workbench/contrib/chat/browser/forge/forgeLanguageModelProvider.ts`
- `src/vs/workbench/contrib/chat/browser/forge/forgeAgent.ts`
- `src/vs/workbench/contrib/chat/browser/forge/forge.contribution.ts`
- `src/vs/workbench/contrib/chat/browser/chat.contribution.ts`

**Why**
- Code-OSS chat/agent flows require a registered model provider and a default agent.

**What**
- Forge provider registers a default model (`forge.default`).
- Forge agent is a minimal implementation that forwards chat requests to the model.
- Core commands are registered as stubs so UX flows do not error.

### 4) Inline completions
**Files**
- `src/vs/workbench/contrib/inlineCompletions/browser/forgeInlineCompletionsProvider.ts`
- `src/vs/workbench/contrib/inlineCompletions/browser/forgeInlineCompletions.contribution.ts`
- `src/vs/workbench/contrib/inlineCompletions/browser/inlineCompletions.contribution.ts`

**Why**
- Tab autocomplete needs a native inline-completions provider.

**What**
- The provider collects context around the cursor and calls Forge completions.
- Registered via a workbench contribution.

### 5) Indexing + semantic search
**Files**
- `src/vs/platform/forge/node/forgeAiService.ts`
- `src/vs/workbench/services/search/electron-browser/forgeAiSearchProvider.ts`
- `src/vs/workbench/workbench.desktop.main.ts`

**Why**
- Semantic search should plug into the existing Search view (`aiText` providers).

**What**
- A simple per-workspace index is stored under user data (JSON).
- `aiText` search results are surfaced in the Search view.

### 6) Tools + guardrails
**Files**
- `src/vs/workbench/contrib/chat/electron-browser/forgeTools/forgeTools.ts`
- `src/vs/workbench/contrib/chat/electron-browser/chat.contribution.ts`
- `src/vs/platform/forge/common/forgeConfiguration.ts`
- `src/vs/platform/forge/node/forgeAiService.ts`

**Why**
- Agent tools must be gated and auditable.

**What**
- Tools: read file, list directory, search text, run command.
- Command tool requires user confirmation and respects allow/deny lists.
- Output is redacted for common secrets.

### 7) Backend scaffold
**Files**
- `forge-backend/src/index.ts`
- `forge-backend/tsconfig.json`
- `forge-backend/.env.example`
- `forge-backend/README.md`

**Why**
- A backend is needed for auth, model routing, embeddings, and policy.

**What**
- Endpoints for `/v1/chat`, `/v1/completions`, `/v1/embeddings`, and `/v1/policy/check`.
- Optional stub mode (`FORGE_STUB_MODE=true`) for local development.
- OpenAI/Gemini adapters when API keys are set.

## Configuration defaults
Settings are registered in `src/vs/platform/forge/common/forgeConfiguration.ts`:
- `forge.api.baseUrl` (default `http://localhost:8787`)
- `forge.api.authToken`
- `forge.tools.commandAllowlist`
- `forge.tools.commandDenylist`

## Agent lifecycle: how agents are created
The Forge agent is a core workbench contribution, not an external extension.

**Key files**
- `product.json` sets `defaultChatAgent` (IDs, provider names, commands).
- `src/vs/workbench/contrib/chat/browser/forge/forge.contribution.ts` registers:
  - the Forge language model provider
  - the `forge` agent (default agent for Chat/Inline/Notebook/Terminal)
- `src/vs/workbench/contrib/chat/browser/forge/forgeAgent.ts` implements the agent behavior.
- `src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupContributions.ts` registers setup agents used during onboarding.
- `src/vs/workbench/contrib/chat/common/chatService/chatServiceImpl.ts` activates the default agent and dispatches requests.
- `src/vs/workbench/contrib/chat/common/requestParser/chatRequestParser.ts` resolves `@agent` names to registered agents.

**Flow**
1. Workbench starts and registers the Forge agent and model provider.
2. `ChatServiceImpl` activates the default agent for the current chat location.
3. The request parser resolves `@forge` (or other agents) into an agent ID.
4. `ChatAgentService` invokes the agent implementation.

## How to extend agents
### A) Add a new agent
1. Implement `IChatAgentImplementation` (similar to `forgeAgent.ts`).
2. Register it in a workbench contribution:
   - `chatAgentService.registerAgent(...)`
   - `chatAgentService.registerAgentImplementation(...)`
3. Set `modes` and `locations` so the agent is eligible in Chat/Inline/Notebook/Terminal.
4. If it should be default, set `isDefault: true` and update `product.json` if needed.

### B) Enhance an agent (Cursor-style behavior)
1. Add a planning loop in `ForgeAgent.invoke()`.
2. Orchestrate tools via `ILanguageModelToolsService`.
3. Use `IChatEditingService` to apply patches.
4. Include attachments/context (files, selections, diagnostics) in the prompt.

## How to run (dev)

### Backend
```bash
cd /Users/avinash/Codebase/Self/forge-backend
cp .env.example .env
npm install
npm run dev
```

### Editor (desktop)
```bash
cd /Users/avinash/Codebase/Self/aircoder
npm install
./scripts/code.sh
```
On Windows, use:
```bat
.\scripts\code.bat
```

## Extension points: how to extend and improve

### A) Make the agent better
**Where to start**
- `src/vs/workbench/contrib/chat/browser/forge/forgeAgent.ts`

**What to add**
- Planning loop: plan -> retrieve -> propose edits -> run checks -> summarize.
- Tool orchestration via `ILanguageModelToolsService`.
- Patch application via `IChatEditingService`.

**Suggested approach**
1. Build a planning prompt in `ForgeAgent.invoke()`.
2. Use tools via `ILanguageModelToolsService` (read/search/run).
3. Produce patch output and apply with chat editing services.

### B) Add or swap model providers
**Where**
- `src/vs/workbench/contrib/chat/browser/forge/forgeLanguageModelProvider.ts`
- `src/vs/platform/forge/node/forgeAiService.ts`
- `forge-backend/src/index.ts`

**How**
- Extend `ForgeLanguageModelProvider` to return multiple models from backend.
- Add model metadata (tokens, capabilities, picker category).
- Implement real model adapters in `forge-backend` (`/v1/chat`, `/v1/completions`, `/v1/embeddings`).

### C) Improve inline completions quality
**Where**
- `src/vs/workbench/contrib/inlineCompletions/browser/forgeInlineCompletionsProvider.ts`

**How**
- Improve context slicing (symbols, diagnostics, recent edits).
- Stream completions when backend supports it.
- Add caching and debounce tuning.

### D) Replace the indexer with a real vector store
**Where**
- `src/vs/platform/forge/node/forgeAiService.ts`

**How**
- Swap JSON index for SQLite + vector extension (sqlite-vss or similar).
- Add file watcher for incremental updates.
- Implement AST-based chunking.

### E) Expand tools and approvals
**Where**
- `src/vs/workbench/contrib/chat/electron-browser/forgeTools/forgeTools.ts`
- `src/vs/platform/forge/node/forgeAiService.ts`

**How**
- Add new tool definitions with `ILanguageModelToolsService`.
- Add custom confirmations in `ILanguageModelToolsConfirmationService`.
- Extend policy enforcement in `forgeAiService.policyCheck()`.

### F) Harden policy and security
**Where**
- `forge-backend/src/index.ts`
- `src/vs/platform/forge/node/forgeAiService.ts`

**How**
- Implement policy service server-side and return real decisions.
- Add server-side secret redaction and audit logging.

## Known limitations (current state)
- Indexer is JSON-based and does not use SQLite/vector store yet.
- Forge agent is minimal and does not implement planning or patch application.
- Backend adapters are basic (no streaming/tool-calls/auth hardening by default).

## Next recommended steps
1. Add streaming and tool-call support in the backend.
2. Add AST chunker + SQLite vector store.
3. Extend `ForgeAgent` to use tools + apply patches.
4. Add telemetry and usage metering.
