## Context

Kun already has a typed `views.rightSidebar` contribution, isolated View Sessions, direct Host-owned navigation for right-sidebar Views, extension tools in the Agent catalog, and workspace-scoped extension storage. The aggregate extension launcher encourages full-page/editor placement; the bundled video editor currently follows that older full-page model and also embeds a second private Agent UI inside its Webview.

The desired model is closer to an IDE tool window: an extension declares one right-sidebar View with its own icon, Kun renders that icon beside built-in tools, and the main conversation remains visible while the extension panel opens. The main Agent and panel coordinate through the extension's public tools, workspace state, and bounded events. They do not share React components, DOM, runtime tokens, or private Electron IPC.

## Goals / Non-Goals

**Goals:**

- Give every enabled `views.rightSidebar` contribution a direct, independently selectable Code rail icon and top-level tab.
- Make right-sidebar Views the canonical extension UI shown by the host, with deterministic ordering and normal right-panel resize/collapse behavior.
- Keep the negotiated Extension API v1 manifest compatible for existing non-right View keys while removing the aggregate launcher that advertises them.
- Keep the main Agent visible and able to operate on the same workspace-scoped extension project as the open panel.
- Turn Kun Video Editor into a responsive, docked reference extension with a real packaged icon and no duplicate in-Webview chat surface.

**Non-Goals:**

- Removing non-right View schemas from Extension API v1 or breaking already installed manifests.
- Allowing extension code to mount React into Kun, position arbitrary DOM, control rail geometry, or read main-conversation content.
- Turning MCP, Skills, or appearance plugins into `.kunx` extensions.
- Adding a generic cross-extension state bus or letting one extension invoke another extension's private commands.
- Replacing the existing media, jobs, Agent, tool, trust, permission, or Webview isolation contracts.

## Decisions

### 1. `views.rightSidebar` is the self-registration contract

The workbench will render each visible right-sidebar View as a direct icon in the Code vertical right rail. The launcher uses the manifest icon when valid and a host fallback otherwise; clicking it selects the fully qualified View ID through the tab controller and opens the isolated View in its own Host-owned tab.

The aggregate `ExtensionViewRailLauncher` and its popover will be removed. This avoids a second navigation hierarchy and makes ownership obvious. `views.leftSidebar`, `views.auxiliaryPanel`, `views.editorTab`, and `views.fullPage` remain parseable and invokable for API v1 compatibility, but Kun documentation and bundled examples will no longer present them as the standard extension UI path.

Host-rendered icons use an explicit host-image resource request. The resource protocol accepts that request only when the exact path is declared as an icon in the selected manifest, returns a cross-origin image response for that bounded case, and keeps normal View resources under the existing same-origin policy. The main renderer CSP permits `kun-extension:` only in `img-src`; it does not grant script, frame, or network authority.

An installed version that has not yet been reviewed for the active workspace remains discoverable as an inert locked launcher. The Runtime projects only the localized ID, title, icon, grouping, order, and visibility expression for that launcher; it withholds View entry paths and resource roots. The renderer stores this metadata outside the executable contribution registry, and clicking it invokes Main's protected permission review. Normal `get`, `has`, layout restoration, activation, and View Session creation remain fail-closed until the reviewed grant is persisted. A later explicit permission revocation still removes the runnable entry as before.

Alternative considered: retain a separate puzzle picker or duplicate tool menu. Rejected because it makes users choose an extension twice and duplicates the stable direct rail target.

### 2. The Host continues to own panel geometry

Opening an extension right-sidebar View will expand the existing resizable right panel to at least the host's code-panel preferred width when space allows. The user can resize it within existing constraints and the Host persists the width. Extensions cannot request arbitrary width, overlay the conversation, or force order ahead of protected built-ins.

Alternative considered: add `preferredWidth` to the public manifest. Deferred because it would expand the stable API for a value the Host must clamp anyway; the first reference editor can use the common responsive panel contract.

### 3. Main Agent coordination uses tools plus a workspace active-project pointer

The video extension's registered tools remain the only Agent mutation/read surface. `video-project` supports active-project lookup and selection. Opening or creating a project records a bounded active-project ID in extension workspace storage; active lookup resolves that pointer and returns the current project projection or a clear empty outcome. The Agent profile instructs callers to resolve the active project first, then read its revision and script before editing.

Both manual Webview operations and Agent tool operations use `ProjectService`, optimistic revisions, and the existing `kun-video-editor.project-changed` host message. An open panel refreshes when the main Agent changes its active project. The Webview does not receive main-thread messages or tool calls directly, and the Agent does not receive arbitrary View state.

Alternative considered: expose a renderer context-provider API that injects panel state into every prompt. Rejected because it would increase stable prompt surface, cache churn, and cross-layer authority. The explicit tool call is auditable and revision-safe.

### 4. The video editor becomes one docked, responsive workbench

