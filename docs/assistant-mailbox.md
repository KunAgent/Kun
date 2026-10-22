# Personal assistants (assistant mailbox)

Kun can hand tasks to third-party personal assistants that run on their own cloud computers (Manus Cue, Grok Bot, Meta Muse, OpenAI dots). Each assistant installs `kun-agent` itself from a prompt Kun generates; Kun and the assistant then exchange end-to-end encrypted messages through Kunserve's assistant mailbox. The server side, the `kun-agent` program and the prompts live in the adjacent `kunserve` repository (`docs/assistant-mailbox.zh-CN.md`, `packages/assistant-agent`).

The feature is off by default: Settings > Lab > Personal assistants. Kunserve must also have `ASSISTANT_MAILBOX_ENABLED=true`; until then the Remote panel says the server has not opened it.

## Desktop pieces

| Area | Files | Responsibility |
| --- | --- | --- |
| Main service | `src/main/assistant-mailbox/service.ts` | Registers this desktop as the remote host device (the identity the phone link uses), creates enrollment codes, assigns and cancels tasks, polls replies (20 s while a code is pending, 60 s with assistants, backing off on errors) |
| Storage | `secret-store.ts`, `task-store.ts` | Enrollment secrets encrypted with Electron safeStorage; the local record of tasks, replies and notes, under `userData/assistant-mailbox/<account>/` |
| Kun tools | `mcp-server.ts`, `mcp-config.ts`, `tool-endpoint.ts`, `tool-routes.ts` | The `kun_assistants` MCP server (`list_assistants`, `assign_assistant_task`, `cancel_assistant_task`, `get_assistant_results`). The runtime starts it like the canvas server; it holds no credentials and calls Main over a user-only Unix socket (named pipe on Windows) with a per-launch secret |
| UI | `src/renderer/src/components/remote/assistants/` | Remote panel section: connected assistants, pending codes, recent tasks and notes, and the "Add assistant" dialog that shows the prompt to paste |
| Contracts | `src/shared/assistant-mailbox.ts`, `src/preload/assistant-mailbox.ts` | IPC channels and projections; secrets and tokens never cross IPC |

The package is consumed from `vendor/kun-assistant/kun-assistant-agent-<version>.tgz`; change it in kunserve, bump its version, pack it and update the dependency.

Tests: `npx vitest run src/main/assistant-mailbox src/renderer/src/components/remote/assistants`. They drive the real service, the real `kun-agent` CLI and the package's in-memory mailbox server end to end.
