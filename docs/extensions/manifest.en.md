# Manifest Reference

> Extension API: v1
> 中文：[Manifest 参考](./manifest.md)
> Machine source of truth: `kun-extension.schema.json` published with `@kun/extension-api`

Every extension package or development directory must contain `kun-extension.json` at its root. Kun validates the Manifest, versions, entries, contributions, permissions, and resource references before reading extension code or remote content. Unknown fields/contribution kinds, invalid references, and incompatible versions are handled according to the same-version Schema; Kun does not guess compatibility by ignoring fields.

## Complete skeleton

```json
{
  "$schema": "https://kun.dev/schemas/extensions/manifest/v1.json",
  "manifestVersion": 1,
  "apiVersion": "1.0.0",
  "publisher": "acme",
  "name": "issue-assistant",
  "version": "1.2.0",
  "displayName": "Issue Assistant",
  "description": "Manage issues with a sidebar and Kun Agent tools.",
  "icon": "assets/issue-assistant.svg",
  "engines": {
    "kun": ">=0.1.0"
  },
  "main": "dist/extension.js",
  "browser": "dist/webview/index.html",
  "activationEvents": [
    "onView:issues",
    "onCommand:refresh",
    "onTool:create-issue"
  ],
  "contributes": {
    "commands": [],
    "views.rightSidebar": [],
    "actions.topBar": [],
    "settings": [],
    "tools": [],
    "agentProfiles": []
  },
  "permissions": [
    "commands.register",
    "ui.views",
    "ui.actions",
    "webview",
    "agent.run",
    "agent.threads.readOwn",
    "tools.register",
    "network:api.example.com",
    "storage.workspace"
  ],
  "stateSchemaVersion": 1
}
```

Empty arrays may be omitted. A real Manifest should declare only contributions and permissions the extension actually needs.

## Top-level fields

| Field | Required | Constraint and meaning |
| --- | --- | --- |
| `$schema` | No | Editor-assistance URL only; not used for runtime admission; should match the target API documentation version |
| `manifestVersion` | Yes | Manifest structure version; v1 is integer `1` |
| `apiVersion` | Yes | Extension API SemVer; used for capability negotiation, not an npm package range |
| `publisher` | Yes | Publisher ID; combines with `name` to form immutable identity |
| `name` | Yes | Extension name ID; must satisfy the Schema and not use a reserved identity |
| `version` | Yes | SemVer version of this `.kunx` package |
| `displayName` | No | Short user-facing name, rendered as untrusted plain text |
| `description` | No | User-facing description, rendered as untrusted plain text |
| `icon` | No | Package-relative extension logo for Host surfaces such as the Extension Center; prefer a square SVG or a PNG of at least 80×80 |
| `localizations` | No | Bounded locale overlays for Host-rendered manifest and contribution display copy |
| `license` | No | Short license identifier; a release package still includes `LICENSE` |
| `homepage` | No | Extension homepage HTTPS URL |
| `engines.kun` | Yes | SemVer range of compatible Kun versions |
| `main` | Conditional | Package-relative Node Host entry |
| `browser` | Conditional | Package-relative browser/Webview entry |
| `activationEvents` | Yes | Static events allowed to start extension code; may be empty |
| `contributes` | Yes | Static contribution declaration; may be an empty object |
| `permissions` | Yes | Exact string permission list; may be empty |
| `stateSchemaVersion` | Yes | Non-negative integer state Schema version, independent of package/API versions; start new extensions at `1` |
| `signature` | No | Supported signature metadata used as provenance evidence, not a security audit |

When top-level `icon` is absent, the Host may fall back to the first icon-bearing View container or primary View; otherwise it shows the default placeholder. Like other Manifest resources, the logo must pass package-relative path, integrity, and controlled-resource validation.

At least one of `main` and `browser` is required. Any headless tool, Agent profile, model Provider, authentication handler, scheduled task, or background command requires `main`. Kun never substitutes `browser` for a Node entry.

A browser-only Manifest (only `browser`) cannot declare `commands`, `agentProfiles`, `tools`, `modelProviders`, or `authentication`; each needs a Node handler. Every `browser` entry requires the `webview` permission.

The full ID is `publisher.name` and must not change after publication. Renaming creates a new extension; state, grants, accounts, and threads are not transferred automatically.

