# Settings UI polish: implementation and coverage

## Scope and boundaries

This change covers the Settings navigation shell, all 23 category destinations,
their nested controls, and settings-origin dialogs. The source baseline is
`9179a656e`. It does not change provider endpoints, stored values, credentials,
permission decisions, account actions, runtime APIs, or save callbacks.

The category inventory comes from `SettingsSidebar.tsx` and
`settings-view-layout.tsx`, rather than a screenshot of the first visible page.
Extensions is available only when contributions exist; Storage is a Windows
destination. A platform cannot therefore display all 23 entries simultaneously
without an explicit fixture.

## Design and implementation decisions

- Native `<button>` elements remain native, with their original callbacks,
  `type`, disabled conditions, and state-dependent content
- Settings-owned action buttons use the typed `settingsButtonClass` factory
  from `settings-button.ts`; visual rules live in `settings-buttons.css`
- Shared components keep their original class names. Their
  `data-settings-action` and `data-settings-size` attributes are styled only
  beneath `.ds-settings-surface`, preserving their appearance outside Settings
- Primary identifies the next meaningful action, such as Save, Add, Import,
  Connect, or Install. Secondary covers supporting operations. Ghost/icon
  controls cover small utilities. Delete, revoke, disconnect, and removal
  actions receive danger styling; cancelling a workflow remains neutral
- Buttons have a 36px default minimum target, a 32px compact minimum target,
  a 36px square icon target, and a 24px inline-icon target for model-chip
  removal. Icons do not shrink, and long action labels
  may wrap instead of clipping
- Selection cards, tabs, switches, color choices, shortcut capture, stepper
  segments, provider/model pickers, and dark code-copy controls keep their
  state-specific appearance. They receive a scoped focus/target baseline
- `SettingRow` associates supported controls with their visible titles and
  descriptions. Existing explicit accessible labels remain authoritative
- Loading actions expose existing busy state through `aria-busy`; disabled
  controls stay disabled. Save feedback is announced politely
- Shared cards and rows use consistent spacing, wrapping, and alignment within
  Settings. Wide controls still occupy their own row; narrow containers stack
  ordinary rows rather than squeezing their inputs
- At narrow widths, the sidebar becomes a grouped native category select using
  the same category data and platform/extension eligibility filters. Full
  category names remain available without forcing a narrow left rail
- The Add Agent wizard and Lucide icon menu render into `document.body`.
  An optional `settingsSurface` prop carries the Settings scope to these
  portals only when opened by a Settings host
- Reduced-motion and forced-colors handling belong to the shared action layer.
  No unqualified `button`, `input`, or theme-wide override is introduced

## Top-level source checklist

Every row below has been traced in source. "Source reviewed" is not a claim
that every account-dependent or platform-dependent state has been exercised.
The native/rendered evidence checklist follows separately.

| Destination | Source and nested surfaces reviewed | Source status |
| --- | --- | --- |
| General | Appearance/font and width steppers, conversation/onboarding, workspace and conversation directories, legacy import/checkpoints, desktop command/behavior/logs, dark color resets | Source reviewed |
| Providers | Provider list and state-driven row actions, connection/model capability panes, add sheet, quick add, model editor/import, external import, import-link confirmation, endpoint detection, icon picker, reliability, routes/gateway, Claude/Codex/Gemini/Grok connection actions | Source reviewed |
| Integrations | Google Workspace connect/setup/test/disconnect/refresh/cancel, operation status, documentation action | Source reviewed |
| Extensions | Conditional `ExtensionDeclarativeSettingsPane`, Retry, dynamic contribution tabs, `DeclarativeSettingsSections` input/select/checkbox/textarea fields | Source reviewed |
| Work | Workspace, typography, suggestions, selection actions, agent presets, paper/search settings, debug log dialog | Source reviewed |
| Design | Code integration, canvas defaults, workspace; shared rows, selects, and toggles rather than local action buttons | Source reviewed |
| Media generation | Image, speech, music, video; shared model/credential controls; local speech model install/remove/cancel and preview | Source reviewed |
| Speech to text | Provider/model/advanced tabs, local Whisper selection/download/cancel/delete, test action | Source reviewed |
| AI assistant | Assistant, permissions/policy/quality, skills, MCP form/raw JSON, project, advanced/runtime, harnesses, collaboration, project defaults and unsaved-draft dialog | Source reviewed |
| Laboratory | Context window, conversation visualization, automatic plan/build, computer permissions, browser, graph, PPT, reference branches, project board, ADE | Source reviewed |
| Subagents | Runtime policy, delegatable catalog/search/category batching/pagination, automatic roles, profile create/edit/capability dialogs and model/reasoning choices | Source reviewed |
| Memory | Overview, records, candidate approval/denial, filters, import/export, create/edit/confirm/correct, disable/restore/delete and record dialogs | Source reviewed |
| Archives | Search/refresh, archive selection, restore/delete and empty states | Source reviewed |
| Storage | Windows relocation controls and confirmation sheet, busy/error states | Source reviewed; platform-gated |
| Data migration | Export/import choices, package inspection, workspace mapping, conflict choices, execution/cancel/progress, reports/resume/rollback/delete | Source reviewed |
| Worktrees | Defaults, shared-path add/remove, refresh, worktree cleanup controls | Source reviewed |
| Shortcuts | Shortcut recording and reset, grouped rows | Source reviewed |
| Appearance | UI plugin activation/color/delete/install, numeric controls | Source reviewed |
| Updates | Check/download/install/open-release states through `settings-gui-update.tsx` | Source reviewed |
| Connect phone | Runtime/workspace controls, Telegram connect and proxy/token form, channels and agent profiles | Source reviewed |
| Terminal | Color reset plus imported SSH add/edit/test/reset-trust/delete, identity-file browser and save/cancel dialog | Source reviewed |
| Debug | Request/round selection, detail dialog, copy, close/done, pagination | Source reviewed |
| Uninstall | Entry action, acknowledgement/confirmation, cancel and destructive uninstall | Source reviewed |

