# Webviews and Direct DOM

> Extension API: v1
> 中文：[Webview 与 Direct DOM](./webview-and-dom.md)
> Related: [Workbench UX](./workbench.en.md) · [Permissions and trust](./security-and-resources.en.md)

Complex extension UI must use a host-created sandboxed Webview. Use Direct DOM (`hostContentScripts`) only when stable contribution points cannot express the behavior and you accept that selectors may require repair after any Kun patch or minor release.

## Choose an approach

| Need | Choose | Compatibility promise |
| --- | --- | --- |
| Button, menu, settings field, or notification | Declarative contribution | Stable API |
| Custom list, chart, form, or dashboard | Webview | Stable bridge/theme/state contract |
| Must read/change existing visible host DOM | Direct DOM | Unstable and high risk; no selector SemVer guarantee |
| Mount a third-party component in the Kun React tree | Unsupported | Use a Webview |
| Execute script in the renderer main world | Unsupported | Use isolated Webview/content script |

## Webview creation and identity

Kun creates an independent View Session for every complex View and binds:

- extension ID and selected version;
- contribution ID;
- workspace scope;
- WebContents identity;
- an unguessable, bounded-lifetime session nonce.

Even if a guest payload includes another `extensionId`, View ID, or nonce, Electron Main uses the sender-bound principal. Cross-extension or cross-View requests are rejected. Contributions that allow multiple instances receive independent sessions.

## Mandatory sandbox baseline

Extensions cannot override:

- `nodeIntegration: false`;
- `contextIsolation: true`;
- Chromium `sandbox: true`;
- the single Kun-owned preload;
- an extension-isolated, non-persistent-by-default session partition;
- deny-by-default permission requests;
- deny-by-default navigation, popup, and arbitrary download.

Guests do not receive Node globals, Electron modules, Extension Host IPC handles, the Kun runtime token, account secrets, or full `window.kunGui`. A Manifest request for a custom preload, Node enablement, or disabled sandbox/context isolation fails validation or is refused.

## Local resource protocol

Webview documents and assets load through:

```text
kun-extension://<publisher.name>/<package-relative-path>
```

The protocol handler binds each URL to the selected installed version and checks normalized path, integrity manifest, and local resource roots. It rejects:

- `..`/encoded traversal and absolute paths;
- link escape;
- undeclared or missing files;
- cross-extension reads;
- remote redirects;
- unsafe MIME/type confusion.

Do not concatenate user input into a resource URL. Generate known asset paths at build time and send dynamic data through the bridge.

## Content Security Policy

The minimum policy intent is:

```text
default-src 'none';
script-src 'self';
style-src 'self';
img-src 'self' data:;
font-src 'self';
connect-src 'none';
```

The host and same-version Schema control the final CSP. Do not use remote scripts, `eval`, uncontrolled inline code, or CDN-loaded frameworks. Even with `network:<hostname>`, browser `fetch`, WebSocket, and other direct connections remain blocked by `connect-src 'none'`. The permission authorizes Network Broker requests only.

A Webview build must bundle npm dependencies into packaged browser resources. Chromium does not resolve bare module specifiers such as `@kun/extension-api` the way Node does; running `tsc` alone preserves that import and leaves the page unable to start. The official scaffolds use Vite to bundle dependencies; the framework-neutral `webview` template and these examples also use a relative `base`, keeping generated URLs inside declared local resource roots. Inspect the final HTML and JavaScript before release, not only the TypeScript source.

## Narrow View Bridge

The Kun-owned preload exposes only negotiated versions of:

- request/response and host messages;
- command invocation;
- event subscriptions/disposal;
- theme, locale, zoom, and accessibility preferences;
- schema-versioned View state;
- authorized high-level Agent/account/Provider APIs.

Every call validates method, contribution, payload Schema/size, call rate, outstanding count, lifecycle, and permission. Do not depend on the implementation name of a preload global. Use the framework-neutral client from `@kun/extension-api` or `@kun/extension-react`.

A React View uses:

- `ExtensionViewProvider`;
- `useTheme` and `useLocale`;
- `useViewState`, `useHostMessage`, and `usePostHostMessage`;
- `useAgentRun`;
- `useAccounts` and `useProviderStatus`.

The template passes the Kun-owned preload's `window.kunExtension: HostTransport` into the public client, then injects that client into hooks:

