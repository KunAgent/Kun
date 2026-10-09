# Supported Agent integrations

The curated product inventory covers 42 coding-agent products. Kun, OpenCode2 and
the dedicated Cursor CLI entry remain additional integrations. All delegated
conversation turns enter the same Kun runtime; interactive-only CLIs use its
owned terminal workflow. Applications retain their native client interface.

## Product coverage

| Product | Stable Kun ID | Interaction |
| --- | --- | --- |
| Claude Code | `claude-code` | Conversation |
| Claude Desktop | `claude-desktop` | Application / configuration |
| Codex | `codex` | Conversation |
| Antigravity CLI | `antigravity` | Conversation |
| OpenCode | `opencode` | Conversation |
| CodeMaker | `codemaker` | Conversation |
| OpenChamber | `openchamber` | Application / configuration |
| MiMo Code | `mimocode` | Conversation |
| Pi | `pi` | Conversation |
| Aside | `aside` | Native terminal |
| OmO | `omo` | Native terminal |
| Goose | `goose` | Conversation |
| Cursor | `cursor` | Conversation |
| Cursor Private Inference | `cursor-local` | Application / configuration |
| Zed | `zed` | Application / configuration |
| VS Code | `vscode` | Application / configuration |
| JetBrains Air | `air` | Application / configuration |
| Copilot CLI | `copilot` | Conversation |
| Crush | `crush` | Native terminal |
| DeepSeek Harness | `deepseek-harness` | Conversation |
| Command Code | `commandcode` | Native terminal |
| fx | `fx` | Conversation |
| omp | `omp` | Conversation |
| Devin | `devin` | Conversation |
| Hermes Agent | `hermes` | Conversation |
| Mister Morph | `morph` | Native terminal |
| Kimi Code | `kimi` | Conversation |
| Muse Code | `muse` | Native terminal |
| Empryo | `empryo` | Native terminal |
| MiniMax Code | `minimax-code` | Conversation |
| Droid | `droid` | Conversation |
| Cline | `cline` | Conversation |
| Qoder | `qoder` | Conversation |
| Qoder CN | `qoder-cn` | Conversation |
| Grok Build | `grok` | Conversation |
| ZCode | `zcode` | Application / configuration |
| WorkBuddy | `workbuddy` | Application / configuration |
| Pencil | `pencil` | Application / configuration |
| T3 Code | `t3code` | Application / configuration |
| OpenHanako | `hanako` | Application / configuration |
| AtomCode | `atomcode` | Native terminal |
| Alma | `alma` | Application / configuration |
| Cindy | `cindy` | Application / configuration |

Cursor CLI is separately available as `cursor-cli`; it uses the official
`agent acp` transport while `cursor` retains its existing SDK connection.

## Onboarding

The Agent Center supports search and All/Chat/Terminal/Apps filters. A protocol
CLI must be installed and explicitly checked and enabled for its selected profile.
A successful protocol handshake is not proof of account entitlement or quota.
Known local credential formats establish configured evidence; official account
queries can establish authenticated evidence. CLI sign-in remains in the native
client. Unsupported or expired credential stores show a sign-in requirement.

Terminal entries have a separate readiness proof and Open terminal action. They
do not enter the chat picker. Runtime pins their command and launch arguments;
Main validates the exact launch reservation before releasing the owned PTY.
These sessions remain native interactive terminals, without invented automatic
session resume or transcript conversion.

Applications show detected installation and configuration paths independently.
Users can open existing settings in their chosen editor, read official instructions
or open the installed client. A manual application path handles nonstandard
installations. Third-party settings are not rewritten automatically.

## Protocol differences

- Gemini CLI is no longer a built-in Agent: Google blocks its ACP sessions for
  individual accounts. Stale `gemini-cli` ids in saved settings are ignored. The
  Gemini CLI OAuth *model provider* is a separate feature and is unchanged.
- Kimi Code requires the maintained 2.x client; retired CLI credentials are not
  silently treated as the new account.
- MiniMax selects its permission configuration separately from interaction modes.
- Newly added ACP integrations use a connection per thread and workspace; a
  second thread cannot replace another active session or process-wide permission
  selection. Follow-up turns reuse the native session within that connection.
