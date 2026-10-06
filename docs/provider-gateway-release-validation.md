# Provider gateway release validation

This record separates fixed-version offline client execution, integration fixtures,
scale measurements and packaged application checks. Fixtures use temporary data
and fake upstreams; they do not prove real provider entitlement or billing.

## Fixed official-client gate

The production templates and actual gateway handlers are used with isolated
homes, workspaces and allowlisted environments. External traffic is denied by
an isolated proxy. No global client configuration or Agent installation changes.

| Client | Pinned version | Text stream | Actual read tool + next model call | Cancel -> upstream abort | Small model |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | 0.160.0 | passed | passed | passed | no independent protocol |
| Claude Code | 2.1.220 | passed | passed | passed | separate main/local-small passed |
| OpenCode | 1.1.47 | passed | passed | passed | explicitly reuses main |
| Pi | 0.73.1 | passed | passed | passed | no independent protocol |

The 13 scenarios verify successful fixture file contents, not merely presence of
an arbitrary tool_result. Smoke reports include source revision, dirty state,
exact versions and safe wire-shape/actual target summaries. Version mismatch
fails by default. Tests fixed Pi's unsupported `${NAME}` interpolation: production
models.json now uses the bare environment variable name. Codex config omits the
obsolete preferred_auth_method setting.

Command: `node scripts/smoke-model-gateway-clients.mjs --codex <pinned-binary>
--opencode <pinned-binary> --pi <pinned-binary> --timeout 30000`. A developer may
install exact clients in a temporary npm prefix; the script does not install them.
Use `--resources <packaged-Resources>` to test packaged Runtime modules instead
of bundling current TypeScript. Keep credentials out of argv and evidence files.

## Agent wiring gate (native config takeover)

`scripts/smoke-agent-wiring-clients.mjs` checks the Agents page path end to end.
For each installed agent it seeds a realistic user config in an isolated home,
connects through `kun/src/agent-wiring` exactly as the GUI does, and runs the
agent's own CLI with no model or base-URL flags. Only the config Kun wrote can
point the agent at the gateway. The gateway is the real handler set with a route
pool, a route rule keyed on the calling agent, and a system-prompt middleware,
over a deterministic fake upstream. External traffic goes to a proxy that drops
every tunnel. After the runs Kun disconnects, and every seeded file must match its
original bytes. A second connection then changes an unrelated key in the agent's
file, and disconnecting must keep that change.

Per scenario the smoke asserts: the agent printed the fixture reply; the request
reached the upstream; the route rule chose the member for that agent (key
attribution reached routing); the middleware ran; the route trace recorded
`decision: rule` for that agent; for the tools scenario a real read tool ran
and its result reached the next model call; for Claude Code the thinking block
came back with the upstream signature restored by tool-call id; for agents
with a reasoning setting the effort reached the upstream.

Command: `node scripts/smoke-agent-wiring-clients.mjs [--client <id>] [--json]`.
Clients are the binaries already on PATH; the script never installs them.

Run on 2026-10-06, macOS arm64, branch `codex/provider-gateway-followup`. Two
consecutive full runs gave the same result:

| Agent | Version | Text | Read tool + next call | Exact restore | User edit kept |
| --- | --- | --- | --- | --- | --- |
| Claude Code | 2.1.291 | passed | passed, thinking signature restored | yes | yes |
| Codex | 0.145.0 | passed | passed | yes | yes |
| OpenCode | 1.1.47 | passed | passed | yes | yes |
| Gemini CLI | 0.52.0 | passed (trusted folder) | passed | yes | yes |
| Droid | 0.234.0 | passed, no Factory login needed | passed | yes | yes |
| Kimi Code | 0.29.0 | passed | passed | yes | yes |
| Goose, Aider, Pi, Crush, Continue | not installed | not gated | not gated | unit tests only | unit tests only |

