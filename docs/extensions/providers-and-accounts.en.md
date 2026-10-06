# Model Providers, Accounts, and Authentication

See [the provider configuration and gateway contract](../provider-configuration-and-gateway.md)
for the built-in descriptor schema and v2 account Registry. Extension executable
adapters keep their existing permission boundary; registering an extension
provider does not automatically grant public gateway export or an Agent login.
Public gateway export currently covers accepted built-in HTTP text adapters.
Executable extension export is a separate P5 change; installing a provider
cannot expand an existing client's approved accounts. Capability/pricing facts
retain source and observation time, and unknown values do not become guarantees.
See [release validation](../provider-gateway-release-validation.md).


> Extension API: v1
> 中文：[模型 Provider、账号与认证](./providers-and-accounts.md)
> Related: [Permissions and secrets](./security-and-resources.en.md) · [Versioning and migration](./versioning-and-migrations.en.md)

An extension can implement a complete custom model transport without creating another Agent runtime. Kun normalizes a model request, routes it through `RemoteModelClient` to the extension Node Host, and commits a validated normalized stream through the existing AgentLoop, tools, and usage path.

## Three separate concepts

| Record | Describes | Contains secrets |
| --- | --- | --- |
| Provider Definition | Transport, models/capabilities, authentication methods, owner | No |
| Account | One named user account for that Provider, auth kind, status, credential reference | No; secrets live in Credential Store |
| Provider Binding | Provider + account + model selected by a thread/profile/role | No |

A Binding must be coherent. Provider A cannot bind an account/model owned by Provider B. A missing account returns account-required and never selects another account automatically.

## Permissions and entry

- A Provider contribution requires Node `main` and `providers.register`.
- Reading redacted account metadata requires `accounts.read`.
- Using an account requires `accounts.use:<providerId>`.
- Requesting create/update/delete account flows requires `accounts.manage:<providerId>`.
- If custom signing truly needs raw secret material, Node requires `accounts.secrets.read:<providerId>` with separate high-risk consent.
- Brokered upstream requests also require `network:<hostname>`.

Model Providers, authentication handlers, and dynamic discovery must run without browser/Webview content. `browser` is never a headless fallback.

## Declare a Provider

Minimal Manifest example:

```json
{
  "main": "dist/extension.js",
  "activationEvents": [
    "onProvider:acme-models",
    "onAuthentication:acme-auth"
  ],
  "contributes": {
    "modelProviders": [
      {
        "id": "acme-models",
        "displayName": "Acme Models",
        "authenticationProviderId": "acme-auth",
        "credentialHosts": ["api.acme.example"],
        "models": [
          {
            "id": "reasoning-small",
            "displayName": "Reasoning Small",
            "capabilities": {
              "input": ["text"],
              "output": ["text"],
              "reasoning": true,
              "tools": true,
              "parallelTools": true,
              "streaming": true
            }
          }
        ]
      }
    ],
    "authentication": [
      {
        "id": "acme-auth",
        "displayName": "Acme Account",
        "type": "api-key",
        "apiKey": {
          "header": "Authorization",
          "prefix": "Bearer "
        }
      }
    ]
  },
  "permissions": [
    "providers.register",
    "accounts.read",
    "accounts.use:acme-models",
    "accounts.manage:acme-models",
    "network:api.acme.example"
  ]
}
```

Use the Manifest Schema for exact capability/auth metadata. Provider and local model IDs are stable and become namespaced with extension identity. They cannot occupy built-in or another extension's ID.

`credentialHosts` is a separate allowlist for destinations that may receive authentication material; a broad `network:*` permission does not replace it. `authenticatedFetch` requires the URL to match both the `network:<hostname>` grant and this Provider's `credentialHosts`. Remote targets require HTTPS; only explicit loopback targets may use HTTP, and every resolved address must remain loopback. The Broker returns redirects in manual mode so every next hop is checked again, and strips credential/cookie response headers. The production transport also resolves every address, rejects any special-use or mixed DNS answer, and pins approved addresses to the actual connection. Kun-initiated OAuth device, token-exchange, and refresh requests use the same policy. Tests may inject a fake fetch, but it does not represent production SSRF/DNS-rebinding protection.

Kun combines static Manifest models and dynamic `listModels` output into a Provider-owned catalog. Dynamic entries cannot escape the Provider namespace. Invalid/duplicate models are deterministically rejected or de-duplicated. If discovery fails, valid static models may remain, but models are never borrowed from another Provider.

## Provider Adapter lifecycle

A Provider adapter implements:

- `probe(binding)`: validate connection/account and return normalized success or Provider error without an Agent turn;
- `listModels(binding)`: return normalized dynamic models;
- `stream(request, context)`: handle the complete normalized request as an `AsyncIterable` and yield ordered events;
- `cancel(requestId)`: cancel a request;
- `countTokens(request)`: optional; Kun core estimates when absent, which is not adapter failure.