`publisher` uses lowercase ASCII letters, digits, and hyphens, starts with a letter or digit, and is at most 64 characters. `name` and every local contribution ID start with a lowercase letter and then use lowercase letters, digits, or hyphens, at most 64 characters. Use the same-version Schema for exact regex and reserved-name validation.

## Host-rendered localization

`localizations` maps up to 32 bounded BCP 47 language tags to plain-text display overlays. The base Manifest remains the required fallback and the stable source for identity, activation, permissions, paths, executable schemas, and Agent instructions. An overlay can change only known display fields and must reference an existing contribution, setting property, notification action, or declared Provider model.

```json
{
  "displayName": "Issue Assistant",
  "contributes": {
    "views.rightSidebar": [{ "id": "issues", "title": "Issues", "entry": "dist/index.html" }]
  },
  "localizations": {
    "zh-CN": {
      "displayName": "问题助手",
      "contributes": {
        "views.rightSidebar": {
          "issues": { "title": "问题" }
        }
      }
    }
  }
}
```

Kun resolves a case-insensitive exact tag first, then progressively less-specific tags (`zh-Hans-CN` → `zh-Hans` → `zh`), then uses the base Manifest. Webview content continues to localize through `ui.getLocale` and `ui.localeChanged`; manifest overlays cover Host chrome such as rail tooltips, tab/result-preview titles, Extension Center cards, and declarative settings.

## Version fields

Five version dimensions are independent:

- `version`: extension package version;
- `manifestVersion`: Manifest Schema major;
- `apiVersion`: public Extension API SemVer;
- `stateSchemaVersion`: integer extension state version;
- `engines.kun`: allowed Kun SemVer range.

The private Kun/Host `rpcVersion` is not declared in the Manifest. Do not raise the package version as a substitute for declaring API or state compatibility. See [Versioning and migration](./versioning-and-migrations.en.md).

The optional v1 `signature` shape is `{ "algorithm": "ed25519", "keyId": "...", "value": "..." }`. It is provenance evidence, not proof of a security audit. Package bytes, Index SHA-256, and file integrity are still verified separately.

## Entries

Entries must:

- use normalized package-relative paths;
- fall within the integrity manifest and allowed resource roots;
- contain no absolute path, `..` escape, or symbolic link;
- exist during validate, pack, and installation;
- match the execution environment required by their contributions.

The `main` module exports `activate(context)` and may export `deactivate()`; see [Lifecycle](./lifecycle.en.md). `browser` is a sandboxed View resource entry, not a Node module, and does not receive a custom preload.

## Activation events

v1 supports:

| Event | Trigger |
| --- | --- |
| `onStartup` | After runtime admission at Kun startup; only for Node extensions that truly require eager background work |
| `onView:<id>` | The user opens the local View contribution |
| `onCommand:<id>` | The local command is invoked |
| `onTool:<id>` | Kun needs to invoke the local tool |
| `onProvider:<id>` | The model Provider is selected or requested |
| `onAuthentication:<id>` | The authentication handler is needed |
| `onAgentProfile:<id>` | The Agent profile is used |

`<id>` is a local Manifest contribution ID. The validator checks references in both directions: every View/command/tool/Provider/authentication/Agent profile declares its exact event (or the extension explicitly uses `onStartup`), and every non-startup event points to a real contribution. A typo never falls back to the first unrelated event. Merely showing an icon, title, or settings metadata does not activate code. Do not use `onStartup` as a default.

## Contribution points

`contributes` accepts only these v1 keys. Local IDs must be unique within their contribution kind; every openable View, including result previews, shares one View ID namespace. A `modelProviders[].authenticationProviderId` must resolve to an authentication contribution in the same Manifest. The host resolves local IDs to `extension:<publisher.name>/<local-id>` or an equivalent namespaced identity.

