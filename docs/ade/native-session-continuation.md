# Native session continuation

Kun binds each delegated thread to the provider's native conversation. Ordinary
follow-up turns append the latest user input to that conversation. Kun's timeline
is the UI/audit record and recovery source; it is not replayed on every prompt.

| Transport | Live follow-up | After process/runtime restart |
| --- | --- | --- |
| Codex app-server | `turn/start` on the same thread ID | `thread/resume` with the saved ID |
| ACP (Devin, OpenCode, OpenCode2) | `session/prompt` on the same session ID | `session/load` when advertised |
| ACP without loading (current DSH) | Same live session, no `session/new` per turn | One explicit recovery handoff when native state is unavailable |
| Claude Agent SDK | SDK `resume` with the saved session ID | Same saved session ID |
| Cursor SDK | Resume the saved native agent handle | Persisted SDK store and native handle |
| Pi RPC | Prompt the current native session | `switch_session` with the saved file |
| Antigravity CLI | `--conversation` with the returned `conversation_id` | Same explicit conversation ID; never global `--continue` |

ACP `loadSession` describes restoration capability, not whether a live session
can accept another prompt. Loading is needed on reconnect, not before every
prompt. Loading replay is filtered out of the existing Kun timeline.
See the [ACP session lifecycle](https://agentclientprotocol.com/protocol/v1/session-setup).

Stable host instruction snapshots are hashed separately from conversation
history. Unchanged instructions are not repeated in user messages; changes
replace the prior snapshot. Codex receives stable host context through its
native `developerInstructions` field. Request-local persona and host controls
are always sent with their current turn, outside that native system prefix.
Dynamic attachments and new user input also travel with their current turn.

A live ACP session retains its MCP descriptor. Its bearer is active only during
an admitted turn, with an exact turn ID on the grant. Each activation replaces
the grant object; delayed requests cannot inherit a later turn's authority.
Different native sessions use different opaque descriptor identities. Credentials
are never written to session bindings. Tool execution still passes through Kun's
approval, sandbox and current tool-catalog gates.

History handoff is reserved for first attachment to an existing conversation,
actual Agent switching (including missed-turn deltas when switching back), or
unavailable/incompatible native state. Model/credential/workspace capability
changes still follow the coordinator's route compatibility checks. A failed
native prompt is never blindly retried, to avoid duplicate tool side effects.

Validation: protocol tests assert session/new/load counts, exact follow-up input,
instruction updates, persisted IDs, permission renewal and thread isolation.
`scripts/smoke-native-agent-turns.mjs --run --turns 3 --tools` exercises real
native accounts and checks ID equality, memory and file reads. Add
`--restart-after 1` for disk-backed restoration; live-only ACP agents cannot
promise ID continuity across a process restart.

## History identity (2026-10-06)

Consecutive turns with the same Agent must keep one native session. Two
real-thread failures forced a `history_changed` rebase and a full brief to the
same Devin session:

- A message queued while the previous turn streamed is persisted before that
  turn's reply, so raw item order interleaves turns. Commit and prepare now use
  turn-ordered history (`historyThroughDelegatedTurn` /
  `priorItemsForDelegatedTurn`): a committed history is an exact prefix of
  every later turn's prior history, and queued later turns are never history.
- An aborted turn settles after commit (a pending question becomes
  `cancelled`, tool rows finalize). The history digest now covers
  conversational identity only (item id, turn, kind, user text, goal key), so
  status and payload finalization no longer look like edited history. Edited
  user text, removed or forked items and interleaved turns still rebase.

A genuine same-Agent rebase is labeled as a restored session, not a hand-off
to another Agent, and uses the Agent's display name.
