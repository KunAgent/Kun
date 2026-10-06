# Work assistant workspace

Work opens with its full conversation surface. The global app startup mode and
saved Code preference are unchanged. The primary Work navigation entry opens the
assistant; document and paper-library navigation returns to the existing editor.

## Conversation continuity

The full page and contextual sidebar render one `WriteAssistantPanel` instance.
They reuse Code's `LazyMessageTimeline`, `FloatingComposer`, model controls,
attachments and normal Work conversation registry. Docking or expanding changes
presentation only: it does not create a session or submit a prompt. Open document
tabs stay mounted so selections and scroll are retained. Explicit file navigation
reveals the workspace; startup hydration does not steal the assistant landing.

Back returns to the existing workspace. Alt+Left switches to the previous Work
presentation, and returning restores a connected originating focus target. Import
and bounded-reading dialogs are hosted outside the hidden document canvas so their
confirmation UI remains visible from either presentation.

## Paper batches

Choose selected paper rows, the current filtered library view, a sidebar group
(including nested groups), or a library menu action. These actions stage a batch
and read existing local source material; they do not submit a model request.

Before Start, the assistant shows:

- Readable paper titles, source group, count and removable items
- Reading purpose and an optional per-paper question
- The fixed provider/model selected in the Work composer
- Up to 20 sequential requests, at most one request per paper per attempt
- The existing source-character limit and honest unknown monetary pricing
- Conversation-only output or a new article beside each original paper
- Explicit consent covering the displayed sources, model and destination

The existing bounded paper runtime remains authoritative: every turn uses a
fresh isolated source context, no thread-history carryover, no tools and no
automatic model retries. Deeper reading requires complete material; partial or
abstract-only sources support quick screening only.

Each batch uses a normal library-level Work conversation. Opening results restores
the library view before selecting that conversation, without discarding dirty tabs.
Progress is per paper. Cancel targets the exact admitted turn and stops remaining
work. Ambiguous transport or changed-turn results pause the queue instead of
claiming success; explicit retry reconciles the same idempotency key. Failed or
canceled turns require an explicit retry that may incur another charge. Completed
papers are not regenerated merely because saving or registration failed.

Optional articles are derived only from verified assistant blocks belonging to
the exact completed turn. The app rechecks paper identity, creates a readable
`<paper title>-explanation-<batch suffix>.md` with exclusive-create semantics, and
registers it through the existing interpretation API. No original paper path,
metadata ID, article or note is renamed or overwritten.

The queue is renderer-session-local. Completed outputs persist in the existing
conversation/library. Closing or restarting the application does not automatically
resume remaining requests; users can inspect the conversation and intentionally
stage another batch. This feature does not add another filesystem or paper index.

Numeric group names remain stable physical identities. A verified matching
paper identifier can provide a readable display title; ambiguous and empty groups
use a neutral label with the raw identifier visible as secondary context.

## Verification

`work-assistant-navigation`, assistant/history, workspace-file, batch lifecycle,
provider admission and numeric-label tests cover local behavior. The supplemental
DOM fixture checks real production controls and composer identity without making
native-rendering claims.

`work-assistant-smoke.yml` runs production assistant, panel host and library UI
inside sandboxed native Electron on macOS and Windows. It uses explicit offline
preload/session fixtures, blocks external requests, never calls a model, and uploads
labelled screenshots with an exact assertion report. A literal-rendering sentinel
checks that layout changes preserve the existing ChatBlock rendering policy. It is not a full-app startup,
real filesystem or real provider smoke. Those boundaries have separate tests.