Register through `context.modelProviders` and add the returned `Disposable` to `context.subscriptions`. Disablement, Host exit, or disposal cancels/fails in-flight requests and releases correlation state.

## Normalized request

The Provider receives a public versioned object containing:

- opaque request ID;
- effective Provider/account/model;
- system/mode instructions;
- stable prefix and model-visible history items;
- text/image/other supported attachment representations;
- advertised tool schemas;
- reasoning/sampling/generation controls;
- an account handle, not raw credentials by default.

It contains no Kun internal class, `TurnItem` identity, runtime token, filesystem credential, or JavaScript `AbortSignal`. Cancellation is a separate operation using the same request ID.

A modality, tool mode, or generation control not advertised for the selected model fails with a capability error before transport.

## Stream events

v1 accepts only ordered versioned events:

- `textDelta`
- `reasoningDelta`
- `toolCallDelta`
- `toolCallComplete`
- `usage`
- `completed`
- `error`

Rules:

1. Per-request sequence is monotonically increasing and validated by Host/Kun.
2. Fragmented tool calls assemble independently by call ID; parallel calls retain first-seen order.
3. Complete tool arguments must satisfy the tool Schema before history commit.
4. At most one terminal event: `completed` or `error`.
5. A successful `completed` must have at least one known `usage` field before or with the terminal event; missing or empty usage is a protocol error. A standalone usage event and inline completion usage are accounted once as the latest cumulative snapshot. Unknown fields are not invented; reasoning/cache-write tokens and costs in any three-letter currency are retained.
6. Unknown event, invalid order, oversized payload/event count, second terminal, or malformed call terminates the protocol without committing invalid assistant/tool history.
7. Events after terminal/cancellation are discarded.

Kun assembles parallel `toolCallDelta` fragments by call ID and commits them in first-seen order. Final arguments must be a JSON object and match an advertised tool and its input Schema; disagreement between fragments and an explicit completion fails closed. A successful terminal is committed only after late or duplicate events have been ruled out. Active RPC stream events refresh the idle watchdog, so a healthy long request is not subject to a fixed 60-second total deadline.

The Manifest Provider declaration is the reviewed ceiling for permissions, credential hosts, and model capabilities; Host registration must match it field-for-field. If dynamic `listModels` fails or returns invalid/duplicate entries, Kun retains Manifest models, ignores bad entries, and records an attributed diagnostic without upstream bodies or credentials. Adapter-controlled probe/stream messages, details, and codes are not copied raw into history, logs, or UI where they could leak a known credential.

Illustration:

```ts
async function* stream(request) {
  yield {
    type: 'textDelta',
    requestId: request.requestId,
    sequence: 0,
    delta: 'Hello'
  }
  yield {
    type: 'usage',
    requestId: request.requestId,
    sequence: 1,
    usage: { inputTokens: 12, outputTokens: 1 }
  }
  yield {
    type: 'completed',
    requestId: request.requestId,
    sequence: 2,
    finishReason: 'stop'
  }
}
```

Use same-version SDK types for exact fields. Async-iterator consumption/ack must honor backpressure. Never buffer an entire unbounded upstream stream first.

## Cancellation, timeout, and backpressure

After user interrupt or model timeout, Kun invokes `cancel(requestId)`, stops projecting late events into UI/Agent history, and releases state after the cancellation grace. The adapter should abort upstream HTTP, read loops, and timers.

The default Host stream window is 32 unacknowledged events or 4 MiB, whichever is reached first; policy may tighten it. Pause upstream reads when the consumer lags. Exceeding queue, payload, or idle limits fails with a Provider protocol/limit error affecting only that extension.

## Usage and tool calls

Report only usage actually returned upstream. Kun normalizes available values into main accounting and retains Provider/model/account/run attribution. Do not present an estimate as Provider-native cache hit/miss or cost; mark it as estimated or omit it.

Tool-call deltas require stable call IDs. Fragments from parallel calls may interleave but names/arguments cannot be mixed. A Provider only generates calls; execution still traverses Kun ToolHost, pinned catalog, permissions, approval, budgets, and cancellation.

## Never silently fall back

If an explicit Binding's Provider/account/model is any of the following, Kun fails without sending the conversation to another transport:

- unknown, uninstalled, disabled, or incompatible;
- circuit-open or Host crash;
- account missing, expired, or interaction-required;
- model belongs to another Provider;
- capability insufficient;
- stream/protocol failure.

Kun does not switch to a default Provider, another account, or a same-named model from another Provider. Repair the Binding or restore the original Provider, then let the user/caller retry explicitly.

## Data disclosure