- Cursor CLI validates the resolved executable identity; a similarly named Grok
  alias is not dispatched as Cursor. `qoder` is also the Qoder desktop IDE's shell
  launcher, so Qoder resolves `qodercli` first (the npm package and the official
  installer both provide it) and treats `qoder` only as an alias that is skipped
  when it points at the IDE. Every fallback (launch, login hint, update) uses
  `qodercli`/`qoderclicn`, never the bare IDE-colliding name.
- Grok Build reports a turn's usage in the `session/prompt` result's `_meta.usage`
  (not the standard `usage` field); Kun reads it through the provider's
  `acp.promptResultUsage` hook. Its cost figure is list value on a subscription
  login, so only token counts are recorded.
- Droid bootstrap discovery reads publisher package metadata where available;
  it does not execute a self-updating version probe.
- fx Keychain login is identified with its prompt-free status command. It is
  configured evidence only; expired and unknown status cannot enable a profile.
- All ACP controls use declared IDs/aliases and validate echoed values. An
  unsupported selection fails before sending a user prompt.
- Native resume is negotiated from each client. Where a client cannot restore
  a session, the existing explicit context reconstruction remains the fallback.
- OpenCode and OpenCode2 publish their primary agents (build, plan and
  user-defined agents) as ACP session modes. The composer shows an Agent switch
  next to the model control; Auto keeps the permission-mapped mode, and a picked
  Agent is sent as the turn's `harnessAgentId` and applied with
  `session/set_mode` before the prompt. A picked Agent runs under its own tool
  permissions; read-only and unattended turns still use the strictest mode, and
  an Agent the session does not offer fails before any prompt is sent.
  OpenCode 1.18 reports these modes only as the `mode` config option; Kun reads
  either shape. When a plugin replaces build/plan with its own Agents, readiness
  still passes, Auto turns fail closed, and the user picks one of those Agents.
- OpenCode and OpenCode2 declare `loginOptional`: they ship free models, so a
  session that opens without auth_required is usable without a local credential
  (authentication stays unverified). OpenCode2 may create the shared
  `opencode.db` without OpenCode's `session` table; OpenCode then refuses to
  start and readiness tells the user to move that file aside.
- CodeMaker is an OpenCode fork and derives its definition from OpenCode's
  (`kun/src/harness/codemaker-harness.ts`): same ACP server, modes,
  `opencode.json` names and `OPENCODE_*` overrides under the `codemaker` XDG
  directories. It differs in three places: login is required (ACP
  `authenticate` is a no-op there; credentials come from `codemaker auth
  login` or `CODEMAKER_AUTH_TOKEN` / `CODEMAKER_AUTH_KEY` / `CODEMAKER_API_KEY`),
  Kun does not offer `fs/write_text_file` so every write stays behind
  CodeMaker's restricted-file policy (`acpClientWrites: false`), and there is
  no installer or history reader.

## Installation and updates

Installer and update commands are curated from official publisher documentation.
Scanning never installs or signs in an Agent. A user-started managed update stages
and verifies a replacement before selecting it. Application-owned executables
stay with their native updater. Unknown release channels remain unknown.
npm installs use the official registry, like managed updates: mirrors can lag
behind prerelease platform packages.

## Validation

Contract and protocol fixtures cover the complete catalog, permission negotiation,
credential separation, multi-turn connection reuse, application detection and
opening, and terminal launch fences. Local checks use installed clients without
sending an inference prompt. Paid-account and platform checks depend on the
clients and accounts available on the validation host.

On the macOS validation host, an isolated official Droid 0.233.0 package reached
ACP initialization and reported its native sign-in requirement without sending a
prompt. The existing standalone Droid bootstrap timed out during initialization.
Kimi 0.29.0 was correctly classified as requiring the maintained 2.x update;
Grok 1.0.5 reported missing authentication. Cursor/Grok command collisions and
Qoder desktop launchers were rejected as invalid protocol executables. The
application workflow detected and opened the installed VS Code client. These
checks do not claim paid inference coverage for every product or other platforms.
