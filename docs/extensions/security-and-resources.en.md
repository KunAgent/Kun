# Permissions, Trust, Storage, Network, Logs, and Quotas

> Extension API: v1
> 中文：[权限、信任、存储、网络、日志与配额](./security-and-resources.md)
> Related: [Webview security](./webview-and-dom.en.md) · [Accounts and secrets](./providers-and-accounts.en.md)

Kun security centers on bound identity, least-privilege brokers, protected consent, and bounded resources. It can constrain SDK/Broker calls, isolate Webviews and extension state, and contain one extension's failure. It cannot turn arbitrary Node `main` code into a malicious-code security sandbox.

## Trust model

### Source trust

Installation review shows source type/locator, `publisher.name`, version, SHA-256, signature status, contributions, and permissions. A signature is provenance evidence, not proof of a Kun security audit. Unsigned local/index packages may be installed only after explicit confirmation and remain marked unsigned.

### Execution trust

| Type | Trust meaning |
| --- | --- |
| Declarative contribution | Host renders only validated text, icons, Schemas, and command references |
| Webview | Chromium sandbox + context isolation + Node off + narrow bridge; no direct network by default |
| Node `main` | Runs with current-user OS privileges; child process is reliability isolation only |
| `hostContentScripts` | Can read/change visible workbench DOM; isolated world does not prevent UI spoofing/content reading |

Installing Node/Direct DOM code means trusting it with those real capabilities. Broker permissions cannot prevent Node from directly using `fs`, `net`, `child_process`, and similar APIs. Management UI and documentation continue to disclose this limitation.

### Workspace trust

Packages install globally and enable per workspace. Every operation is also constrained by current workspace trust/scope. A global permission grant does not authorize every workspace. Workspace changes close ineligible Views/content scripts and cancel or reject out-of-scope calls.

### Per-operation trust

File writes, command execution, external effects, and secret reveal may still require the Kun ApprovalGate or Host-owned protected consent. An extension cannot self-approve or replace real consent with Agent text, a Webview click, or DOM mutation.

## Permission enforcement

