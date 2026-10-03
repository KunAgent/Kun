# Explicit external-agent enablement

This change is being implemented in a draft pull request. The contract below
describes the acceptance criteria; it is not evidence that a real account or
native application has passed validation.

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