An extension Provider receives the complete model-visible request: conversation history, system/mode instructions, attachments, and tool schemas. Installation consent and first Provider selection show owner and data categories. If a new version expands permissions or input capabilities, it remains disabled until acknowledgement.

Adapter errors/logs should retain only extension, Provider, model, account ID, request ID, operation, normalized category, retryability, and a redacted summary. Never log complete prompts, attachment bodies, authorization headers, raw adapter error payloads, or secrets. Kun maps common authentication, authorization, rate-limit, invalid-request, unavailable, and adapter-failure cases to fixed error codes; raw `code`, `message`, and `details` do not enter history or persisted diagnostics.

## User selection and durable Bindings

The Provider account card in Extension Center is the core-owned selection surface. The user connects an account, selects a model actually available to that account, and chooses **Review and save binding**. A Main-owned protected window shows the extension owner, exact extension version, Provider, model, opaque account reference, and the four data classes the Provider may receive: complete conversation history, system/mode instructions, attachments, and tool schemas. Nothing is persisted and no model content is sent before confirmation.

After confirmation, Kun atomically writes `providerId + accountId + modelId + ownerExtensionId + ownerExtensionVersion + dataAccessDigest` to `extensions/provider-bindings.json`. The account value is only an opaque reference. API keys, access/refresh tokens, OAuth codes, and authorization headers never enter a Binding. Bindings are scoped to the current workspace by default, or to global scope when no workspace is selected.

A Binding appears in Kun's model picker only while all of these remain true:

- the same acknowledged extension version is enabled and trusted in that workspace;
- `providers.register`, `accounts.read`, and `accounts.use:<providerId>` remain granted;
- the Provider Host is registered and the account is `connected`;
- the model still belongs to that Provider;
- the disclosure digest computed from current permissions and model capabilities still matches the acknowledgement.

A version, permission, or input-capability change invalidates the old acknowledgement and requires review again. Account deletion, Provider disablement/crash, model removal, or workspace-grant revocation makes the Binding explicitly unavailable; Kun never repairs it to a default Provider, another account, or a same-named model. Main chat carries the opaque account reference when it creates the thread/turn. If an extension Agent profile declares the same Provider/model but omits the account, Kun resolves the user-approved account in the same workspace scope; without a valid Binding, Agent run creation returns account-required before model transport instead of falling back.

The model picker does not write an extension Provider into legacy built-in Provider credential settings. It reads this core Binding, so GUI restart, headless `kun serve`, and extension Agents use the same provider/account/model ownership rules.

## Account states and listing

One Provider may have multiple named accounts. Public account objects contain only:

- stable account ID/reference;
- Provider ID;
- user label;
- auth type;
- `connected`, `expired`, `interaction-required`, `error`, or `unavailable` status;
- safe non-secret metadata.

Renaming a label does not change reference or existing Bindings. Listings never contain API keys, access/refresh tokens, client secrets, cookies, or credential blobs.

## Account creation and authentication

An extension requests an account flow, but credentials are collected only in Host-owned protected surfaces that load no extension Webview/content script. On success the extension receives only an account reference.

Public `context.authentication` provides `listAccounts`, `createSession`, `getSession`, `cancelSession`, `deleteAccount`, `authenticatedFetch`, and high-risk `revealSecret`. Account flows use a session ID to poll/observe `pending`, `completed`, `cancelled`, `expired`, or `failed`. A Webview cannot submit raw credentials directly. A Node Host session result also receives no authorization URL, device user code, or protected-form content. A pending session returns actionable guidance and continues in Kun's own account manager; only a Main-owned protected surface receives and displays short-lived interactive material.

Users can rename an account, atomically replace an API key, or delete an account from protected account management in the Extension Center. Rename and key replacement retain the stable account ID and existing Bindings; the extension SDK never receives the replacement key. Each protected operation binds an extension/Provider/account/operation digest and produces a secret-free audit record.

### API key

The user enters the key in a protected form. Kun stores it through Credential Store and writes only a reference to ordinary settings; the Provider may then run a redacted probe with that account reference. Key replacement atomically updates the credential, preserves account ID, and clears old in-memory material. A failed probe must not put the key in logs, state, or events.

### OAuth 2.0 Authorization Code + PKCE

Account Broker generates and validates state/PKCE, and a callback matches only the initiating transaction. Missing, expired, replayed, or mismatched callbacks are rejected with no stored secret. Code exchange and access/refresh storage happen in core. Cancellation returns cancelled and creates no account.

### Device Authorization

A protected surface shows verification URL and user code. Broker follows Provider interval, slow-down, and expiry, keeps one bounded transaction, and supports cancellation. Success clears transient codes and stores credentials. Expiry/cancellation creates no account.

## Refresh and Credential Store

Concurrent refreshes for an account join one attempt and atomically replace tokens. A rejected refresh token marks the account `interaction-required`/`expired`; dependent requests fail explicitly and do not switch accounts. If upstream refresh succeeds but secure persistence fails, Kun fails closed without partial token state.