The manifest moves `editor` from `views.fullPage` to `views.rightSidebar`, adds a packaged local SVG icon, and removes the redundant `open-editor` command and Composer action. `editor-request` remains the authenticated View-to-Host command. The package version advances so the bundled seeder installs a distinct archive rather than replacing bytes under an existing version.

At sidebar widths the Webview uses a single vertical workflow: project controls, player, timeline, media/transcript, inspector, captions/history, preview/export. The embedded private Agent prompt panel is replaced by a compact Agent-sync status panel explaining that the main Kun conversation can use the video tools and showing the active project/revision plus bounded external-change status. The private Agent capability remains available through the public Agent API for compatibility, but it is not the primary visible chat surface.

### 5. Compatibility is behavioral, not a second UI

Existing non-right contributions remain in schemas, registry, commands, View Session routing, and stored-layout cleanup. The Host stops adding a general-purpose launcher for them. A legacy declared command can still open its owned View if the contribution is visible and permitted, but new docs and examples use direct right-sidebar registration exclusively.

This is not marked as an Extension API breaking change because no manifest field or runtime method is removed. It is a workbench navigation and recommendation change.

### 6. One active workspace owns discovery, trust, View activation, and Agent coordination

The renderer derives one extension workspace from the active thread workspace, falling back to the selected project workspace when no thread is active. Contribution discovery, visibility expressions, command invocation, View Session creation, extension storage, and panel rendering all use that same value. This keeps the right-sidebar panel in the same workspace scope as the main Agent instead of combining a global project grant with a conversation-specific Agent session.

When a trusted workspace-scoped View activates a Node Host, Kun supplies both the admitted workspace root and the SDK `workspaceContext` (`id`, `name`, `root`, `trusted`, and `active`). Every later View-to-Host reactivation uses the same context. A View must not be admitted as trusted and then receive an inactive or absent workspace context at runtime.

Alternative considered: make the video extension tolerate an absent workspace context. Rejected because it would weaken the public SDK invariant and hide a Host bug affecting every workspace-aware extension.

### 7. Host appearance state initializes independently from extension data

The video View reads and applies Kun's current theme and locale independently from project, job, and persisted-state requests. A failed runtime-backed request must not discard a successfully returned Host locale or theme. The View subscribes to the existing appearance-change events so a language or theme change in Kun updates the open panel without reopening it, and all visible reference-editor copy has English and Simplified Chinese messages.

Alternative considered: rely on a later locale-change event after initialization fails. Rejected because users may never change the setting again, leaving the View permanently in its fallback language and theme.

### 8. Sandboxed View methods remain aligned across Desktop Host and Kun Runtime

The Desktop Host keeps control of native-only interactions such as file pickers, but every documented guest-safe broker method that it forwards to Kun must also be admitted by the Runtime View policy. In particular, an extension granted `jobs.manage` or the relevant media permission can use the public jobs and brokered-media services from its sandboxed View. Both layers remain fail-closed for credential reveal, registration, and other Node Host-only methods.

Alternative considered: let the bundled video editor omit job restoration until a render begins. Rejected because it would only hide a broken public API contract and would make every third-party View using the documented jobs client fail in the same way.

### 9. Workspace-scoped Hosts, tools, and View events are isolated end to end

An activated extension Host, its registered tools, and its View events are owned by the admitted workspace scope rather than by the extension ID alone. Runtime activation SHALL key workspace-scoped Host state by extension and normalized workspace root, tool discovery and invocation SHALL require the caller's workspace to match that ownership, and View event delivery SHALL match both extension ID and workspace. Activation failure in a second workspace must fail closed; it must never expose or execute a registration left behind by a different workspace.

Alternative considered: keep one global Host and merely hide tools in the renderer. Rejected because background Agent sessions and direct runtime tool execution would still be able to cross workspace boundaries.

### 10. The reference editor proves executable media plans, not only serialized commands

Render plans SHALL use FFmpeg-compatible decimal duration arguments, bounded sequential binding names, and a composition strategy that remains below public argument limits for at least 30 ordinary sequential clips. Canvas fitting/cropping is computed before item transforms so crop plus a sub-unity transform never requests an impossible crop. Focused tests SHALL execute proof, preview, and H.264/AAC export against a discovered FFmpeg installation when the required capabilities are present; missing optional caption filters are reported by capability preflight instead of failing late.

Alternative considered: increase the filter-graph character limit. Rejected because the View-to-Host argument contract is intentionally bounded and oversized process arguments remain platform dependent.

### 11. Transcript ingestion and timeline preview use public bounded media APIs

The public media service gains a bounded UTF-8 text read for an authorized opaque media handle. The editor uses it to import SRT, WebVTT, or transcript JSON selected through the native picker, releases the temporary handle, and shows localized parse or capability errors. The editor's player maps project time through the selected timeline item to the correct source asset and source time, including trim, speed, ordering, and cut boundaries; it previews active captions in the panel. Script Markdown is a read-only deterministic projection rather than a misleading free-form editor.

Alternative considered: ask users to paste transcript contents or asset IDs into JSON. Rejected because that bypasses the native permission model and is not a usable default workflow.