Manifest permissions are exact strings; see [Manifest](./manifest.en.md#permissions). General rules:

1. Installation or a version with added permissions displays them in a protected surface.
2. Grants bind exact extension ID, version permission snapshot, and workspace policy.
3. The Host connection binds real identity; a payload extension ID is not authorization input.
4. Every operation rechecks current grants, not only activation/registration.
5. A request may narrow but never expand grants.
6. Revocation immediately blocks new calls; in-flight calls cancel/fail under capability rules.
7. One extension's threads, state, accounts, private commands, View Sessions, and content-script worlds are inaccessible to another by default.

`accounts.secrets.read:<providerId>` and `hostDom` are high-risk permissions that require renewed consent when added. `workspace.write`, `tools.register`, and `providers.register` also cannot override stricter core policy.

## Protected surfaces

Only independent protected windows owned by Electron Main/core may handle:

- installation, upgrade, permission changes, package source review;
- workspace trust;
- credential/secret entry and secret reveal;
- OAuth callback completion;
- external-side-effect approval;
- other security-critical consent.

These windows mount no extension Webview, inject no content script, and render no plugin HTML. After a real user decision, Main authorizes with a short-lived, single-use, operation-bound token. It binds extension/version, kind, parameter digest, workspace, window session, and expiry and is never given to the plugin. Forgery, replay, expiry, or changed parameters fail.

## Storage types

| Type | Permission | Scope | Use |
| --- | --- | --- | --- |
| Global State | `storage.global` | extension ID | Cross-workspace preferences, lightweight cache metadata |
| Workspace State | `storage.workspace` | extension ID + workspace | Project configuration/progress |
| View State | `webview`/View contract | extension + contribution + workspace | UI expansion, filters, cursors |
| Protected Extension Secrets | `storage.secrets` | profile + extension ID + key | Short Node-Host-owned service secrets |
| Credential Store | Account Broker | Provider + account + credential reference | API keys, OAuth tokens, secrets |

Global, Workspace, and View state accept only Schema-valid, quota-bounded structured data and are not secret stores. Protected Extension Secrets use the OS credential backend or authenticated encrypted fallback and are never exposed to Extension Views. Binary blobs, large logs, complete prompts/attachments, and credentials are forbidden in ordinary state.

Package directories are immutable and are not state directories. Mutable data defaults to:

```text
~/.kun/extension-data/<publisher.name>/
  state/
  backups/
  logs/
```

`host-health.json` under the same data root stores non-secret restart/circuit Host health; extensions must not edit it directly.

The host may explicitly override its data root. Do not hard-code this path or directly read across namespaces; use SDK APIs.

## State writes and migration

- Writes pass Schema, size/quota, and scope checks.
- Host persistence is safe/atomic and does not expose partial commits.
- A `stateSchemaVersion` upgrade backs up every global/workspace namespace.
- All namespaces migrate before atomic switch; mixed versions are forbidden.
- Rollback uses a compatible retained snapshot and never infers reverse migration.
- Uninstall preserves state by default; data deletion requires separate confirmation.

Avoid meaningless write churn from timestamps/random values. Large caches need bounds, TTL, and cleanup.

## Network Broker

Prefer an exact `network:<hostname>`. When multiple subdomains are genuinely required, explicitly declare `network:*.example.com`. For example:

```json
{
  "permissions": [
    "network:api.example.com"
  ]
}
```

The Broker checks:

- HTTPS scheme and target hostname;
- every DNS result and the actual socket target for each production direct request;
- every redirect target;
- extension/workspace/account scope;
- method, headers/body Schema;
- timeout, response bytes, concurrency, rate;
- cancellation and audit/redaction.

The production default transport accepts only public-unicast addresses for remote HTTPS. If one resolution contains any loopback, private, link-local, unique-local, multicast, reserved, IPv4-mapped special-use, or other non-public-unicast address, the complete request fails closed; one simultaneous public address does not make a mixed answer safe. The Broker gives the validated address set directly to that request's socket lookup, so connection does not adopt a changed DNS answer. The next request resolves and validates again. Explicit `http://localhost`, `http://127.0.0.1`, and `http://[::1]` work only when every resolved address is loopback.

Redirect handling is always manual/error. After accepting a `Location`, the caller starts a new Broker request so scheme, permission, DNS, account, and credential-host policy all run again for the next hop. Production Network/Account Brokers do not inherit ambient HTTP(S) proxies because proxy-side resolution cannot satisfy this direct-connection pinning contract; any future explicit proxy integration must provide equivalent validation. An explicitly injected fake `fetch` in tests does not represent this production guarantee.

An exact hostname grant allows no subdomain. `network:*.example.com` matches subdomains only and does not also match the apex `example.com`; declare both when needed. A wildcard does not relax address classification, although the same hostname resolving to different public-unicast addresses across requests is normal DNS behavior. Never put tokens in URLs/queries. Webview direct `fetch`/WebSocket remains CSP-blocked. Node direct network can bypass the Broker, so these controls are not an OS sandbox for Node code and cannot guarantee that a public upstream will not proxy to another target itself.

## Authenticated Fetch

Pass only an account reference. Account Broker refreshes and injects authentication, rejects/removes conflicting plugin credential headers, and strips authorization/cookie material from the returned response. Secret-read is only for an approved Node custom signer; see [Providers and accounts](./providers-and-accounts.en.md#authenticated-fetch-and-secret-read).

## Workspace access

`workspace.read`/`workspace.write` authorize broker operations only under granted roots. Paths are normalized and guarded against traversal/symlink escape. A write may still trigger sandbox/ApprovalGate; permission does not mean “no confirmation required.”

An Agent Run/tool can request only a narrower workspace scope than its grant. After workspace trust/permission revocation, the next file operation fails even if the Run/catalog predates revocation.

## Default runtime limits

v1 Host baseline defaults follow. User/platform policy may tighten them. Read effective values from diagnostics/capabilities and never hard-code assumptions:

| Resource | Default |
| --- | --- |
| One IPC message | 1 MiB |
| Activation deadline | 15 seconds |
| General operation deadline | 60 seconds |
| Cancellation grace | 2 seconds |
| Shutdown deadline | 5 seconds |
| Concurrent operations per extension | 16 |
| Stream window | 32 unacknowledged events or 4 MiB |
| Host event rate | 200 events/second |
| Node Host memory ceiling | 256 MiB |
| Consecutive-crash circuit threshold | 3 |
| Log rotation | 5 MiB × 3 files per stream policy |
| Extension state document | 10 MiB |
| State migration deadline | 30 seconds |
| Network/authenticated request body | 8 MiB |

State, network responses, Agent events, and tool output have more specific public Schema/policy limits. A breached limit returns a stable structured error; do not evade it with unbounded queues or retries.

See [Packaging](./packaging-and-index.en.md#package-validation-limits) for `.kunx` defaults.

## Backpressure and release

- Producers wait for stream acknowledgement and never pre-buffer complete results.
- Queues have both item and byte limits.
- Lagging subscribers reconnect durable events with a cursor.
- Cancellation/terminal releases buffers, timers, listeners, and correlation.
- Disable/uninstall fences new calls before cancel/deactivate.
- Memory/protocol limits terminate or circuit-break only the owning extension.

## Logs

Kun captures extension stdout, stderr, and Host lifecycle logs, attributed by extension ID, version, and process instance, with rotation:

```bash
kun extension logs acme.issue-assistant
kun extension logs acme.issue-assistant --json
```

Log operation/request/invocation IDs, state changes, elapsed time, bounded error codes, retryability, and resource limits. Never log:

- API keys, access/refresh tokens, OAuth/device codes, client secrets;
- cookies or authorization headers;
- runtime or consent tokens;
- complete prompts, attachments, or file content;
- unbounded request/response bodies.

Core also redacts Provider errors containing known secrets, but extensions must sanitize before writing stdout. A crash report after secret-read must not contain the secret.

## Diagnostics and audit

```bash
kun extension doctor acme.issue-assistant
```

Without secrets, diagnostics expose selected/installed version, source/digest/signature, enablement, permission snapshot, Manifest/API/Kun/RPC negotiation, state schema, active Host PID, activation cause, restart/circuit state, limit failures, last structured error, and log location.

Audit attributes Agent/tool/Provider/account/secret/network/consent operations to extension, version, workspace, non-secret resource reference, operation, and outcome. Output is safe to attach to a bug report by default, but still review business metadata before public sharing.

## Author security checklist

- Default to browser-only; add Node `main` only for real background needs.
- Declare the minimum hostname/account/workspace/UI permissions.
- Never store secrets in state, settings, logs, or messages.
- Never import private Kun paths, IPC, or bearer tokens.
- Use Host account/network/file APIs instead of implementing them in a Webview.
- Bound every stream, queue, cache by bytes/items/time.
- Make cancellation/disposal idempotent; discard late post-terminal results.
- Declare external effects accurately; never auto-retry unknown outcomes.
- Disclose complete Provider request access and prohibit fallback.
- Prefer stable contributions/Webviews over Direct DOM.
- Before release, test redaction, denial, crash paths, `doctor`, and the release checklist.