Blocked outbound attempts were update, telemetry and registry checks
(chatgpt.com, github.com, registry.npmjs.org, play.googleapis.com,
code.kimi.com, telemetry hosts, api.factory.ai). None carried the gateway key.

The first runs found five gateway or fixture problems, fixed before the table above:

- Claude Code 2.1.29x sends `context_management` with a `clear_thinking`
  edit that keeps everything. The gateway refused it, so every request failed.
  Clearing edits are now accepted as advisory, and unknown edit types are still refused.
- Claude Code 2.1.29x sends a `system` role message inside `messages`. It now
  folds into the system prompt, text blocks only.
- Codex replays the `reasoning` items the gateway returned. Their summary now
  returns as reasoning history; encrypted content is ignored because the
  gateway never issues it.
- Gemini CLI sends `generationConfig.topK` on every request. It is now
  accepted as a sampling hint.
- Kimi Code asks for `max_completion_tokens` equal to its context window, which
  made every member ineligible. For gateway traffic, max tokens is now a ceiling:
  each member receives the largest budget it can honor.

Gemini CLI reads `~/.gemini/.env` only in folders the user trusted. In an
untrusted folder it stops with a missing-key error and does not contact Google
with the gateway key. The Agents page states this for Gemini CLI. The smoke
sets `GEMINI_CLI_TRUST_WORKSPACE=true` to stand in for a trusted folder.
Claude Code ignores a `settings.json` it cannot parse as strict JSON, so the
smoke seeds strict JSON for it.

Packaged app check, 2026-10-07, `dist/Kun-0.3.10-mac-arm64.zip` built from
local develop, extracted and launched with `open -n`:

- The runtime became ready on the configured port 18900 after about 90 seconds;
  `/health` returned ok. `/api/hello` advertised the route-trace and key-limit
  endpoints, and `/v1/kun/limit` refused a missing key with 401.
- `~/.kun/gateway.json` was written with mode 0600, naming the live PID,
  instance and port. It holds no key.
- No errors appeared in the Kun log between launch and quit.
- On quit, the runtime's graceful shutdown hit its 10-second deadline and the
  process was forced to exit. This was already the behaviour before these changes.
  In the first build this left a stale discovery file. The discovery file is now
  withdrawn before runtime shutdown starts, and a repeat run with the same forced
  exit left no file.

## Fixed scale gate

`kun/src/services/provider-configuration.release-scale.test.ts` exercises 500
protected API-key accounts in an encrypted Credential Store, 100 groups and
10,000 catalog models. It keeps configured admission limits and measures
fixture setup separately from restart. macOS arm64 local run, 2026-10-06:

| Measurement | Result | Release maximum |
| --- | ---: | ---: |
| Fixture construction | 390 ms | recorded separately |
| Registry startup | 682 ms | 10,000 ms |
| List incl. credential readability | 153 ms | 5,000 ms |
| Search incl. same projection | 150 ms | 5,000 ms |
| Executable materialization | 303 ms | 10,000 ms |
| Live discovery (2,000 IDs) | 42 ms | 3,000 ms |
| 10,000 cached IDs write/read | 4 ms | recorded separately |
| Live discovery cancellation | 23 ms | 1,000 ms |
| Queued caller cancellation | 1 ms | 1,000 ms |
| 20 repeated list projections | 3,065 ms | 60,000 ms |
| RSS growth over those 20 projections | 41.94 MiB | 128 MiB |
| Positive heap growth | 0 bytes | 128 MiB |

Heap/RSS samples use ordinary garbage collection; zero positive heap growth is
not a proof of zero allocation or an unlimited-duration leak test. Startup here
means the provider Registry, not the whole Electron application. The UI uses
paging and has its own component acceptance checks. Set
`KUN_PROVIDER_BENCHMARK_REPORT=<temporary-path>` to retain machine-readable
metrics without credentials. Threshold changes need an explained workload or
implementation change rather than disabling queues/catalog limits.

## Boundary and lifecycle gate

