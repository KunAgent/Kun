# Mobile Remote capability baseline

This checklist prevents the mobile shell from treating every product area as a Code conversation. It records current source capabilities, not completion evidence.

## Code

- Mobile home and composer foundations exist but are not connected to the shared Workbench controllers.
- Preserve thread search/pagination, runtime streaming, queue/stop, attachments, approvals, user inputs, plans, generated content, file/diff/terminal/SSH and settings protection.
- Current limitation: the independent mobile shell and real message timeline are not wired; the legacy remote CSS remains active.

## Rooms

- Product types: group, user/agent private chat, and read-only agent/agent conversation.
- List: search, archived/unread/attention filters, cursor pagination, selected room persistence and event reconciliation.
- Conversation: messages, history pagination, structured mentions, replies, topic/request context, attachments/content references, polls and pending-send retry.
- Collaboration: members, models, permissions, tasks, runs, approvals/user inputs, handoffs, delivery/content/diff and room settings.
- Recovery: event cursor, notification queue, fallback polling and clientRequestId/fingerprint semantics.
- Current mobile limitation: the existing 767px rules mostly collapse sidebar/header; several targets remain desktop-sized or hover-oriented and drawers are not a mobile page stack.

## Work (`write` route)

- Workspace and files: directory loading, recent/open resources, document tabs/groups and whiteboards.
- Resource engines: Markdown source/rich editor, image, PDF, Office presentation/document preview, spreadsheet mutation/editor and code preview.
- Data safety: autosave/debounce, serialized per-file save queue, external-change/hash conflicts, truncated-file guard and explicit save/error state.
- Assistant: resource-bound thread, selection context, pending AI review, accept/reject/undo and document-epoch checks.
- Remote 手机 Work 现在以「文档 / 论文」作为手机本地导航状态：文档目录、受限递归文件名搜索、最近资源、创建/改名/删除/下载及资源阅读/编辑/提问；论文库、导入、阅读标注/笔记、发现与研究会话均复用主机服务，不切换桌面 `write.paperMode.enabled`。
- 当前验收限制：真实 Remote 上传、PDF 选择/下载、键盘安全区与触控仍须在 iOS Safari 和 Android Chrome 实测；设备清单见 `docs/mobile-remote-work-paper-qa.zh-CN.md`。

## Shared release gates

- Code / Rooms / Work are three visible first-class destinations.
- Domain identifiers and drafts remain isolated: thread, room/reply, and Work resource are never interchanged.
- Work leave protection runs for browser back, mode changes and resource close.
- Rooms retains the agent/agent read-only boundary and does not auto-approve attention items.
- No default entry switch until real Remote HTTP/SSE/upload/write/export flows and iOS/Android devices pass the combined plans.