### 12. Manifest localization is a generic Extension API capability

Extension manifests MAY declare bounded locale overlays for extension metadata and contribution copy. Kun resolves the best supported locale for Host-rendered chrome such as rail tooltips, tab titles, Extension Center cards, settings, and result previews; Webview localization remains controlled by the existing appearance API. The mechanism is generic and versioned in the public manifest schema, not special-cased to the bundled video editor.

Alternative considered: translate only the Webview body. Rejected because the panel title and other Host-rendered surfaces would still contradict Kun's selected language.

### 13. Active project changes are authoritative, attributable, and race safe

The workspace active-project pointer is authoritative when a View starts. Agent-originated create, select, or mutation operations publish a workspace-scoped active/project change, and the open panel switches or refreshes accordingly. View loads carry a monotonically increasing generation so late responses cannot restore an older selection. Switching projects releases old leases and clears or filters project-bound script, media, jobs, and artifacts. Undo and redo availability come from the authoritative project projection rather than revision guesses.

The read-only render-status operation remains approval-free; cancellation is a distinct side-effecting tool so polling does not train users to approve destructive authority.

### 14. Release gates drive the real bundled View

The packaged smoke path SHALL open `kun-examples.kun-video-editor` through its real right-sidebar View Session and exercise locale/theme bootstrap, project creation, media/transcript import, edits, proof/export, Agent synchronization, restart recovery, and actionable capability failure. Repository-local example commands SHALL resolve repository tooling explicitly, while standalone documentation SHALL use published package names and clearly state when public registry artifacts are required.

## Risks / Trade-offs

- [A complex editor is cramped in a docked panel] → Open extension panels at a useful Host-owned width, keep resizing, and provide a deliberate single-column responsive layout with bounded scroll regions.
- [Removing the aggregate launcher makes legacy non-right Views less discoverable] → Preserve command-based opening and compatibility, document the migration to `views.rightSidebar`, and keep management diagnostics visible.
- [Agent and panel can race on project revisions] → Keep optimistic `expectedRevision`, active-project lookup, project-change events, and refresh-on-conflict behavior.
- [An active-project pointer can become stale after project deletion or workspace change] → Scope it to extension workspace storage, validate the ID against `ProjectService`, and return an explicit empty/stale outcome without guessing.
- [Multiple extension icons can crowd the rail] → Keep deterministic host ordering, bounded icon metadata, tooltips, and normal overflow policy; do not allow extensions to inject arbitrary rail content.
- [A declared icon path becomes a general Host resource escape] → Mark Host icon requests explicitly, require an exact manifest icon match, and allow the custom scheme only in the main renderer's image CSP.
- [Bundled upgrade revokes workspace trust] → Preserve the existing security rule that a new code version requires workspace review; do not silently carry trust across changed bytes.
- [Contribution discovery and View activation drift into different workspaces] → Derive one active extension workspace in the renderer and use it for every contribution and View operation.
- [A project request fails before appearance initialization completes] → Resolve locale/theme separately, apply each successful Host response, and test failure isolation plus live setting changes.
- [Desktop and Runtime View policies drift] → Cover a forwarded jobs request through the public View Session route while retaining negative credential and registration policy tests.
- [One extension is activated from two workspaces] → Key workspace-scoped Host instances and tool registrations by normalized workspace ownership and filter event delivery by the same scope.
- [FFmpeg versions parse filter arguments differently] → Generate decimal duration arguments and execute representative plans against the detected binary in addition to structural unit tests.
- [Long timelines exceed broker/process bounds] → Use compact labels and a bounded sequential composition path, and retain explicit argument-size assertions.
- [A manifest translation becomes executable or unbounded data] → Restrict locale overlays to known display fields, locale tags, and contribution identifiers already present in the same manifest.
- [Late project responses overwrite a newer selection] → Use load generations and authoritative active-project events; clean project-bound resources on every switch.

## Migration Plan

1. Remove the aggregate launcher from renderer composition while retaining registry and View Session support for all negotiated v1 contribution points.
2. Route direct right-sidebar extension buttons through the existing right-panel selection and widen-on-open behavior.
3. Migrate the video manifest, icon, Host command catalog, active-project tool contract, Agent instructions, and Webview layout; bump and regenerate the deterministic bundled package.
4. Update Chinese/English extension guidance and release/version fixtures.
5. Validate old non-right manifests still parse and command-open, while the bundled video editor appears as a direct rail icon and independent tab and shares revisions with Agent tools.
6. Isolate workspace-scoped Host instances, registered tools, and View events, then add cross-workspace security regressions.
7. Complete the executable video workflow, public bounded transcript read, generic manifest localization, and real packaged View smoke before advancing the bundled package version again.

Rollback is a normal code revert plus selecting the prior installed video-editor version. Registry data and project revisions remain compatible because the project schema does not change.

## Open Questions

None for this change. A future API revision may add explicit rail grouping or panel size hints after multiple third-party extensions provide evidence that Host ordering and responsive layout are insufficient.