`provider-gateway-release-boundary.test.ts` runs actual loopback HTTP: missing
client auth fails, the Runtime token is not a model key, all provider admin
mutations reject a model key even in insecure mode, and no CORS allow-origin or
credential permission is returned for an untrusted browser origin. Non-loopback
gateway activation fails independently of active keys. Runtime lifecycle and
Manager heartbeat fixtures verify loss/exit fencing; budget tests reopen the
same durable ledger and retain sent unknown reservations.

Packaged application gate passed on macOS arm64 with an unsigned isolated
fixture bundle (unique app ID, temporary data/control/settings paths). Full
build and strict after-pack checks passed. Packaged Runtime build ID was
`91beb813f26d9b1974fbbb7bcc7311dacbd064eb1fcfc9b908f94567e74ea8fd`.
The latest packaged modules passed all 13 pinned-client scenarios in one run,
including actual route target changes with the same client configuration.
Packaged CLI help/version (0.3.10) also passed.

The actual packaged GUI verified Manager crash recovery, main-window close,
owner SIGKILL and reopening the same profile. Normal close stopped all 9 owned
processes in 2,921 ms; owner crash stopped them in 403 ms; reopened close took
3,583 ms. Both Manager and Runtime health endpoints closed. The isolated smoke
flag skips global kun:// registration, so the fixture does not replace the
user's installed protocol association.

Packaging initially detected a stale local basic-ftp 5.3.1 while both lockfiles
required 6.2.1. The exact official archive was verified against lock integrity
and only that installed directory repaired; no dependency constraints or locks
changed, and strict hoisting was retained. The package copied Electron ABI 148
native modules into its own resources before workspace Node ABI restoration.
Whole-repository Node tests require a host-Node-compatible SQLite binary; the
packaged GUI keeps its independent Electron binary. The final resource update
used npmRebuild:false, preserved the previously verified Electron binary and
left workspace Node ABI 141 SQLite bytes unchanged. Latest Runtime/Main now
include the final hard-budget semantics/status fixes and bounded worker reason.

The provider surface was stable through the accepted build/package. Separate
Agent task edits after that snapshot are identified independently; this report
does not certify unbuilt later edits simply because the earlier package passed.

## Scenario evidence matrix

The following 57 scenario entries map to executable regression/integration
checks. The matrix is coverage evidence, not a claim that every scenario is a
manual GUI click-through. Final gate status/counts are recorded below it.

## provider-configuration-platform

| Scenario | Executed evidence | Assertion |
| --- | --- | --- |
| Configure a provider without any Agent installed | `kun/src/services/provider-configuration.test.ts` | HTTP/anonymous connection saved, materialized without CLI |
| Native Agent login does not grant provider export | `kun/src/harness/gateway-alias-binding.test.ts` | native subscription excluded from export |
| Add a second API account | `kun/src/services/provider-configuration.test.ts` | same preset account credentials remain independent |
| Rename and regroup a connection | `kun/src/services/provider-client-workflows.release.test.ts` | rename/regroup preserve account and external identity |
| Template update with user overrides | `kun/src/services/provider-configuration.test.ts` | frozen template upgrade preserves explicit overrides |
| Full endpoint on different consumers | `kun/src/server/routes/model-utility.test.ts` | Runtime utilities resolve the same materialized endpoint; protocol fixtures cover full URLs |
| Concurrent edits | `kun/src/services/provider-configuration.test.ts` | CAS stale preview rejected without overwriting new revision |
| Runtime materialization fails | `kun/src/services/provider-configuration.test.ts` | committed revision and failed activation reported separately |
| Import with conflicting IDs and missing keys | `kun/src/services/provider-configuration-recovery.test.ts` | remapped exact slots bind only reviewed protected secrets |
| Retry an uncertain commit | `kun/src/services/provider-configuration.test.ts` | durable idempotency returns original commit |
| Interrupted credential replacement during migration | `kun/src/services/model-connection-registry.recovery.test.ts` | fenced credential transaction recovery before application |
| Delete a referenced connection | `kun/src/services/provider-configuration-references.test.ts` | default references handled atomically; external references block deletion |
| Downgrade with new v2-only objects | `kun/src/services/provider-configuration-recovery.test.ts` | v2-only semantics and future canonical versions fail closed |