```tsx
import { ExtensionHostClient, type HostTransport } from '@kun/extension-api'
import { ExtensionViewProvider } from '@kun/extension-react'
import { createRoot } from 'react-dom/client'

declare global {
  interface Window {
    readonly kunExtension: HostTransport
  }
}

const client = new ExtensionHostClient(window.kunExtension)
createRoot(document.getElementById('root')!).render(
  <ExtensionViewProvider client={client}>
    <App />
  </ExtensionViewProvider>
)
```

`window.kunExtension` is the narrow View transport, not `window.kunGui`. Business components use the client/hooks rather than private transport methods, and View teardown disposes the client.

Hooks dispose subscriptions and pending work when a component unmounts. Non-React apps use the same framework-neutral bridge without Electron.

## View State

Browser local/session storage is not the durable data path. Partitions are non-persistent by default and state may disappear when a View is cleared or recreated. Durable View state uses the public API:

- scope is extension + contribution + workspace where applicable;
- data is structured, schema-versioned, and quota-bounded;
- credentials, tokens, cookies, secrets, and private prompts are forbidden;
- arbitrary binary is unsupported; use Extension Storage or a public file capability for large data;
- version changes use explicit migration and never expose incompatible state to an old View.

Two extensions cannot read each other even with the same key. An extension cannot request state using another fully qualified View ID.

## Theme, locale, focus, and accessibility

Use public theme tokens, not private Kun CSS variables or DOM classes. The bridge emits updates when host theme, locale, zoom, or accessibility preferences change.

`ui.getTheme()` returns the resolved workbench theme, actual zoom, reduced-motion preference, and these stable public tokens: `background`, `sidebarBackground`, `surface`, `foreground`, `mutedForeground`, `border`, `accent`, `focusRing`, `success`, and `danger`. `ui.getLocale()` returns Kun's current language and writing direction. React Views can subscribe to the same live values with `useTheme()` and `useLocale()`.

The desktop workbench synchronizes the same environment snapshot to the Kun Extension Host, so a Node entry reads values consistent with its Views while the desktop is connected. Pure headless execution uses the documented deterministic defaults when no workbench preferences exist.

A View should:

- remain keyboard reachable with logical tab order;
- provide semantic labels, form errors, and live status;
- honor reduced motion and high contrast;
- let the host restore focus after close/crash;
- not intercept reserved host shortcuts;
- provide cancel/reconnect UI for streams and long operations.

## Navigation, external open, downloads, and devices

A Webview cannot navigate away from its `kun-extension://` origin, create unapproved windows, or download arbitrary files directly. Camera, microphone, geolocation, MIDI, USB, serial, Bluetooth, screen capture, and Chromium notifications are denied by default.

To open an external HTTPS page or export a file, invoke a documented Host command so Kun can validate URL/path, permission, and required user consent. Do not emulate this with `window.open` or hidden navigation.

### Approved external-site Views

When a sidebar genuinely needs to run a complete remote website, the extension must declare `webview.external`, ordinary `webview`, and every `network:<hostname>` allowed for top-level navigation (a wildcard does not include the apex hostname). The host creates a Main-owned `WebContentsView` only for a workspace-reviewed View that declares `externalBrowser`, and enforces all of the following:

- the remote guest has no Kun preload and cannot access `window.kunExtension`, Node, Electron, or local extension resources;
- initial URLs, top-level navigations, redirects, and popups must use HTTPS and match a granted hostname; allowed popups reuse the current guest;
- permission/device requests and downloads are denied;
- cookie/session data is stored only in an extension-ID-isolated persistent partition, never the default session or another extension's partition;
- HTTPS/WSS/data/blob subresources may support the site's CDN, sign-in, and media dependencies without permitting top-level navigation to ungranted sites.

`externalBrowser.presentation` may be `desktop` or `mobile`. The Host can provide mode selection, zoom, and workbench fullscreen for fixed destinations while retaining an independent page per destination/mode. Those pages share one extension-ID-isolated login session, but never another extension's session. A horizontally overflowing page may receive one bounded fit after a full-page navigation, and a mobile page may temporarily use the available workbench width for login, passport, account, or self-profile routes; later user-selected zoom remains authoritative. Hidden pages are muted and their media is paused; returning reuses the prior page state. The remote page never receives the extension bridge.

This is a high-risk browser capability, not a general switch that bypasses `connect-src 'none'` for ordinary Views. Do not use it for arbitrary user-provided URLs; prefer a fixed, reviewable destination set. The bundled [`social-media-sidebar`](../../examples/extensions/social-media-sidebar/) is the reference implementation.

