# Independent Agents

An Agent is a durable participant identity, distinct from a capability preset
and a conversation. All work still uses the single Kun Runtime, native turn
queue, existing task pipeline and Manager-owned storage.

## Profiles and conversations

The directory supports creation, model and capability configuration, portraits,
duplication, archive and restore. Default coordinator, developer and reviewer
templates include responsibilities, expected evidence and deliverables.
Duplicating copies configuration, not memory or conversation history.

Room members reference participantAgentId and retain their local role,
instructions and repository permissions. Existing thread agentId continues to
identify the capability preset. Accepted work snapshots its effective profile;
editing a profile does not rewrite an active task.

Conversation kinds are group, user_agent and agent_agent. A user has one private
conversation per Agent. An order-independent Agent pair has one collaboration
transcript. Model sessions remain isolated per scoped handoff, even when their
messages appear in the same pair transcript.

Old members migrate individually using stable room/member keys. Matching names,
portraits or presets do not cause identities to be merged. Migration preserves
pending execution snapshots, does not replay messages and does not automatically
extract old history.

## Memory ownership

Agent memories share the existing canonical JSON and rebuildable SQLite memory
repository. The versioned agentContext extension records the owner, source
conversation, optional task/handoff scope, explicit sharing and user protection.
Legacy memories remain separate and are not automatically injected into Agents.

Agent memory has its own feature policy. It does not require enabling Code's
general memory setting and does not modify that setting.

Ownership checks apply before FTS ranking and pagination, and to direct-ID
reads, edits, deletion, purge, all-record listing and filesystem fallback.
Normal Code memory requests cannot read Agent-owned records.

Automatic extraction consumes complete attributed messages and task/review
evidence, not stream fragments or generated system prompts. It uses the small
model when configured and otherwise the effective Agent model. There is one
background extraction at a time, at most eight candidates per call and at most
two calls per Agent and source work generation, including retries.

Source events and processing state are durable. Failed work is retained and
ordinary deferred conversation sources can be coalesced into a later explicit
request in the same conversation. Memory runs record their input and usage, and
memory writes do not wake a discussion.

Memories remain in their source scope unless the user explicitly shares them.
Only a preference can be marked universal for the Agent. Task-only participants
receive task-scoped memory; private handoff evidence does not become available
to unrelated handoffs.

Memory is always reference data. It cannot change tool policy, repository
access, approval requirements or execution authorization.

The memory page supports source inspection, correction, protection, disable,
restore, forgetting and explicit conversation/project sharing. Conflicting
updates remain reviewable candidates. Accepting a candidate produces a new
version and retains its predecessor.

User edits have a durable intent and a canonical operation marker. Lost
acknowledgements are recovered without applying the edit twice. Forgotten
records are excluded from retrieval, and replay does not resurrect a tombstone.

## Collaboration and execution

The host binds the sender, target, source work, evidence, permissions and budget.
Agents may contact common group members or Agents explicitly designated by the
user, including a configured reviewer. Plain text mentions do not grant access.

The collaboration tools list permitted peers, request read-only assistance and
inspect a durable handle. Accepted requests are asynchronous and are not resent
after a timeout. Child requests inherit the original scope and cannot expand
the evidence they were given.

Each handoff has a distinct model context. Child results wake a fresh parent
response rather than changing a response already in progress. Reply publication
atomically records the pair message, exact run, source notification and
acknowledgement. Source notices are not presented as fabricated model replies.

Handoffs share the original topic's 32-response and eight-response per-Agent
limits; participation checks retain the 128-check limit. New pair chats and
child handoffs do not reset these limits. Unknown executions retain their
discussion lanes until their original execution can be reconciled.

Global Agent discussion lanes allow at most one discussion per participant,
separately from task execution. User-directed work receives two admission
opportunities before a waiting peer opportunity; running work is not preempted.
Stopping source work invalidates queued and late handoff results.

Private-chat code work uses existing task creation, approvals, validation,
review, immutable delivery and apply. An explicitly selected external owner
or configured reviewer receives only task evidence and is not automatically
added to the source private conversation. Existing task ownership remains fixed.

## Desktop and contracts

The Rooms sidebar separates Agents, groups and collaboration transcripts.
Agent details provide profile, conversations, memory and exact run history.
Pair transcripts are read-only for user sends; further work is requested from
the originating conversation. Each conversation retains its own draft and
reading position.

Public routes include:

- /v1/agents: directory and profile lifecycle.
- /v1/agents/:id/conversation: idempotent private-chat opening.
- /v1/agents/:id/conversations and /runs: bounded history and exact targets.
- /v1/agents/:id/memories, /memory-candidates and /memory-work: memory management.
- /v1/agent-handoffs: scoped creation, inspection, cancellation and retries.
- /v1/agents/features: independent private-chat, memory and collaboration flags.

The existing HTTP/SSE and window.kunGui bridge carry these contracts. Identity,
handoff, budget and extraction-journal writes use the Manager fence.
Capability negotiation requires agent-identities-v1. Legacy room-list callers
continue to receive groups unless they request another conversation kind.

Feature switches preserve records. Existing code tasks retain their separate
lifecycle and stop controls.

## Validation

The offline Electron scenario uses a real Manager and Runtime, a local model
fixture and an isolated profile:

```sh
npm run typecheck
npm run build
node scripts/smoke-development-rooms.cjs --agents-only --evidence dist/independent-agents-smoke
node scripts/smoke-development-rooms.cjs --ui-visual --evidence dist/independent-agents-full-smoke
npm run check:file-lines
```

When native dependencies use the Electron ABI, run Vitest through Electron with
ELECTRON_RUN_AS_NODE=1. Do not rebuild Runtime output or edit renderer sources
during a running desktop scenario.

This change does not add cloud computers, another execution engine, multi-user
accounts, recurring Agent routines or automatic skill creation.

Acceptance completed on 2026-09-13 against local develop including the OpenCode,
Claude Code and Codex history-reference changes:

- Full typecheck, Kun build, desktop build, scoped ESLint and the file-line gate passed.
- Runtime and memory suites passed 576 tests in 85 files.
- Renderer and bridge suites passed 170 tests in 22 files.
- The combined Agent, task, peer, conversation-experience and visual Electron
  scenario passed with 81 captures and no page errors.
- Native queue tests cover external private-task owners/reviewers, private
  evidence isolation, shared response limits and original-execution recovery.
- Desktop checks cover explicit memory sharing and correction, forgetting,
  pair conversations, exact run links, archive/restore and independent feature
  switches without unintended model execution from read-only views.
