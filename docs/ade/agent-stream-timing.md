# Agent stream timing (TTFT / tok/s)

Native Kun turns time every model request (`withModelTiming`). A delegated Agent
makes its own model calls and reports tokens per call or per turn, never when it
generated them, so Kun measures the Agent's **output stream** instead. The
numbers feed the same `UsageSnapshot` fields as native turns
(`requestTtftMs`, `requestGenerationMs`, plus `requestGenerationTokens`) and
therefore the same turn / thread averages, composer footer and usage history.

## What is measured

`kun/src/runtime/harness-turn-timing.ts` keeps one tracker per turn.

| Metric | Definition |
| --- | --- |
| TTFT | From the instant the prompt reached the Agent (or the last tool finished) to the first **non-empty** text or reasoning delta. Boot, session load and MCP setup before that are not counted. A model call that opens with a tool call has no clean first token and yields no sample. |
| Generation time | Only while the stream was flowing: deltas closer than 2 s form a burst; a pause, a tool call or the usage report closes it. |
| Generation tokens | Estimated from the streamed text (ASCII ~3.5 chars/token, Han/kana/hangul ~1.1 tokens/char), the first delta of each burst excluded because its tokens were produced before the burst began, and capped by the usage the Agent reported for the window (`completion + reasoning`). |
| tok/s | `Σ generation tokens / Σ generation time`, weighted across calls like the native average. |

Windows shorter than 250 ms or 12 tokens, and rates above 3000 tok/s (an Agent
that buffered its output), produce no tok/s sample; TTFT is kept.

Why not the reported tokens over the span of the streamed text: reasoning that
is never streamed, tool arguments and several model calls per turn are in the
numerator but not in the window. On recorded turns that ratio read 2-6x too high
for tool-heavy Devin runs (9-18 tool calls) and for replies shorter than 2 s.
Reported tokens still serve as a ceiling for the estimate.

## Where it is sampled

Notifications are sampled when they **arrive**, before the emitter queue
persists them (that queue adds milliseconds per delta). Usage drafts are stamped
in place with the window measured so far, and `withHarnessUsageLedger` then
folds the fields like any other usage.

| Transport | Prompt reaches the Agent | Arrival tap |
| --- | --- | --- |
| ACP | before `session/prompt` | `session/update` sink, prompt result usage |
| Codex app-server, Pi RPC | before `session.runTurn` | `KunTimelineTurnSink.emit` |
| Claude Agent SDK | `system/init` message (CLI ready to call the model) | `mapper.map(message)` loop via `observeSdkMessage` |
| Cursor SDK | before `agent.send` | `consumeCursorMessage`, final usage drafts |
| Antigravity CLI | `init` / the `user_input` step of `--output-format stream-json` | each `step_update` line as the process prints it: `agent_response` `text_delta` pieces, `tool` steps |

`kun-gateway` routes are timed by the loopback gateway itself: every upstream
call a harness routes through it goes through `timeModelStream` in
`gatewayUpstream` (all three protocol handlers), so the `harness-gateway` usage
event carries the call's real TTFT, generation window and provider-reported
tokens, exactly like a native model call. The Agent's own report of those calls
is dropped (it would count them twice), so the estimate above only applies to
native-login turns.

## Accuracy evidence

Replays of real streams live in the test suite (arrival times from the capture):

- Antigravity `agy` 1.3.1, Chinese answer after 2070 hidden thinking tokens: TTFT 21.6 s, 103 tok/s over the 235 visible tokens the CLI itself reports.

- Claude haiku, English: 156 tok/s measured vs 174 server-side (-10%), TTFT 2.2 s from `init`.
- Claude haiku, Chinese with 518 hidden thinking tokens: 210 vs 228 tok/s (-8%), TTFT 5.1 s (the silent thinking is the wait for a first token).
- OpenCode 1.18.35 free reasoning model over ACP: 67.5 tok/s vs 67.5 reported, TTFT 28.6 s.

The estimate is conservative (it tends to read a little low), and an Agent that
reports no usage gets no timing at all because its drafts are not recorded.

## Antigravity

`agy --print` is run with `--output-format stream-json`: one JSON event per
line. The reply is shown as its `text_delta` pieces arrive (a short answer may
arrive as a single piece), and the final `result` event carries the turn's
`usage` (input, output, thinking, cache-read tokens, summed over its model
steps) which Kun records like any other Agent's usage. Before this the CLI ran
in `json` mode and its usage was discarded, so an Antigravity thread showed
"no usage". The CLI says how many output tokens were hidden thinking, so the
streamed answer's token count is capped at `output - thinking`. A CLI that
prints a single JSON object is still read (one fragment, usage, no timing).