## provider-discovery-lifecycle

| Scenario | Executed evidence | Assertion |
| --- | --- | --- |
| Replace account credentials | `kun/src/services/provider-discovery-coalescing.release.test.ts` | late old-account response rejected; new catalog identity required |
| Cache names cannot collide | `kun/src/services/provider-discovery.test.ts` | SHA-256 filenames separate provider/a from provider_a |
| A new upstream model appears | `kun/src/services/provider-discovery-coalescing.release.test.ts` | new discovered ID leaves user-selected list unchanged |
| Upstream model disappears | `kun/src/services/provider-discovery-coalescing.release.test.ts` | missing selected ID retained as unavailable |
| Empty success | `kun/src/services/provider-verification-evidence.test.ts` | successful empty catalog remains empty and distinct from inference |
| Metadata service unavailable | `src/renderer/src/components/provider-model-import.test.ts` | catalog evidence survives missing metadata enrichment |
| No model-list endpoint | `kun/src/services/provider-verification-evidence.test.ts` | manual catalog has no fake network/protocol/inference success |
| Agent installation is old or absent | `kun/src/adapters/model/codex-provider-catalog.test.ts` | public compatibility lookup does not inspect or require installed CLI |
| Version metadata cannot be fetched | `kun/src/adapters/model/codex-provider-catalog.test.ts` | last working/bundled version retained after metadata failure |
| Repeated pagination cursor | `kun/src/services/provider-discovery.test.ts` | cursor loop and excessive pages rejected |
| Multiple refresh requests | `kun/src/services/provider-discovery-coalescing.release.test.ts` | one physical refresh for two callers; one subscriber abort is isolated |

## unified-gateway-routing

| Scenario | Executed evidence | Assertion |
| --- | --- | --- |
| Fallback reaches an unauthorized connection | `kun/src/adapters/model/route-pool-gateway-safety.test.ts` | fallback and account groups cannot expand admitted scope |
| No candidate supports required tools | `kun/src/adapters/model/route-governance.test.ts` | guaranteed/filter capabilities reject or exclude unsupported tools |
| Several candidates each fail transiently | `kun/src/adapters/model/route-pool-gateway-safety.test.ts` | four physical attempts, nested adapter retries share budget |
| Deadline expires in queue | `kun/src/services/provider-request-scheduler.test.ts` | queue expiration/cancellation consumes no later upstream lease |
| Tool arguments were already streamed | `kun/src/adapters/model/route-snapshot.release.test.ts` | partial tool arguments followed by 503 never reach another target |
| Side-effecting server tool before output | `kun/src/server/routes/gateway-protocol-conformance.test.ts` | web_search/server_tool_use and source-bound state rejected before inference |
| Several consumers share one account | `kun/src/services/provider-request-scheduler.test.ts` | caller lanes share one account and rotate fairly |
| Cancellation while queued | `kun/src/services/provider-request-scheduler.test.ts` | cancelled queued waiter is removed and slot reusable |
| Two clients reuse a session string | `kun/src/adapters/model/route-affinity.test.ts` | caller identity scopes identical session strings |
| Sticky target is disabled | `kun/src/adapters/model/route-affinity.test.ts` | eligibility/TTL/clear invalidate sticky target |
| Route edited during streaming | `kun/src/adapters/model/route-snapshot.release.test.ts` | edited alias keeps its admitted stream target and uses the new target next request |
| Route members have different context limits | `kun/src/adapters/model/route-governance.test.ts` | published capability minima omit unknown facts |
| Unsupported provider-managed state | `kun/src/server/routes/gateway-protocol-conformance.test.ts` | unrepresentable provider-managed state explicitly rejected |

