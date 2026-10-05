# Devin CLI integration

Kun registers `devin` as a builtin ACP harness. The local process is
`devin acp`, owned by `kun serve`, and uses the existing HTTP/SSE turn,
permission, cancellation, session binding, model probe, and activity paths.
There is no second runtime and no Claude SDK compatibility assumption.

## Verified upstream contract

The following official sources were checked on 2026-09-30:

- [Devin's Zed integration](https://docs.devin.ai/cli/acp/zed) documents
  JSON-RPC over stdio and editor-hosted ACP sessions.
- [Commands and flags](https://docs.devin.ai/cli/reference/commands) documents
  `devin acp`, `devin auth login`, and the local CLI's account behavior.
- [The ACP registry definition](https://github.com/agentclientprotocol/registry/blob/main/devin/agent.json)
  launches the official binary with the `acp` argument on each platform.
- [Permissions](https://docs.devin.ai/cli/reference/permissions) distinguishes
  Normal, Accept Edits, Bypass, and sandboxed execution in the CLI. ACP mode
  identifiers must come from the installed session's advertised options.
- [ACP authentication](https://agentclientprotocol.com/protocol/v1/authentication)
  defines `authMethods` as available login choices, not current login state.
  A session operation can explicitly reject with `auth_required`.
- [ACP v0.9.1 unstable schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/v0.9.1/schema/schema.unstable.json)
  defines legacy `models.availableModels` and the `session/set_model` request.
  The pinned SDK still recognizes the method as session-scoped.
- [Registry artwork](https://github.com/agentclientprotocol/registry/blob/main/devin/icon.svg)
  supplies the bundled, theme-colored SVG mark.

The reference terminal implementation uses an interactive TUI and lifecycle
hooks. Current Devin CLI has a documented structured protocol, so Kun uses
that protocol directly. No user or workspace hook files are modified.

## Permission and account boundaries

- The installed CLI must pass version detection and ACP initialization.
  The desktop editor launcher is not a CLI candidate and is never opened.
- Only native login is supported. Installation and login commands are UI
  hints; probes never install, authenticate, or send a model prompt.
- Models come from session configuration. The catalog does not invent a model
  list or infer enterprise/Windsurf endpoints; existing environment settings
  continue to control outbound requests.
- A selected model is applied through modern model config options first, or
  legacy `session/set_model` when that is the advertised selector. Unknown
  models and rejected selectors fail before prompting; an explicit selection
  never silently runs the default model. No selection keeps the Agent default.
- A nonempty `authMethods` list does not block session creation or model
  discovery. A real authentication error shows a CLI login instruction.
- Before every new or resumed Devin session receives a prompt, its requested
  permission mode must be advertised and selected. CLI 3000.11.3 advertises
  `ask`, `accept-edits` and `bypass`, without `normal`. Legacy `normal`/`auto`
  may fall back to the narrower read-only `ask`; `ask` never widens to Normal.
  A conflicting config response or unsupported mode fails before prompting.
  Without a native override, Kun maps the captured composer permission to a
  supported mode. A saved Bypass preference cannot exceed the host ceiling.
  Writable approval-gated turns negotiate legacy Normal and may narrow to Ask;
  read-only or restricted unattended turns request Ask and never widen to Normal.
- Accept Edits and Bypass require Kun's full-access permission level. No
  `--respect-workspace-trust false` or implicit permission bypass is injected.
- ACP alone does not prove OS sandboxing. The catalog reports `sandbox: none`,
  so worker admission requires the existing isolated-workspace path.
- Native resume depends on `loadSession` from the installed agent; the existing
  portable handoff remains the fallback when native history is unavailable.

## Validation

Synthetic ACP fixtures cover advertised authentication with an existing login,
model discovery without a prompt, modern and legacy model application, streamed completion, native resume,
permission restoration, rejected mode selection, and authentication errors.
They are protocol regression tests, not recorded Devin production traffic.

On 2026-10-05, CLI 3000.11.3 completed a user-authorized native-login text turn
through an isolated Kun HTTP runtime and returned the expected marker. Its
actual session metadata was used to validate the new permission mapping.
This proves the tested account/model text path; native resume, every model,
and tool execution still require their separate regression/scenario coverage.
Use `scripts/smoke-native-agent-turns.mjs --run --agents devin` for an explicit
real-account check; local readiness alone does not consume model quota.
