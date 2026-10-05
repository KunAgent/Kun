# OpenCode2 Agent

Kun exposes OpenCode 2 beta as the independent `opencode2` preview harness.
Its executable is `opencode2`, installed from `@opencode-ai/cli@next`; it does
not fall back to the OpenCode V1 `opencode` executable.

Use Settings -> Assistant -> Agent connections -> OpenCode2. The existing
install action installs the official CLI. Login runs
`opencode2 auth login --standalone`; the private server exits with the CLI.
Check and enable verifies the selected binary, native credentials, and ACP
protocol before the profile becomes selectable in the composer.

## Supported connection

- Native login only. V2 credentials live in the `credential` table of
  `$XDG_DATA_HOME/opencode/opencode.db` (default `~/.local/share/opencode`),
  with `OPENCODE_DB` overriding the filename or absolute path.
- Credential inspection uses a bounded read-only SQLite transaction, including
  current WAL contents. It never initializes, migrates, or writes the database.
  Credential values enter only an internal fingerprint, never UI results/logs.
- Configured credentials are reported as unverified authentication. Readiness
  does not send prompts or test quota, payment, or future model access.
- `opencode2 acp` runs through Kun's existing managed ACP transport, permission
  mediation, session handling, cancellation, and native model/config selectors.
- V1 and V2 settings, binary overrides, defaults, and enablement remain separate.
  V1 history sources and gateway templates are not applied to V2.

## Validation and compatibility

Official CLI `0.0.0-beta-17823` was installed in a temporary directory and
validated with isolated XDG data/config/cache/state paths. Its ACP initialize
and session model discovery pass without a model prompt. The CLI's actual
credential schema matches the read-only adapter.

The same release subsequently completed a user-authorized native-login text
turn through Kun's HTTP thread/turn APIs on 2026-10-05. The official CLI's
`auth list --standalone` discovered the existing local credentials; Kun itself
does not copy V1 authentication files or synthesize a logged-in state.

Keep preview status while the upstream beta evolves. An unsupported schema,
missing login, incompatible plugin, or failed protocol check remains actionable
in Agent Center and cannot silently enable the Agent.

References:

- https://dev.opencode.ai/v2/docs/
- https://dev.opencode.ai/v2/docs/migrate-v1/
- https://github.com/anomalyco/opencode/tree/v2/packages/cli/src/acp
- https://github.com/anomalyco/opencode/blob/v2/packages/core/src/credential/sql.ts