## gateway-client-policies

| Scenario | Executed evidence | Assertion |
| --- | --- | --- |
| Gateway key sent to an admin route | `kun/src/server/provider-gateway-release-boundary.test.ts` | public key rejected at every provider-config admin action even insecure |
| Route gains a new upstream | `kun/src/server/routes/gateway-client-policy.test.ts` | models and resolution intersect frozen connection scope |
| Legacy key migration | `kun/src/services/gateway-credential-service.test.ts` | legacy key survives with distinct client credential lifecycle |
| Revoke a key during a response | `kun/src/server/routes/gateway-clients.test.ts` | revoke can retain or cancel admitted leases explicitly |
| Rotate a client key | `kun/src/services/gateway-credential-service.test.ts` | rotation invalidates old key and keeps stable client identity |
| One caller exhausts its concurrency | `kun/src/server/routes/gateway-client-policy.test.ts` | per-client scoped policy, protocol and concurrency admission |
| A request has no conservative token bound | `kun/src/server/routes/gateway-budget-integration.test.ts` | unbounded hard request rejected before HTTP |
| Parallel requests cross a budget boundary | `kun/src/services/gateway-token-budget.test.ts` | atomic reservation prevents parallel overspend |
| Upstream ends without usage | `kun/src/services/gateway-token-budget.test.ts` | sent unknown usage remains pending across restart |
| A retry needs an additional reservation | `kun/src/server/routes/gateway-budget-integration.test.ts` | each actual attempt has distinct reservation before dispatch |
| A gateway request fails over after billable work | `kun/src/adapters/model/request-attempt-accounting.test.ts` | abandoned billed attempts counted, response context usage separate |
| Enable the local gateway | `kun/src/server/provider-gateway-release-boundary.test.ts` | non-loopback activation rejected; no automatic CORS exposure |

## ade-gateway-consumption

| Scenario | Executed evidence | Assertion |
| --- | --- | --- |
| Select a gateway alias for an Agent | `src/shared/harness-enablement.test.ts` | exact profile/native login/gateway readiness remain independent |
| Route expands while a worker is running | `kun/src/harness/gateway-alias-binding.test.ts` | grant freezes approved target scope through reissue/resume |
| Missing small-model route | `kun/src/harness/gateway-alias-env.test.ts` | main/small remain authorized; absent small explicitly uses main |
| External client supplies a thread identifier | `kun/src/server/routes/openai-model-gateway.test.ts` | trusted grant controls actual thread accounting, public kun/ addressing denied |
| Apply a project-local profile | `src/main/services/gateway-launch-profile-service.test.ts` | owned project-local preview/apply/restore never imports native credentials |
| File edited after preview | `src/main/services/gateway-launch-profile-service.test.ts` | file edits after preview preserve user bytes on apply/restore failure |
| Switch from native login to gateway | `kun/src/runtime/acp/acp-credential-env.test.ts` | session credential identity and isolated homes pin accepted binding |
| Claim support for a client protocol | `scripts/smoke-model-gateway-clients.mjs` | four pinned real CLIs, text/tool/cancel; explicit main/small behavior |

## Ten client workflow samples