## Button inventory and limits

The inventory counts lexical native-button sites, not rendered button instances.
A site inside a map may render zero or many instances; a shared module may
also contain a panel-only branch. Counts are useful for finding omissions, not
for asserting that every dynamic state was tested.

| Source family | Button sites | Factory actions | Scoped-attribute actions | Specialized/native sites |
| --- | ---: | ---: | ---: | ---: |
| `settings-*.tsx`, `SettingsSidebar.tsx`, `SettingsDraftLeaveDialog.tsx` | 259 | 216 | 3 | 40 |
| Imported component files below | 125 | 0 | 93 | 32 |

The three scoped-attribute sites in the settings family are the two shared
inline-notice actions and Telegram Connect. The imported files include:

| File family | Lexical button sites | Important distinctions |
| --- | ---: | --- |
| `subagents/SubagentCatalogControls.tsx` | 8 | Reset, pagination, clear search and extension action; tabs/filter/switch preserve states |
| `subagents/SubagentCatalogViews.tsx` | 6 | Category/catalog selection, surface switch, toggle/edit/delete |
| `subagents/SubagentProfileControls.tsx` | 9 | Profile actions plus model/provider/reasoning selection; panel header is shared |
| `subagents/SubagentProfileDialog.tsx` | 7 | Create/save/cancel plus color, tab, tool and capability selections |
| `subagents/SubagentSettingsContent.tsx` | 3 | Settings create action; two sites belong to the panel-only branch |
| `ade/AgentCenter.tsx` | 2 | Add and harness list selection |
| `ade/AgentCenterCard.tsx` | 6 | One dynamic primary/secondary action factory, advanced toggle, retry/export/remove/trial |
| `ade/AgentInstallControl.tsx` | 3 | Start/retry, cancel, error retry |
| `ade/agent-center-add-wizard.tsx` | 13 | Portal, chooser, navigation, install/login/check/trial/retry/done |
| `ade/agent-center-custom-form.tsx` | 7 | Command pick, secret unbind/bind, test/add/save-anyway/import |
| `ade/agent-center-terminal-form.tsx` | 2 | Command pick and save |
| `mcp/McpServersEditor.tsx` | 6 | Form/raw mode, server add/remove, key/value add/remove |
| `remote-ssh/SshServersCard.tsx` | 9 | Host selection and SSH action/dialog controls |
| `ExtensionDeclarativeSettingsPane.tsx` | 1 | Retry; actual declarative settings fields contain no native buttons |
| `provider-model-import-dialog.tsx` | 9 | Four action sites and five source/kind filter sites |
| `provider-external-import-dialog.tsx` | 3 | Close, cancel, import |
| `provider-import-link-confirm.tsx` | 3 | Close, cancel, confirm |
| `provider-reliability-panel.tsx` | 6 | Enable, account/fallback removal, add, disable, strategy selection |
| `provider-quick-add-panel.tsx` | 6 | Close, key/docs links, disclosure, cancel, submit |
| `provider-add-sheet.tsx` | 6 | Close/import/paste-link and selection cards/tabs |
| `claude-subscription-section.tsx` | 4 | Install, recheck, login/relogin, command copy |
| `provider-endpoints-panel.tsx` | 2 | Detect and apply |
| `provider-icon-picker.tsx` | 2 | Upload/replace and remove |
| `LucideIconPicker.tsx` | 2 | Shared trigger and portal icon-selection site |

Excluded from this imported Settings count: `SubagentDetailPanel.tsx`, which is
not a descendant of the Settings editor, and unrelated action/notification/view
exports in `ControlledContributionSurfaces.tsx`. Importing that module does not
make all of its exports part of Settings. The actual declarative settings export
was separately inspected.

## Source-level safety checks

- Compared original and edited JSX `on*`, `value`, `checked`, `defaultValue`,
  `defaultChecked`, `disabled`, and `type` attributes against the baseline
