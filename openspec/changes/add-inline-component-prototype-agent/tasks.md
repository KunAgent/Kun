## 1. Runtime Tool And Child Agent

- [x] 1.1 Add the built-in `component-designer` profile with a constrained tool policy and component-only authoring instructions.
- [x] 1.2 Implement the `design_component` provider, bounded input schema, safe artifact reservation, child prompt assembly, progress updates, and structured result.
- [x] 1.3 Validate and harden completed HTML for workspace containment, standalone component markers, offline CSP, forbidden embeds/resources, and size limits.
- [x] 1.4 Register the provider in initial and hot-reloaded main tool catalogs without exposing it to child registries.
- [x] 1.5 Add focused profile/provider tests for advertisement, child invocation, context forwarding, progress, artifact output, and invalid HTML.

## 2. Runtime-to-Renderer Contract

- [x] 2.1 Add renderer contract/types for versioned component prototype metadata.
- [x] 2.2 Map running/final `design_component` tool outputs into stable ToolBlock metadata and status during live SSE and replay.
- [x] 2.3 Derive inline component prototype blocks separately while keeping their tool execution in the collapsible work trace.
- [x] 2.4 Add mapper and turn-section regression tests for running, completed, failed, and replayed results.

## 3. Inline Conversation UI

- [x] 3.1 Build the responsive inline card with the existing hardened HTML preview host and per-card non-persistent partition.
- [x] 3.2 Add preparing/error/ready states, desktop/mobile viewport switching, refresh, code preview, and copy-code behavior.
- [x] 3.3 Wire adopt and iterate actions to prefill the existing Workbench composer without leaving the conversation.
- [x] 3.4 Add localized labels and component tests for payload parsing, viewport behavior, actions, and fallback states.

## 4. Verification And Completion Audit

- [x] 4.1 Run focused Kun and renderer Vitest suites plus `npm run build:kun`.
- [x] 4.2 Run repository `npm run typecheck`, `npm run test`, and `npm run build`; classify unrelated baseline failures.
- [x] 4.3 Run `git diff --check` and audit every proposal/design/task requirement against current files and test evidence.

## 5. Direct Publication And Optional Delegation

- [x] 5.1 Accept complete component HTML in `design_component`, publish it without a child run, and keep the provider available when subagents are disabled.
- [x] 5.2 Add producer metadata with backward-compatible parsing for existing delegated prototype payloads.
- [x] 5.3 Show whether the inline artifact came from Kun directly or the optional design child agent.
- [x] 5.4 Add runtime and renderer regression tests for direct publication, disabled delegation, legacy payloads, and producer labels.
- [x] 5.5 Run focused tests, typecheck/build verification, lint the touched files, and audit the revised change.