| Key | Purpose | Important declaration content |
| --- | --- | --- |
| `commands` | Extension commands | `id`, `title`, and argument/result schemas when applicable |
| `views.containers` | Activity/sidebar containers | id, title, icon, location/order |
| `views.leftSidebar` | Left sidebar View | `id`, `title`, `entry`; optional icon/`when`/order |
| `views.rightSidebar` | Right sidebar View | Same; optional `showInRightRail` |
| `views.auxiliaryPanel` | Auxiliary panel | Same |
| `views.editorTab` | Editor tab | Same; host manages tab lifecycle |
| `views.fullPage` | Full-page View | Same; cannot replace protected surfaces |
| `actions.topBar` | Top-bar actions | id, command reference, `title`, optional icon/`when`/group/order |
| `actions.composer` | Composer actions | Same; receives only public invocation context |
| `actions.message` | Message actions | Same; cannot read unauthorized threads |
| `message.resultPreviews` | Result previews | id, title, entry, `mimeTypes`, optional resource roots/`when` |
| `settings` | Settings sections/fields | id, title, `properties`, global/workspace scope, order |
| `contextMenus` | Context-menu items | id, location, command, group/order, `when` |
| `notifications` | Declarative notifications | id, title, optional message/severity/actions/`when`; each action has id/title/command |
| `agentProfiles` | Agent profiles | id, display metadata, instruction overlay, default binding/tool scope/budget/visibility |
| `tools` | Extension tools | `id`, `description`, `inputSchema`; optional `outputSchema`/sideEffects/idempotent/maxOutputBytes (1 KiB–1 MiB) |
| `modelProviders` | Complete model Providers | id, displayName, authenticationProviderId, model/capability metadata |
| `authentication` | Authentication Providers | id, authentication kind, and protected-flow metadata |
| `hostContentScripts` | Direct DOM | static scripts/styles, allowed host surfaces, activation conditions; high risk and unstable |

`views.rightSidebar` is the canonical discoverable UI for new extensions. By default, its packaged icon and localized title appear in Code mode's vertical right rail and open an independent tab beside the main conversation. Set `showInRightRail: false` to keep a View available from Extension management or commands without pinning it in that rail. Other `views.*` locations remain Extension API v1 parse- and command-routing compatible, but the Host does not generate an aggregate extension picker for them.

A View that needs fixed remote websites may declare `externalBrowser: { presentation, sites }`. `presentation` is `desktop` or `mobile`; each site accepts only `id`, `title`, optional badge/accent, and a credential-free HTTPS `url`. This requires `webview.external`, and every site hostname must match an explicit `network:` grant. A Main-owned browser surface hosts the remote page without loading the extension `entry` or bridge into it.

### Implied contribution permissions

The validator derives and enforces these minimum permissions from entries/contributions. A missing permission makes the Manifest invalid:

| Entry/contribution | Required permission |
| --- | --- |
| Any `browser` | `webview` |
| `commands` | `commands.register` |
| `views.containers` | `ui.views` |
| Any `views.*` View | `ui.views`, `webview` |
| View with `externalBrowser` | `webview.external` and `network:<hostname>` for every site |
| `message.resultPreviews` | `ui.views`, `webview` |
| `actions.*`, `settings`, `contextMenus` | `ui.actions` |
| `notifications` | `ui.notifications` |
| `agentProfiles` | `agent.run` |
| `tools` | `tools.register` |
| `modelProviders` | `providers.register` |
| `hostContentScripts` | `hostDom` |

These permissions cover registration/presentation only. A handler also declares any workspace, network, account, or storage permissions it uses. Account read/manage/use/secret permissions for `authentication` are checked for the specific operation.

Minimal command:

```json
{
  "commands": [
    { "id": "refresh", "title": "Refresh issues" }
  ]
}
```

Minimal View:

```json
{
  "views.rightSidebar": [
    {
      "id": "issues",
      "title": "Issues",
      "entry": "dist/webview/index.html",
      "icon": "assets/issues.svg",
      "when": "workspaceOpen",
      "order": 100,
      "localResourceRoots": ["dist/webview", "assets"]
    }
  ]
}
```

Minimal tool:

```json
{
  "tools": [
    {
      "id": "create-issue",
      "description": "Create an issue in the configured project",
      "inputSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string", "minLength": 1 }
        },
        "required": ["title"],
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "type": { "const": "text" },
            "text": { "type": "string" }
          },
          "required": ["type", "text"],
          "additionalProperties": false
        }
      },
      "sideEffects": "external",
      "idempotent": false,
      "maxOutputBytes": 32768
    }
  ]
}
```

