# Sidebar pinning and private chat streaming

The Grok Bot documentation (<https://docs.x.ai/grok-bot/bots>) confirms that pinning
keeps a Bot at the top of the sidebar. The public marketing demo did not expose a
repeatable pin action, so Kun's animation timing is an implementation choice,
not a claim about Grok Bot's internal code.

Local Cumora references: `src/stores/messages.ts` separates streaming messages
from committed messages, `src/components/Message.tsx` memoizes message rows, and
`src/api/client.ts` deduplicates its shared connection. These are the relevant
ideas adopted here; Kun continues using its existing HTTP/SSE and single Runtime.

## Pinning

- Update the list immediately while persistence proceeds through the existing
  room API. Keep one writer per entry; rapid toggles coalesce to the final intent.
- Keep the optimistic state over stale event refreshes. Only a query begun after
  the save can retire it. Failed writes roll back that entry independently.
- Share the server's activity sequence and ordering rules, including conversations
  with no messages. Existing servers remain compatible with the optional field.
- Animate mounted rows with a 240ms compositor transform, reusing their stable
  identities. Preserve the visible anchor in a virtualized list and keep the
  selected conversation and composer draft intact. Reduced-motion skips animation.

## Streaming

Previously the direct runner projected text to a room message on its roughly
one-second scheduling tick. The GUI then waited for invalidation and another GET.
The new `run.text` event extends the existing room-run SSE stream, delivering a
bounded presentation snapshot directly from the native event bus, coalesced at
40ms. The renderer batches it to animation frames within the timeline subtree.
Unchanged historical message rows retain their references and skip rendering.

The authoritative message still uses the existing publication transaction. Live
text does not create messages, unread activity, Agent wakeups, memory captures or
model calls. Only private `conversation` runs expose this feed; group drafts keep
their existing publication rules. Room/member/thread/turn identity is verified
before subscribing. Cancellation is checked before each emission, and closing
or switching conversations disposes the subscription.

Hydration honors `replayAfterSeq` from live item checkpoints and reads bounded
persisted event pages to close the snapshot/subscription gap. Production does
not retain a bus replay tail, so the implementation must not depend on one.
UTF-16 delta offsets suppress duplicate fragments after hydration/reconnect.
The latest live text remains visible across turn completion until the canonical
final message arrives, avoiding a brief rewind to a stale persisted draft.

Snapshots are capped at 64,000 characters; item and event hydration use bounded
pages and iteration limits. Slow consumers receive coalesced latest state rather
than an unbounded token backlog. Existing canonical message refresh remains the
fallback for unavailable streams and old runtimes.

## Validation

`node scripts/smoke-development-direct-chat.cjs --pin-stream --evidence <directory>`
uses an isolated real Electron/preload/main/Manager/Runtime and a model-only local
fixture. It creates conversations through the UI and verifies:

- Immediate pinning despite an artificial 700ms save delay, with active movement
  animations, persisted pin state and no conversation/draft change.
- 100 model fragments at 40ms intervals, exact final text, no rewinds, typing
  responsiveness and renderer reload during a second stream without duplicates.
- More than 60 conversations, virtual-list anchor preservation and reduced motion.

The final pre-merge measurement reported 28ms pin feedback, 53 visible updates
across the four-second stream, 106ms first-text lag and 120ms p95 update spacing.
The input-event-to-frame p95 was approximately 8ms. These are isolated fixture
measurements, not latency guarantees for an upstream model service.

Related tests cover optimistic rollback, stale query receipts, rapid toggles,
offset-aware replay, bounded buffers, authoritative final-message precedence,
durable replay without a bus tail, and cancellation without additional execution.
Build, Typecheck, relevant tests, lint and the 700-line gate are recorded with the
screenshots under the main repository's ignored `dist/rooms-pin-stream` directory.

Final checks: 422 related runtime tests and 122 Rooms UI tests passed across the
runs. Eight Git-heavy cases hit the default five-second timeout during concurrent
host load; the affected three suites were rerun serially with a 20-second timeout
and all 32 cases passed. Full lint reported zero errors and 30 existing warnings.
