# Personal assistants (assistant mailbox)

Kun can hand tasks to third-party personal assistants that run on their own cloud computers. Six have presets with their own logo and install notes: Manus Cue, Grok Bot, Meta Muse, OpenAI dots, Hark and Today. Any other assistant that can run terminal commands and check in on a schedule can join as a custom assistant. Each assistant installs `kun-agent` itself from a prompt Kun generates and asks to join; the user approves the request in Kun after checking that both sides show the same verification code. Kun and the assistant then exchange end-to-end encrypted messages through Kunserve's assistant mailbox. The server side, the `kun-agent` program and the prompts live in the adjacent `kunserve` repository (`docs/assistant-mailbox.zh-CN.md`, `packages/assistant-agent`).

The feature is off by default: Settings > Lab > Personal assistants. Kunserve must also have `ASSISTANT_MAILBOX_ENABLED=true`; until then assistant conversations say the server has not opened it, and the conversation list shows none.

## Where it lives in the app

Personal assistants are rows of the Code sidebar's conversation list, beside Agent private chats and groups. They sort by latest activity with the Rooms (pinned Rooms stay on top), carry a cloud badge on their logo, and have their own "Personal assistants only" filter. Opening one shows its conversation on the `agent-chat` route: every message sent there is a task, a blocked task can be answered in place, and the assistant's reports and notes come back into the same thread.

## Joining

1. The conversation list's + menu > Connect a personal assistant opens the picker (step 1): a preset, or "Other assistant" with a product name and an optional website. Main creates an enrollment, generates an X25519 key pair for it, keeps the private key in the secret store as `pairing:<enrollmentId>`, and puts only the public key in the prompt's `KUN2-` code. The prompt holds no secret.
2. The new enrollment opens as a conversation showing the prompt (step 2). The prompt can be shown again or switched between Chinese and English at any time, because Main rebuilds it from the kept pairing key.
3. The assistant runs `kun-agent login <code>`, which sends its own public key and prints a 10-character verification code for the user. The conversation polls every 5 seconds while it waits, and the request appears there with the code Main computes (step 3). The user allows it only if the codes match; Kun tools cannot approve.
4. The approval IPC carries the verification code actually shown to the user. Main refuses approval if the current peer key produces a different code. On approval Main derives the mailbox secret by X25519 and stores it under the enrollment id before telling the server, then the assistant's `login` finishes on its side and the conversation switches to the connected assistant.

A custom assistant reaches the server only as a slug of its product name (`zo_computer`, or `other` when the name has no ASCII letters or digits). Its product name, website and icon stay on this desktop in `profiles.json`. The icon is fetched once over HTTPS from the website's icon links or conventional paths, limited to 256 KB of image data, and stored as a data URL.

Tasks are persisted with their exact sealed envelope before sending. A lost response or network outage leaves a visible queued task; synchronization after restart retries the same ID and ciphertext. Permanent rejection marks the task failed. The task and its pending envelope share one atomic file update, so a reply can always be associated with its original task.

## Desktop pieces

| Area | Files | Responsibility |
| --- | --- | --- |
| Main service | `src/main/assistant-mailbox/service.ts` | Registers this desktop as the remote host device (the identity the phone link uses), creates enrollment codes and re-shows their prompts, assigns, cancels and answers tasks, polls replies (20 s while a code is pending, 60 s with assistants, backing off on errors) |
| Storage | `secret-store.ts`, `task-store.ts`, `profile-store.ts`, `site-icon.ts` | Pairing keys and mailbox secrets encrypted with Electron safeStorage; the local record of tasks, replies and notes (who wrote each); custom assistants' product, website and icon; all under `userData/assistant-mailbox/<account>/` |
| Kun tools | `mcp-server.ts`, `mcp-config.ts`, `tool-endpoint.ts`, `tool-routes.ts` | The `kun_assistants` MCP server (`list_assistants`, `assign_assistant_task`, `cancel_assistant_task`, `get_assistant_results`, `wait_assistant_results`). The runtime starts it like the canvas server; it holds no credentials and calls Main over a user-only Unix socket (named pipe on Windows) with a per-launch secret |
| Conversation list | `src/renderer/src/components/assistants/assistant-sidebar.ts`, `SidebarAssistantRow.tsx`, `../chat/SidebarAgentChatsSection.tsx`, `../chat/SidebarNewConversationMenu.tsx` | Assistant and enrollment rows, unread and attention marks, filters, the + menu entry, merging with Rooms |
| Conversation stage | `AssistantConversationStage.tsx`, `AssistantThread.tsx`, `AssistantComposer.tsx`, `AssistantEnrollmentFlow.tsx`, `JoinRequestCard.tsx` | The thread of tasks, reports and notes; the composer with deadline and "Nudge" (copies a wake message for the assistant's own chat); the in-conversation prompt and join requests |
| Picker and logos | `AddAssistantDialog.tsx`, `AssistantSteps.tsx`, `AssistantLogo.tsx`, `assistant-catalog.ts`, `src/asset/img/assistants/` | Presets, the custom assistant form, and logos (cover icons cropped round, glyphs on a white disc, monograms otherwise). Logo provenance is in that folder's README |
| State | `assistant-mailbox-store.ts`, `assistant-navigation.ts` | One renderer store for the mailbox snapshot and its actions; which assistant the stage shows and per-assistant read marks |
| Contracts | `src/shared/assistant-mailbox.ts`, `src/preload/assistant-mailbox.ts` | IPC channels and projections; secrets and tokens never cross IPC |

The package is consumed from `vendor/kun-assistant/kun-assistant-agent-<version>.tgz` (currently 0.6.0); change it in kunserve, bump its version, pack it and update the dependency.

Tests: `npx vitest run src/main/assistant-mailbox src/renderer/src/components/assistants`. The Main tests drive the real service, the real `kun-agent` CLI and the package's in-memory mailbox server end to end; the renderer tests cover the timeline, the list merge, the conversation states and the picker.

## Reliable delivery and recovery

The 0.6.0 SDK persists tasks, follow-up notes and cancellations before sending, retaining the exact ID and ciphertext across retries. Delivery labels distinguish queued, stored by the server, downloaded by the receiver and explicitly accepted by the consumer. These receipts do not prove model execution. Cancellation stays requested until the receiver confirms the cancellation message; a concurrent completed result remains visible.

All local tasks and notes are retained, with pagination in the conversation. Working tasks are never discarded to meet a count limit. With the same binding keys, the desktop can reconstruct outgoing and incoming history using server sequences, including messages already acknowledged. A cursor older than the server retention boundary requires explicit recovery; unknown storage versions are preserved and rejected.

`wait_assistant_results` uses the previous result's `updateToken` and waits up to 30 seconds. Account changes and application shutdown end the wait. This is bounded polling, not an automatic model wake mechanism. The assistant-side CLI/MCP separately claims messages with a lease and explicitly confirms consumption. Instructions from a connected assistant do not replace human approval for sensitive actions.

When signed automatic updates are not configured, the update prompt verifies the installer against a hash pinned in this SDK. Changed server artifacts require a newer desktop SDK. Follow the prompt to stop the old watch/MCP processes and preserve the existing binding, keys and outbox. See kunserve's `docs/reliable-assistant.zh-CN.md` for retention limits, migration and rollback constraints.
