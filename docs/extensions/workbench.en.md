# Workbench Contributions, Commands, Settings, and UX

> Extension API: v1
> 中文：[工作台贡献点、命令、设置与 UX](./workbench.md)
> Related: [Manifest contributions](./manifest.en.md#contribution-points) · [Webviews and Direct DOM](./webview-and-dom.en.md)

The Kun workbench uses one typed `ContributionRegistry` for built-in and extension UI. An extension declares where an item belongs, what it displays, and which command it invokes. The host owns rendering, ordering, focus, accessibility, and lifecycle. Extension React components cannot mount directly into the Kun React tree.

For directly discoverable extension UI, the canonical v1 entry point is `views.rightSidebar`: each visible View registers its icon in Code mode's vertical right rail and opens an isolated, independently closable tab beside the main conversation. Kun does not add a duplicate tool menu or nested aggregate extension picker. `views.leftSidebar`, `views.auxiliaryPanel`, `views.editorTab`, and `views.fullPage` remain v1 Schema- and command-compatible, but new extensions should not use them as their default discoverable entry point.

## Identity and namespaces

- Built-in item: `builtin:<id>`.
- Extension item: `extension:<publisher.name>/<local-id>`.
- Command, View, setting, and other local IDs must satisfy the Schema and be unique in their contribution kind.
- An extension cannot declare `builtin:` or replace a built-in or another extension's contribution.

For example, local View `backlog` from `acme.issues` resolves to:

```text
extension:acme.issues/backlog
```

Layout persistence stores only fully qualified IDs and host layout metadata. If an update removes a View, the host ignores the missing reference and selects a valid fallback. Uninstall removes that extension's layout references without affecting other panels.

## Supported UI locations

| Manifest key | Host location | Recommended use |
| --- | --- | --- |
| `views.containers` | Activity/sidebar container | Group related Views |
| `views.leftSidebar` | Left sidebar (compatible) | Navigation and project trees in existing v1 extensions |
| `views.rightSidebar` | Right sidebar (canonical) | Extension tools, status, editors, and workflow panels |
| `views.auxiliaryPanel` | Auxiliary panel (compatible) | Logs, tasks, and wide tables in existing v1 extensions |
| `views.editorTab` | Editor tab (compatible) | Documents and visualization in existing v1 extensions |
| `views.fullPage` | Workbench full page (compatible) | Complex dashboards in existing v1 extensions; never protected flows |
| `actions.topBar` | Top bar | Frequent global/workspace command |
| `actions.composer` | Conversation Composer | Attach context or start an extension workflow |
| `actions.message` | Message action | Act on an authorized message |
| `message.resultPreviews` | Tool/result preview | Safely render complex extension results |
| `settings` | Settings page | Structured non-secret configuration |
| `contextMenus` | Supported host menus | Command for a file, message, or workspace context |
| `notifications` | Host notification center | Bounded, accessible, attributed notice |

Unknown locations fail validation and are never treated as arbitrary component slots. Extensions cannot specify absolute screen coordinates, cover consent/credential/approval surfaces, or force placement ahead of protected built-in controls.

## View declaration

```json
{
  "views.rightSidebar": [
    {
      "id": "issues",
      "title": "Issues",
      "icon": "assets/issues.svg",
      "entry": "dist/webview/index.html",
      "when": "workspaceOpen",
      "order": 100
    }
  ]
}
```

- `entry` must be an integrity-listed local resource in an allowed resource root.
- Labels, titles, and descriptions are untrusted plain text, not executable HTML.
- Icons must be supported package resources and remain clear in light/dark themes and on Retina displays.
- Every visible `views.rightSidebar` View whose `showInRightRail` is not `false` receives its own direct rail icon and top-level tab. If an icon is omitted, the Host uses an accessible fallback without executing extension code. A View with `showInRightRail: false` remains available from Extension management or commands without staying in that rail.
- `when` controls visibility/enablement and never grants permission.
- `order` participates only within host groups; equal priorities sort by fully qualified ID.
- Multiple instances are created only when the contribution contract permits them, each with an independent View Session.

Rendering title/icon does not activate the extension. Opening the View checks compatibility, enablement, workspace trust, and permission, then triggers `onView:<id>`.

To coordinate a right-side View with the main Agent, register capabilities as extension tools and keep bounded pointers such as the active project in `storage.workspace`. The main Agent reads and mutates authoritative state through tools while the View refreshes through Host messages. They do not share React state, DOM, runtime tokens, or private Electron IPC. The default bundled [`kun-video-editor`](../../examples/extensions/kun-video-editor/) demonstrates this pattern.

## Commands

Declare:

```json
{
  "commands": [
    {
      "id": "refresh",
      "title": "Refresh issues"
    }
  ]
}
```

Register:

```ts
context.subscriptions.add(
  await context.commands.registerCommand('refresh', async args => {
    const workspace = context.workspaceContext
    // Validate business input and perform bounded work.
    void args
    return { refreshed: true, workspaceId: workspace?.id ?? null }
  })
)
```

Requirements:

- Manifest declaration and runtime registration must use the same local ID;
- `commands.register` is required;
- read workspace metadata from `context.workspaceContext`; command arguments contain only public-Schema data and any self-asserted extension identity is untrusted;
- arguments/results must satisfy public Schemas and payload/time limits;
- an action/menu may reference only an owning-extension command or documented public host command;
- another extension's private command reference fails validation;
- handler errors are attributed to extension, version, command, and workspace and are redacted.

A command must not represent an approval result, account secret, or `request_user_input` answer. Sensitive operations use host-owned protected flows.

## Actions and context menus

Actions are rendered with host components. A typical declaration contains:

- local `id`;
- command reference;
- `title` and optional icon;
- host-defined `group` and `order`;
- `when`.

They require `ui.actions`; the command also requires `commands.register`. The host owns:

- keyboard navigation, focus rings, and accessible names;
- truncation, tooltips, disabled/busy state;
- confirmation affordances and transitions to protected confirmation;
- stable ordering within a location;
- theme and high-contrast adaptation.

Do not emulate complex UI with adjacent actions. Use a View/Webview when interaction exceeds one simple action.

## Result preview context

For a successful tool result that exposes a generated file with a declared MIME type, Kun opens a matching `message.resultPreviews` View and delivers one session-bound host message after the guest is attached:

- channel: `kun.resultPreview.open`;
- payload: `{ schemaVersion: 1, threadId, turnId, result }`;
- `result`: bounded `sourceId`, normalized `mimeType`, and optional safe `name`, `attachmentId`, workspace-relative path, byte size, width, and height.

The payload never contains an absolute path, preview data URL, file bytes, runtime token, or credential. Reading the referenced content still requires the normal attachment/workspace permission and broker operation. Listen through `context.ui.onDidReceiveMessage`; do not depend on Electron guest IPC channels.

## Settings

Settings contributions are for non-secret structured configuration. A section declares stable `id`, `title`, global/workspace `scope` (workspace by default), and `order`, then each field under `properties` declares:

- stable local key;
- type, default, enum/range, and other bounded Schema;
- title/description.

The Node Host and Webview use the same Host-persisted API. Do not maintain a second `localStorage` copy:

```ts
const mode = await context.configuration.get<'safe' | 'fast'>('general', 'mode')

context.subscriptions.add(
  context.configuration.onDidChange((change) => {
    if (change.sectionId === 'general' && change.key === 'mode') {
      console.log('mode changed', change.value)
    }
  })
)

await context.configuration.update('general', 'mode', 'safe')
const declaredKeys = await context.configuration.keys('general')
```

The `sectionId` and key must belong to this extension's Manifest. The Host selects the global or current explicitly trusted workspace namespace from the section scope, enforces defaults/type/enum/range/length and size limits, and uses revisions to prevent two settings surfaces from silently overwriting each other. `@kun/extension-react`'s `useConfiguration(sectionId, key)` uses this same backend.

Never store API keys, OAuth tokens, cookies, or client secrets in settings; common snake_case, kebab-case, and camelCase secret keys are rejected. Use [protected account flows](./providers-and-accounts.en.md#account-creation-and-authentication). Use the Storage API, not settings, for large binary, cache, or frequently changing data.

Settings updates must:

- pass host Schema validation;
- affect only the extension namespace;
- produce a versioned change event;
- never use a localized label as a persistence key;
- migrate removed/changed keys under public state-migration rules.

## Notifications

Notifications require `ui.notifications`. The host renders bounded plain text, severity, and declared command actions. A notification should:

- identify its extension source;
- be keyboard/screen-reader dismissible;
- contain no secret or complete prompt;
- not generate repeated update notices (v1 performs no automatic extension update checks);
- provide one clear recovery action, such as opening logs or reauthentication.

A guest cannot request Chromium notification permission directly.

Use `context.ui.showNotification()` for runtime notifications. This is not a Chromium notification and does not require the extension to have an open View: Kun renders bounded plain text in the trusted workbench and returns the selected action `id` only to the originating call. Dismissal, timeout, extension disablement, or Kun shutdown resolves to `undefined`. A pure headless run has no trusted workbench, so the call resolves to `undefined` immediately instead of waiting 45 seconds; pending notifications are also dismissed when the GUI heartbeat lease expires after an abnormal disconnect.

```ts
const selected = await context.ui.showNotification({
  id: 'provider-unavailable',
  title: 'Model provider unavailable',
  message: 'Reconnect the account and try again.',
  severity: 'warning',
  actions: [{ id: 'retry', title: 'Retry' }]
})

if (selected === 'retry') await retryConnection()
```

At most 8 runtime notifications per extension and 64 globally may be pending; the default timeout is 45 seconds. The workbench expands at most 5 at once and reveals the rest as the queue advances. An action returns only its declared local `id` and does not execute a command for the extension. The Host accepts only a real Chromium-trusted user click, so a synthetic Direct DOM `.click()` is rejected. A notification action is still not an approval, identity-confirmation, or secret-authorization surface; privileged or otherwise protected operations must continue through the applicable protected consent API, with the real user decision completed in a Main-owned protected surface. Manifest `contributes.notifications` are different: they are declarative host-rendered notices whose actions invoke Manifest-declared commands. Do not mix the two models.

## `when` and context keys

`when` is a closed expression and does not execute JavaScript. Use only public context keys for the target API version, such as workspace-open state, current workbench mode, selection capability, or negotiated capability. Unknown keys resolve as unavailable.

Design rules:

- use `when` to hide irrelevant actions; the broker still checks permissions;
- never put secrets, file content, or user text in a context key;
- do not depend on raw DOM state;
- allow the host to close an ineligible session after context changes;
- revalidate business preconditions in the handler for stale-click races.

## Enablement, permissions, and workspace trust

A contribution appears only when all are true:

1. package is compatible with Kun/API/Manifest;
2. selected-version integrity passes;
3. globally and current-workspace enabled;
4. allowed by workspace trust;
5. every required permission is granted;
6. `when` is true.

Permission revocation immediately stops new calls. While UI is disappearing, the broker must reject a stale invocation. Enabling or changing extension tools does not silently mutate an active thread's catalog; see [Tool catalogs](./agent-and-tools.en.md#tool-catalog-and-cache-stability).

## UX and accessibility requirements

- Use host theme tokens, never private CSS variables.
- Follow host locale, zoom, reduced-motion, and high-contrast preferences.
- A View container needs a host-owned accessible name and focus boundary.
- Restore focus to the originating control when a View closes.
- Provide clear loading, cancel, empty, error, and reconnect states.
- Virtualize long lists; do not break layout with unbounded Webview height.
- Identify extension/Provider ownership and data flow; do not imitate a Kun core prompt.
- Never put sensitive consent in ordinary workbench DOM; it cannot create a valid consent token.

## Failure and cleanup

A View crash produces a bounded extension-attributed recovery placeholder without crashing the main renderer. Disable, uninstall, workspace switch, or View close disposes sessions, pending calls, and subscriptions. Uninstall removes stale layout references but preserves extension data by default.

Use `kun extension doctor <id>` for contribution registration, missing permission, invalid entry, and layout issues. Use `kun extension logs <id>` for redacted command/View diagnostics.