For contribution behavior, see [Workbench](./workbench.en.md), [Agent and tools](./agent-and-tools.en.md), and [Providers and accounts](./providers-and-accounts.en.md). The Schema is the complete field-level reference; omitted examples do not bypass validation.

## `when` conditions

`when` uses a host-defined closed, side-effect-free expression language over public context keys. It cannot execute JavaScript, read renderer globals, DOM, or private stores, and cannot create a permission the extension lacks. Unknown keys/capabilities resolve as unavailable.

Use only context keys and operators documented for the same API version. Put business decisions in command handlers; use `when` only for visible/enabled state. When state changes, the host may hide the contribution and close its View Session when required by that contribution contract.

## Permissions

v1 permissions are exact strings:

| Permission | Broker capability |
| --- | --- |
| `commands.register` | Register Manifest-declared commands |
| `ui.views` | Provide controlled Views |
| `ui.actions` | Provide host-rendered actions, menus, and settings controls |
| `ui.notifications` | Request host notifications |
| `webview` | Create declared complex Webview UI |
| `webview.external` | Display remote HTTPS sites approved by `network:*` inside an isolated child Webview (high risk) |
| `hostDom` | Inject declared Direct DOM content scripts (high risk) |
| `agent.run` | Create and control extension-owned Agent Runs |
| `agent.threads.readOwn` | Query projections of threads/runs owned by this extension |
| `tools.register` | Register Manifest-declared tools |
| `providers.register` | Register model Providers |
| `accounts.read` | Read redacted account metadata within allowed scopes |
| `accounts.use:<providerId>` | Use account handles for a Provider |
| `accounts.manage:<providerId>` | Request protected account-management flows for a Provider |
| `accounts.secrets.read:<providerId>` | Let a Node Host request raw secrets for a Provider; high risk and separately confirmed |
| `network:<hostname>` / `network:*.example.com` | Reach an exact hostname, or explicitly accepted subdomain wildcard, through the Network Broker |
| `storage.global` | Use identity-isolated global state |
| `storage.workspace` | Use identity-isolated workspace state |
| `workspace.read` | Read an allowed workspace through the broker |
| `workspace.write` | Write an allowed workspace through the broker, still subject to policy/approval |

Declare the minimum set. A package version that adds a permission does not inherit old consent; the user must confirm again in a protected window. `webview.external` also requires explicit `network:<hostname>` grants; in this mode those grants constrain child-Webview top-level navigation, and the remote page never receives the Kun preload, Node, or Electron. Permissions never grant Node or secrets to ordinary browser/content-script code and cannot bypass the Kun ApprovalGate. See [Security and resources](./security-and-resources.en.md).

## Direct DOM declaration

`hostContentScripts` statically lists `id`, `matches`, `scripts`, optional `styles`, and `runAt: "documentStart" | "documentEnd"`. Runtime code cannot inject undeclared files or surfaces. `matches` uses host-surface tokens rather than URL globs: `workbench:*`, `workbench:code`, `workbench:design`, `workbench:write`, and `workbench:connect`. Settings/onboarding contain credentials and execution-permission controls and are always protected surfaces. There is no `workbench:settings` matcher, and `workbench:*` does not include Settings or any other credential/consent window. The installer presents `hostDom` as a highest-risk capability.

Scripts execute in an extension-specific isolated world. They can access visible DOM but not page JavaScript objects, React internals, Electron, Node, `window.kunGui`, or protected consent/credential surfaces. Host DOM, selectors, and CSS are not stable API. See [Webviews and Direct DOM](./webview-and-dom.en.md).

## Resources and integrity

A release package root must also contain:

- `README.md`;
- `LICENSE`;
- `kun-extension.integrity.json`;
- every entry and local resource referenced by the Manifest.

The integrity file records package-file SHA-256 values. Installation rejects undeclared or missing files, mismatched digests, path traversal, absolute paths, links, duplicate/case-colliding paths, out-of-root resources, and packages above published limits. Never package secrets, tokens, private keys, development `.env` files, or user data.

## Validation

```bash
kun extension validate .
kun extension validate ./dist/acme.issue-assistant-1.2.0.kunx
```

Validation errors include a stable diagnostic code, JSON path, explanation, and documentation link. Compatibility failures identify the exact Manifest, API, Kun engine, state, or Host-negotiation dimension rather than reporting only a generic version error.
