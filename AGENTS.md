# DeepSeek-GUI Agent Guide

This guide is for AI agents working in this repository. It collects the project facts, recurring pitfalls, and validation paths that should be checked before making changes.

## Project Boundaries

- This is an `Electron + React + TypeScript` desktop app. The product name is `Kun`; the top-level build entries are `package.json`, `electron.vite.config.ts`, and `electron-builder.config.cjs`.
- The only active agent runtime is the bundled `kun/` TypeScript package. The GUI talks to `kun serve` over local `HTTP + SSE`; the renderer does not run the agent loop directly.
- The main data path is `Renderer -> preload -> main -> Kun runtime`:
  - `src/renderer/src`: React workbench, Code/Write/Connect phone UI, and Zustand state.
  - `src/preload`: the constrained IPC bridge exposed to the renderer as `window.kunGui`.
  - `src/main`: Electron main process, windows, system services, settings, runtime host, and IPC handlers.
  - `src/shared`: cross-layer types, settings normalizers, and provider contracts.
  - `kun/`: `kun serve`, HTTP routes, thread/session stores, tool execution, model adapters, agent loop, cache, and usage tracking.
- The single-runtime plan and the legacy surfaces that must stay removed are documented in `docs/AGENTS.md` and `docs/kun-architecture.md`. Read both before changing runtime, agent selector, diagnostics, or legacy provider behavior.

## Code Organization

- Put new UI interactions in `src/renderer/src`, Electron/system integration in `src/main`, cross-layer contracts in `src/shared`, and agent runtime behavior in `kun/src`.
- For new IPC or runtime APIs, define the shared schema/types first, then wire preload bridge, main handler/runtime adapter, and renderer consumer.
- For runtime HTTP/SSE issues, start with:
  - `src/main/runtime/kun-adapter.ts`
  - `src/main/runtime-sse-ipc.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/agent/kun-runtime.ts`
  - `src/renderer/src/agent/kun-mapper.ts`
  - `kun/src/server/runtime-factory.ts`
  - `kun/src/server/routes/`
- Do not recreate old runtime paths, provider switchers, runtime diagnostics panels, CodeWhale/Reasonix adapters, process managers, or RPC bridges. Legacy provider fields should only be read during settings migration and folded into `agents.kun`.
- Connect phone code may still use the internal `claw` name for compatibility. That name does not mean there should be a separate Claw runtime.

## Providers And Model Requests

- Endpoint behavior is a shared contract, not a local detail of one caller. When changing `baseUrl`, `endpointFormat`, request bodies, or provider presets, inspect all relevant consumers:
  - `src/shared/openai-compat-url.ts`
  - `src/shared/app-settings-provider.ts`
  - `src/shared/app-settings-kun.ts`
  - `src/main/upstream-models.ts`
  - `src/main/provider-connection.ts`
  - `src/main/services/write-inline-completion-service.ts`
  - `src/main/claw-scheduled-task-detector.ts`
  - `kun/src/adapters/model/deepseek-compat-model-client.ts`
  - `kun/src/loop/agent-loop.ts`
- Blank `baseUrl` values fall back to `DEFAULT_DEEPSEEK_BASE_URL = https://api.deepseek.com`. Keep URL path appending separate from JSON body fields when explaining or changing request behavior.
- Supported endpoint families include OpenAI chat completions, Anthropic messages, and OpenAI responses compatibility modes. `endpointFormat` affects URL construction, headers, request body shape, stream parsing, usage parsing, and reasoning fields.
- A custom full endpoint path is an explicit mode. Do not guess that the user-provided URL should receive another appended path.
- For model request 404s, user-facing guidance should point at provider configuration, especially Base URL and Endpoint format. Kun logs should include sanitized `baseUrl`, final `requestUrl`, provider, model, `endpointFormat`, HTTP status, and a summarized response body.
- Write inline completion, plan/scheduled-task detection, model listing, provider probing, and the main chat loop can use different request bodies. Do not inspect only the chat path and then generalize to every model request.

## Kun Runtime Notes

- `kun/src/server/runtime-factory.ts` is the runtime composition root. In production serve mode, the event bus, thread/session stores, and runtime event recorder are wired there.
- `RuntimeEventRecorder`, `FileSessionStore`, and `InMemoryEventBus` are the key paths for event persistence, SSE replay, and memory investigation. For OOM or event growth issues, inspect in-memory arrays, `events.jsonl`, `highestSeq()`, and replay behavior together.
- The agent loop is in `kun/src/loop/agent-loop.ts`. Tool calls, approvals, user input, plan/goal handling, model-history repair, usage, and cache accounting can all pass through it.
- The GUI HTTP surface is broader than chat: thread list/search/archive, fork, resume-thread, approvals, user-inputs, usage, and workspace status all need to remain equivalent when runtime code is changed.
- Cache efficiency depends on a stable system prefix, canonical tool schemas, valid tool-call/tool-result history, and provider-native cache hit/miss usage fields. Dynamic workspace data, timestamps, file snippets, and selected text must not be placed in the stable prefix.

## Renderer And UX Notes

