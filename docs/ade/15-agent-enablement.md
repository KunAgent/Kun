# Explicit external-agent enablement

This contract describes explicit external-agent enablement and its acceptance
criteria. Local readiness, offline UI evidence and real-account validation are
separate forms of evidence.

## Product contract

- Kun stays available as the bundled runtime. Every external harness and
  credential profile requires an explicit opt-in before a new task can use it.
- The composer lists only enabled, currently usable profiles. Settings remains
  the place to discover, configure, check, enable and disable external agents.
- Remove Gemini CLI from new selections without deleting its stored histories.
  Existing history, stop and approval controls remain reachable.
- Promote Pi's existing RPC integration. Add the official DeepSeek Harness ACP
  integration as Preview, pinned to the reviewed `0.2.0-rc.2` protocol release.
- Keep Claude Code, Codex and OpenCode native-login and Kun-gateway profiles
  distinct. Enabling one profile never silently enables another.

## Readiness and lifecycle

An enable action performs a bounded, cancellable, non-inference check of the
selected installation, protocol, model configuration and available credential
evidence. A missing binary, unsupported version, failed handshake or unusable
profile leaves the agent disabled and gives the user a specific next step.

Local credentials and a successful protocol handshake do not establish remote
authentication, account entitlement, balance or quota. In particular, a no-op
ACP `authenticate` response must never be described as authenticated. Real
account requests, login flows and paid inference are separate explicit actions.

Check results are bound to the exact profile, effective configuration,
credentials and executable. Editing, switching, disabling, cancelling or closing
while a check is running invalidates its result. A later response cannot turn
an agent back on. Configuration and credential rotation invalidate readiness;
the final launch boundary revalidates before reusing or spawning a process.

Runtime admission enforces the same rule as the composer, including legacy
provider inference, delegated tasks and router-disabled fallback paths. A hidden
or disabled option is not permission to invoke that agent through another API.

ACP checks also create a temporary empty session and validate an explicit
model and Devin's permission selector. An initialize-only success cannot hide
a failed session configuration. The probe never sends a prompt and reclaims
its process and temporary workspace. Codex session setup explicitly uses the
read-only sandbox; each turn then receives its authorized sandbox. This avoids
inheriting a native writable default and triggering project-trust writes during
setup, which would invalidate the configuration proof before the first turn.

## Real native-account smoke

`node scripts/smoke-native-agent-turns.mjs --run` sends one tiny real prompt per
selected Agent through Kun's HTTP thread and turn APIs. It uses existing native
logins, an isolated Manager/Runtime and empty temporary workspaces. It can
consume subscription/API quota; it is never part of automatic enablement.
Use `--agents devin,codex,opencode,deepseek-harness,claude-code` to choose targets.
`KUN_SMOKE_NATIVE_PROXY` supplies the desktop's resolved HTTP proxy for native
Codex/Claude requests when running this script outside Electron. Explicit
`KUN_SMOKE_*_BINARY` paths override discovery. Reports under
`dist/native-agent-turns/` retain separate runs and contain sanitized outcomes.

The smoke checks terminal completion and actual assistant output, not only
protocol metadata. It does not cover every model, tool, quota, resume or fork
scenario. Settings trial requests use the selected readiness route, including
its native default model, instead of picking the first model in a catalog.
Trial preflight also uses that same credential route; a gateway trial must not
start an extra native-profile probe or require a separate native account.

## Antigravity native account

The explicit `antigravity` native-login route is independent of a Kun model
provider. Its default-model sentinel leaves model choice to `agy`; named
provider connections remain restricted to the Antigravity provider kind.
On macOS, readiness checks attributes of the native Keychain entry only
(`gemini` service, `antigravity` account), without retrieving its password.
Native `antigravity-oauth-token` files are bounded, read-only credential
evidence. Both are configured evidence, never proof of remote authentication.
Removal or replacement invalidates the process-local readiness proof.

Desktop system proxy policy reaches both the non-inference `models` probe and
actual CLI turns. Explicit environment settings keep priority; local Kun
services retain loopback proxy bypass. The current official Unix bootstrap
does not accept the old `--skip-aliases` argument.

## DeepSeek Harness privacy

The official harness is a separate agent lifecycle, not a DeepSeek model preset.
Detection, readiness and execution must apply both official telemetry controls:
the telemetry-disable environment variable and a final configuration patch that
disables session logging, OpenTelemetry and hot-reload telemetry hooks. Custom
plugin/profile composition that cannot preserve this guarantee fails closed.

## Required evidence before completion

- Fresh typecheck, lint, file-size gate and relevant unit/integration tests
- Adversarial cancellation, stale-result, profile-switch and disabled-fallback
  regression tests
- Native macOS and Windows offline fixture runs of the production settings and
  composer components, with screenshots at small widths and high display scale
- Required CI and platform packages for the published final head

Offline fixtures verify UI and lifecycle behavior. They must be labelled as
fixtures and must not be presented as real provider/account authentication.