Credential Store prefers an OS credential facility. If unavailable, only an authenticated encrypted fallback is allowed and Kun exposes a non-secret degraded-protection status. If neither works, new secret storage is refused; there is no plaintext-at-rest fallback.

Ordinary settings, threads, extension state, IPC, and logs contain only opaque references.

## Authenticated Fetch and Secret Read

Prefer brokered authenticated fetch:

1. Extension supplies an authorized account handle and allowed URL/request.
2. Broker validates extension/Provider/account/network scope.
3. It refreshes if needed.
4. It injects authentication.
5. It returns a bounded response without credential headers.

A conflicting extension-supplied `Authorization`/credential field is removed or rejected, never combined with stored credentials.

Every manual redirect hop and every token/refresh request re-runs DNS/address policy; a prior hostname check is never reused to connect to a newly resolved answer. This policy covers only Broker-created direct connections. It does not constrain a Node adapter's own `fetch`/socket and does not claim to stop an allowed public service from proxying at the application layer.

Only a Node adapter that truly requires custom signing should request `accounts.secrets.read:<providerId>`. Every success/denial produces a redacted audit record. Webviews/content scripts can never read secrets. Use the secret only in the minimum operation scope; never cache, log, or return it to UI.

## Isolation, deletion, and missing Providers

The Broker derives caller identity from the Host channel and enforces Provider ownership/account scope. An extension cannot enumerate or use another extension's private Provider accounts unless core defines a shared-provider permission.

After a Provider extension is disabled/uninstalled:

- accounts and Bindings become `unavailable`;
- secrets are not deleted automatically;
- thread/profile Bindings remain for recovery/diagnostics;
- Kun does not rebind to another Provider.

Explicit account deletion removes credentials, invalidates sessions, and leaves dependents account-required. Show the affected Bindings before confirmation.

## Headless operation

A valid stored account can be used/refreshed by `kun serve`, scheduled tasks, or CLI with the GUI closed. Login, consent, or secret-unlock interaction returns stable interaction-required plus an actionable continuation; it never hangs or implicitly opens a renderer.

## Legacy credential migration

When the GUI first reads an old `kun-settings.json` (or a compatible legacy filename), it assigns a stable source ID to every Provider profile and Kun runtime override. The migration order is:

1. create a permission-restricted, one-time `*.pre-extension-credential-migration.json` rollback backup beside the settings file;
2. write the secret to the protected Credential Store first;
3. create or reuse a `kun.core` account and persist `providerId + accountId + modelId` in `provider-bindings.json`;
4. write a recovery record containing only a salted digest, opaque references, and the `secure-committed` phase to `legacy-credential-migrations.json`;
5. atomically rewrite ordinary settings without Provider-profile/runtime-override plaintext; GUI-managed Kun `config.json` also contains only `credentialSourceId`, never a key or credential-derived header;
6. after the settings write succeeds, advance the recovery record to `settings-committed`. Later starts resolve request credentials from protected storage through the account reference.

Equal legacy secrets for the same Provider reuse one account. Different secrets, such as a Provider profile and a distinct runtime override, remain separate accounts and Bindings. If a Provider is temporarily missing, its account and Binding remain `unavailable`; restoring the Provider resolves them again without deletion or rebinding. Plaintext reintroduced from an old backup after completion cannot overwrite a newer protected credential. A protected user update keeps the stable account ID while replacing the credential.

If the ordinary-settings write fails, Kun rolls back the pending account/credential/Binding update, leaves the original readable file authoritative, and writes no completed marker. A restart after secure commit retries or rolls back according to the phase. A restart after the atomic settings write but before marker completion finalizes the marker from the existing secure account/Binding. Markers, account records, Bindings, and logs never contain the secret.

For one release cycle, Electron Main projects the account credential into the in-memory legacy settings shape used by existing synchronous core-Provider callers. That projection is never written to an ordinary file and is not part of the Extension API. Extensions continue to receive only account references and redacted metadata. The next major that drops this legacy shape will remove the compatibility read. See [State and compatibility migration](./versioning-and-migrations.en.md).

## Test checklist

- probe/listModels/static + dynamic catalog;
- text/reasoning/parallel fragmented tool calls/usage/terminal;
- malformed order/payload, timeout, backpressure, cancellation/late event;
- Host crash/circuit and explicit no-fallback;
- multimodal capability rejection;
- multiple accounts, rename/delete/missing Binding;
- API-key rejection, PKCE state/replay, device interval/expiry/cancel;
- concurrent refresh and secure-store failure;
- authenticated-fetch headers, secret-read audit/redaction;
- headless success and interaction-required;
- migration idempotence/backup/unavailable-Provider preservation.