- Intentional presentation interactions add the compact category select and
  keyboard Escape/Tab handling for the SSH dialog; save/connect/trust/delete
  callbacks and settings values remain unchanged
- The SSH editor is a sibling of the size-contained SettingsCard, with bounded
  form scrolling, initial focus, focus trapping and focus restoration
- Shared imported action class names remain unchanged; only scoped presentation
  markers and accessible names/state were added
- The original permission card choices and handlers, credential reveal/storage
  flows, import confirmation, SSH host trust confirmation, and account actions
  remain in place
- Portal Settings styling is opt-in. Standalone Agent Center and ordinary Lucide
  picker callers keep their existing scope
- No runtime, main-process, preload, settings-schema, or default-value file is
  changed by the UI polish

## Automated verification

Direct Settings suites: 58 test files, 373 tests passed.
Imported-surface focused run: 12 test files, 88 tests passed.
Full repository typecheck passed (extensions, runtime, renderer and main).
Full repository lint passed with 35 existing warnings and no errors.
The full app build passed, including production runtime dependencies and the
sandboxed preload contract. Final exact-commit CI remains a separate gate.
The offline real SettingsView fixture renders all 23 destinations, 65 discovered
tabs, 48 tab transitions, visible disclosures, SSH Add/Cancel, update busy states
and uninstall confirmation/cancellation. This is a React/jsdom contract test,
not native geometry or screenshot evidence. The SSH focus/scroll regression test
also passed.
The unchanged production audit gate passed using a fresh isolated npm cache;
the reused local cache had expanded the known Jimp advisory into stale
transitive wrapper entries. No dependency or advisory allowlist was changed.
After adding the explicit Settings-versus-standalone wizard scope regression,
the wizard suite was rerun: all 6 tests passed.

Covered suites:

- Agent add wizard and persistence/cancellation
- Custom ACP form and save gates
- Agent install controls
- Subagent settings and category controls
- Provider model import dialog
- Claude subscription section
- Provider quick-add behavior
- Subagents category bridge
- MCP form parsing/serialization

`git diff --check` passed after the imported-control edits. These focused tests
do not replace the final repository typecheck/build/test gates. Record those
final results in the PR, including any baseline failure or unrun stage.

## Findings from the first complete native matrix

Native run `36973179078`, head `7473a959`, rendered 1,140 baseline and
1,140 final layouts on macOS, and 1,152 baseline and 1,152 final layouts on
Windows. Both platforms recorded no renderer exceptions or external requests.
Native PNG dimensions matched the actual OS-constrained content bounds.

The failed comparison was investigated rather than waived. The follow-up fixes:

- Bound Laboratory's wrapping tab tracks so long labels cannot overlap
- Keep Settings-only Subagent catalog filters in normal flow so they do not
  obscure controls in short/high-scale viewports
- Portal the SSH editor to the document body, preserving Settings-only styles
  and avoiding sibling-spacing offsets or scroll-container clipping
- Name the Uninstall confirmation as a modal, keep its cancel action reachable,
  trap keyboard focus, and preserve both acknowledgement and typed-word gates
- Match the fixture's height to the production root chain; compare painted
  overlap regions rather than offscreen scroll-content bounds, while retaining
  strict reached/hit checks and recording the actual obstructing element

These fixes require a new exact-head native pass. Raw repeated finding counts
are not a visual quality score. Full reports and bounded paired review PNGs are
retained as separate workflow artifacts, including unresolved findings.

## Native/rendered verification checklist

The cloud native launch stopped before a window because no X display was
available and D-Bus sockets were denied. It produced zero UI screenshots; no
sandbox workaround was attempted. The Windows/macOS workflow captures baseline
and final production components with an isolated offline bridge at 125%, 150%
and 200% Electron zoom, light/dark, wide/small native window bounds.

The following starts as pending and must be updated from actual native evidence.
Source review and passing React tests alone do not mark these complete.

- [ ] Open each available category at a regular desktop width; capture actual
  title, control alignment, hierarchy, clipping, and scrolling
- [ ] Visit every secondary tab, disclosure, and representative populated list
  in Providers, Assistant, Laboratory, Subagents, Memory, and Work
- [ ] Inspect light and dark themes, long labels/model names, and larger UI text
- [ ] Inspect the compact navigation breakpoint and narrow category layout;
  ensure selected category, Back, and conditional entries still work
- [ ] Inspect imported provider dialogs, SSH dialog, profile dialog, Add Agent
  portal, and Lucide picker portal in Settings
- [ ] Verify the shared Agent Center and subagent panel outside Settings did not
  pick up the new action styling
- [ ] Tab through controls and activate with Enter/Space; check visible focus,
  selected state, accessible names, Escape/Cancel and focus restoration
- [ ] Inspect disabled/loading/error states without triggering real account,
  permission, credential, deletion, uninstall, or migration side effects
- [ ] Verify reduced-motion and forced-colors behavior where supported
- [ ] Record platform-only or service-dependent states that were not exercised

No screenshot or runtime coverage claim should exceed the recorded evidence.