- Settings -> Agents should show only Kun configuration. Do not restore the agent switcher, connection status bar, runtime diagnostics dialog, runtime insights panel, or `/usage` and `/runtime` runtime-control commands.
- For local icons, badges, and model capability labels, trace the real renderer data flow instead of changing only the visible label. Retina blur, badge wrapping, and long model names need actual layout validation.
- Image and attachment paths must be propagated from renderer to Kun through contract fields such as `localFilePath` / `FilePath`. Appending a path only in final text is usually insufficient; check renderer, main bridge, attachment store, agent loop, and model fallback.
- The current bridge name is `window.kunGui`. Do not use the old `window.dsGui` name.

## Development And Validation

- Install dependencies: `npm ci`
- Start development app: `npm run dev`
- Typecheck: `npm run typecheck`
- Unit tests: `npm run test`
- Build: `npm run build`
- Lint: `npm run lint`
- Changes under `kun/` should pass `npm run build:kun`; top-level `dev` and `build` both run it first.
- Before committing, run the smallest checks that cover the change. Cross-layer contracts, runtime behavior, settings, providers, and packaging changes usually need `npm run typecheck`, relevant `vitest` coverage, and `npm run build`.
- If a check fails, separate newly introduced failures from existing baseline failures. Do not silently treat unrelated baseline failures as passing.
- Documentation-only changes should at least pass `git diff --check`.

## Packaging And Local App Testing

- General packaging entry: `npm run dist`
- macOS:
  - `npm run dist:mac`
  - `npm run dist:mac:arm64`
  - `npm run dist:mac:x64`
  - `npm run dist:mac:signed`
- Windows: `npm run dist:win`
- Linux: `npm run dist:linux`
- Packaging configuration lives in `electron-builder.config.cjs`, release scripts live in `scripts/`, and the release workflow lives in `.github/workflows/release.yml`.
- For local macOS arm64 testing, unzip `dist/Kun-0.1.0-mac-arm64.zip` after packaging and test the extracted app, usually at `dist/Kun-0.1.0-mac-arm64-unzipped/Kun.app`.
- Before a new packaged-app test, make sure old `Kun.app` processes have exited. Multiple worktree builds share the same bundle identifier, so macOS may reuse an old instance.
- Startup debugging should not rely on a single port check. Combine the real process path, `open -n <Kun.app>`, `lsof -iTCP:18787,18788,18899`, `curl http://127.0.0.1:18899/health`, and `~/Library/Application Support/Kun/logs/kun-*.log`.
- Port `18787` may be occupied by a non-Kun process. Keep it separate from Kun runtime/health ports such as `18788` and `18899`.

## Git And Pull Requests

- Start with `git status --short --branch`. If the checkout is detached, create a named branch before committing.
- For feature fixes, sync to the latest `upstream/develop` first when the worktree baseline is suspicious. Old worktree diffs may already be upstream.
- New branches should use the `codex/` prefix, for example `codex/fix-provider-endpoint`.
- Use Angular-style commit messages such as `fix(scope): ...`, `feat(scope): ...`, or `docs(agents): ...`. Keep the title outcome-focused and do not include `[codex]`.
- DeepSeek-GUI/Kun PRs should target `develop` explicitly. Do not rely on the GitHub default branch, and do not accidentally open PRs against `master`.
- Before creating a PR, verify the canonical repository slug and the issue repository. Remote names can be misleading; prefer `gh repo view --json nameWithOwner,defaultBranchRef` or `gh api repos/<owner>/<repo>`.
- PR creation example:

```bash
gh pr create --base develop --head <branch> --title "<title>" --body-file <file>
```

- After creation, immediately verify base, head, and URL with `gh pr view --json baseRefName,headRefName,url`.
- PR bodies should cover `Summary`, `Changes`, and `Tests`. Fix PRs should include `Fixes #...` or a repository-qualified issue reference.
- If the user asks to amend an existing PR, prefer amending/squashing the recent commit and pushing with `git push --force-with-lease` instead of adding noisy follow-up commits.
- If the original PR is already merged or closed, do not try to retarget it. Create a fresh branch from `upstream/develop`, cherry-pick the relevant commit, and open a new PR.

## Common Triage Paths

- Provider URL or request body issue: inspect every model consumer, then list URL and body behavior separately for chat, write-inline, scheduled task detection, model list, and provider probe.
- Settings save/runtime behavior issue: inspect `src/shared/app-settings-provider.ts`, `src/shared/app-settings-kun.ts`, settings store migration, and the renderer settings section.
- SSE/event/OOM issue: inspect `runtime-factory`, `RuntimeEventRecorder`, `FileSessionStore.highestSeq()`, `events.jsonl`, and events route replay.
- `/new`, session resume, fork, archive/search issue: trace the full path from renderer command/store to Kun routes instead of changing only the UI command.
- Clipboard/image fallback issue: inspect `webUtils.getPathForFile`, temporary file persistence, the `localFilePath` contract, attachment store, and model client fallback.
- Packaged app startup issue: first confirm which extracted app owns the active process, then inspect ports `18788`/`18899`, logs, and `open -n`; do not assume the build failed first.

## Repository Hygiene

- Do not commit build artifacts, extracted apps, temporary logs, or local investigation notes.
- Keep changes local to the requested area. Do not reformat the whole repository, reorder unrelated files, or remove existing comments as drive-by cleanup.
- New content should stay ASCII unless the surrounding file or user-facing requirement clearly needs otherwise.