| # | Workflow | Executed evidence |
| --- | --- | --- |
| 1 | Three same-template accounts; rotate the second; restart preserves all IDs | `provider-client-workflows.release.test.ts`: three protected keys, rename/regroup, real HTTP discovery, new Registry instance |
| 2 | Custom Chat/Messages endpoints, proxy/full URL contract across consumers | `model-utility.test.ts`, `model-connection-registry.proxy.test.ts`, `runtime-model-requests.test.ts`, one-shot/inline/scheduled detector fixtures and three-protocol conformance |
| 3 | First target 429 before output; second succeeds; both attempts retained | `route-pool-model-client.test.ts`, `gateway-dispatch-fence.test.ts`, `request-attempt-accounting.test.ts` |
| 4 | Tool arguments then transport failure never repeat on another provider | `route-snapshot.release.test.ts`, `gateway-serial-tools.test.ts`, `gateway-protocol-conformance.test.ts` |
| 5 | Client permits alias + X; adding Y never grants Y | `gateway-client-policy.test.ts`, `route-pool-gateway-safety.test.ts` |
| 6 | Worker main/small aliases, model-only short grant, independent tools | `gateway-alias-binding.test.ts`, `gateway-alias-env.test.ts`, `harness-token-service.test.ts` |
| 7 | Four real clients keep the alias/config while the next request uses new account | fixed-client smoke uses actual `RoutePoolModelClient`; reports assert `offline -> offline-next` with unchanged config |
| 8 | Model credential sent to management routes denied, no mutation | `provider-gateway-release-boundary.test.ts`, `gateway-clients.test.ts`, actual node HTTP plus strict insecure-mode checks |
| 9 | Failed import, concurrent edits, crash recovery and downgrade retain data/keys | `provider-configuration-recovery.test.ts`, credential-fence/recovery/migration tests, reference and AppSettings media fixtures |
| 10 | No CLI available; save provider, real directory refresh, native materialization | `provider-client-workflows.release.test.ts` explicitly empties PATH while configuring three accounts and querying the fake HTTP catalog |

These workflows are tested at their actual service, HTTP, renderer contract and
client boundaries. They are not described as ten manual end-to-end GUI sessions.
Cross-client compatibility and packaged process lifecycle use real binaries;
crash/paid-attempt/migration failures use deterministic isolated fixtures.

## UI acceptance

The account workspace was rendered with 500 accounts. It displays 50 rows per
page, finds `account-499`, and advances to a second page beginning at account-50.
Keyboard Tab moves from search to group selection. Light 1280px and dark 620px
checks report document scrollWidth equal to viewport width, with no horizontal
overflow. Renderer component fixtures cover locale text, scope selectors,
configuration fields and legacy selection. This is focused settings QA rather
than a claim about every application surface or unlimited list sizes.

## Integrated gates

Complete build, final Runtime/Main resource update, strict packaging, 13/13
packaged official-client scenarios and actual GUI lifecycle passed. Final
repository typecheck passed. Desktop regression passed 1,712 files / 12,110 tests
with 89 existing optional skips. Lint passed with zero errors and 35 existing
warnings; the 700-line gate and diff whitespace check passed. Runtime regression passed 1,254 files / 9,756 tests with six existing optional
skips; no failures remain in either full regression. Earlier runs
with concurrent builds or the wrong SQLite ABI are not counted as passing runs.

Previously reproduced fixture failures were repaired without relaxing production
checks: canonical temporary paths satisfy GWS provenance; Antigravity fixtures
use the current resumable JSON conversation contract; unsafe legacy binaries
remain uncopied even when another installed CLI is discovered; retired engines
are represented by an explicit availability fact; startup drafts and waiting
UI remain separate from ready footer controls; browser storage is isolated from
Node 25 globals. The four former Runtime failure files now pass 42 tests, three
UI files plus the shared capability fixture pass 29, and Workbench discovery
passes 17. No test is deleted or skipped to obtain these results.


Final regression logs: `/tmp/kun-provider-final-runtime-green.log`,
`/tmp/kun-provider-complete-desktop-tests.log`,
`/tmp/kun-provider-fully-final-typecheck.log` and
`/tmp/kun-provider-delivery-final-lint.log`. The last budget observer fixture
was rechecked after its lint fix (five tests passed). A question callback fixture
now waits for both persisted question and queued notice, matching the existing
asynchronous publication order rather than relying on an I/O race.

Acceptance scope is P0–P4 local text/model gateway work. All 75 tasks are
complete; the separate P5 proposal is not implemented or activated. Actual user
data was not migrated and no paid upstream inference was performed by these
checks. The macOS fixture package is unsigned and isolated from the user's app.