## Network Broker

For a View network request:

1. Prefer exact `network:<hostname>` in the Manifest; use an explicit subdomain wildcard only when required.
2. The user accepts the permission.
3. The View calls the framework-neutral network API.
4. The Broker validates scheme, hostname, account scope, size, redirect, timeout, and quota using sender-bound identity.
5. It returns a bounded, redacted response.

For authenticated access, use authenticated fetch. The View passes only an account reference; the Broker injects authentication and removes credential headers from the response. See [Providers and accounts](./providers-and-accounts.en.md).

## Webview failure and cleanup

A guest crash destroys only its View Session and shows an extension-attributed recovery placeholder. It does not affect the main renderer or other Views. View close, disable/uninstall, workspace switch, or guest termination cancels pending calls, event subscriptions, and Host resources. Late messages from stale guests are rejected.

## Direct DOM: an explicit high-risk capability

Direct DOM requires all of:

- static script/style, host-surface target, and activation-condition declaration in `contributes.hostContentScripts`;
- every resource in the package integrity manifest;
- the `hostDom` permission;
- protected permission consent for this extension version and workspace.

Runtime code cannot inject undeclared files or new surfaces. The installer must explain that the script can read and modify visible Kun workbench content.

### Exact `runAt` semantics

- `documentStart`: Main first caches the revalidated, already-read declared resources as the startup plan for a workbench document. The sandboxed preload synchronously obtains that plan, establishes isolated worlds, and executes it before renderer page scripts. If a contribution first becomes eligible after the current document has started, Kun schedules one workbench reload so it genuinely runs at `documentStart` in the next document; Kun never silently degrades it to late injection.
- `documentEnd`: execution never occurs before `DOMContentLoaded`. It can be enabled on demand in an already loaded workbench, but never while the DOM is still unready.

Styles follow the same `runAt` and the Host inserts them with `data-kun-extension-style="<extension>/<contribution>"`. Each script/style file is limited to 2 MiB and one plan to 8 MiB. Only statically declared Manifest files that pass `kun-extension://` confinement revalidation can be read.

## Isolated world is not DOM isolation

Each content-script contribution executes in its own Electron isolated world:

- it can `querySelector`, read text, and modify visible DOM;
- it does not enter the renderer main JavaScript world;
- it has no Node, Electron, `window.kunGui`, React objects, or runtime credentials;
- it cannot access another extension's isolated world;
- it communicates only through a narrower sender-bound content-script bridge.

The preload also closes `require`, `process`, `module`, `window.open`, `fetch`, XHR, WebSocket, EventSource, Worker, and `sendBeacon` in that world. The workbench CSP separately blocks remote/inline main-world scripts and remote style/resource injection. A `network:<hostname>` grant does not enable browser networking for Direct DOM. Put network work in the Node entry through the Network Broker, or use a Webview.

An isolated world reduces JavaScript-object and bridge exposure, but does not prevent phishing-style UI changes, reading visible sensitive content, or breaking layout. `hostDom` remains a high-risk trusted-code permission.

## Narrow content-script bridge

`@kun/extension-api` exports `KunHostContentScriptApi`. A content script sees exactly three methods on `window.kunHost`:

- `getContext()` returns Host-derived, frozen extension ID/version, contribution, surface, `runAt`, hashed workspace scope, DOM marker, and `rawDomCompatibility: "unsupported"`;
- `reportDiagnostic()` sends a Schema- and rate-limited diagnostic of at most 2,000 characters to Main;
- `dispose()` closes the page-local bridge and emits one `kun-extension-deactivate` event.

```ts
import type { KunHostContentScriptApi } from '@kun/extension-api'

declare global {
  interface Window {
    readonly kunHost: KunHostContentScriptApi
  }
}

const context = window.kunHost.getContext()
const target = document.querySelector('[data-kun-surface="workbench-topbar"]')
if (!target) {
  await window.kunHost.reportDiagnostic({
    code: 'SELECTOR_MISSING',
    message: 'Unsupported top-bar selector was not found.',
    level: 'warning'
  })
}
```

The bridge accepts no extension ID, version, workspace, or permission as call arguments. Its preload closure attaches a Main-generated binding ID/nonce. Main then validates sender WebContents/main frame, binding, extension, version, contribution, workspace scope, and current lifecycle, so one world cannot impersonate another extension through payload fields. The bridge exposes no commands, Agent, account, secret, file, shell, arbitrary IPC, arbitrary Host messaging, or network capability.

## Protected surfaces and consent tokens

These Host-owned windows load no extension Webview or content script:

- install/upgrade and permission review;
- workspace trust;
- all of Settings and onboarding, plus account/secret entry, OAuth completion, and secret reveal;
- the native Agent tool-approval prompt (the workbench also revokes Direct DOM while an approval is pending);
- other security-critical consent.

After a real decision in a protected surface, Main creates a short-lived single-use consent token bound to extension/version, operation kind, parameter digest, workspace, window session, and expiry. The token stays inside trusted host code.

A synthetic click, similar-looking button, or payload from ordinary DOM cannot create a token. Replay, expiry, or changed parameters fail. Extension-supplied consent copy is rendered only as untrusted plain text next to host-authored risk disclosure.

Agent tool approval adds an independent defense-in-depth chain. When an approval is `pending` or `submitting`, Kun revokes the current workbench content-script bindings and performs one clean reload to remove residual listeners, observers, and DOM mutations. Approval buttons accept only real Chromium events marked `isTrusted`; `HTMLElement.click()` and script-dispatched events are ignored. A real click enters a dedicated preload IPC method, while the generic `runtimeRequest` bridge cannot address `/v1/approvals/*`.

For an interactive decision, Electron Main then shows a native modal that extensions cannot control. Only after confirmation does Main mint a 30-second, single-use HMAC consent bound exactly to the `approvalId`, `allow|deny` decision, expiry, and random nonce. `kun serve` verifies and consumes it before touching the `ApprovalGate`. Missing, forged, replayed, expired, different-ID, and different-decision tokens fail closed. Explicit `auto`/`never` policies use the same dedicated Main channel and action-bound token without pretending that a user clicked.

Settings changes to `approvalPolicy`/`sandboxMode` are not authorized as ordinary form writes either. Main compares the request with current persisted values, shows a native confirmation, and then creates a 30-second, one-shot action token that stays in Main and is bound to the old values, new values, and sending frame. Persistence occurs only after that token is consumed. The Composer permission picker also rejects synthetic events and passes through this Main gate. Direct DOM therefore can neither read Settings API-key/secret inputs nor use ordinary or synthetic clicks to switch later execution to `auto + danger-full-access`.

## Direct DOM compatibility and lifecycle

Host elements, selectors, CSS classes, React ownership, and layout are not Extension API. Kun may change them in a patch or minor release without adapters. A broken selector is an unsupported extension dependency, not a stable API regression.

A content script should:

- match only documented supported host-surface targets;
- exit harmlessly and log a bounded diagnostic when a selector is absent;
- obtain the marker from `getContext().marker` and apply it to created roots as `data-kun-extension-root`; Host-managed styles automatically use the same marker;
- bound mutation observers, listeners, and timers;
- never cover security/account/approval UI;
- clean up on the deactivation message.

Before deactivation, Kun emits `kun-extension-deactivate` and attempts to remove Host-managed styles/roots matching the marker. Arbitrary scripts may also leave listeners, timers, observers, or mutations to Host nodes, so complete reversal cannot be proven. Disable, uninstall, workspace switch/deactivation, permission change/revocation, version switch/rollback/reload, and contribution/surface changes therefore revoke the old binding and reload the current workbench document to restore a clean surface. Main also revalidates the active package/version/workspace/grant/declaration every two seconds to catch revocation performed through the CLI or another client. Late calls from stale worlds fail.

Main records extension/version/contribution/workspace-scope and stable diagnostic codes. It does not record source code, binding nonces, or unbounded payloads. Extension-reported diagnostics are limited to 20 per binding per 10 seconds. Execution, resource-revalidation, bridge, deactivation, and reload failures remain attributed to that extension and cannot prevent Kun startup or other extensions from running.

## Pre-release checks

- Can a stable action/View/Webview replace Direct DOM? If yes, remove `hostDom`.
- Webview has no Node, custom preload, direct network, or remote code.
- Resources load only through `kun-extension://` and declared roots.
- Messages/state have Schemas, size/rate limits, and disposal.
- Theme, locale, keyboard, focus, error, and reconnect behavior are tested.
- Direct DOM tolerates missing selectors and is labeled unstable.
- Accounts, approvals, and secrets use protected surfaces/brokers only.
