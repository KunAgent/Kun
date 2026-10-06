# Code conversations (formerly Rooms)

Rooms is no longer a workspace mode. Agent private chats, group conversations
and the Agent directory live in Code, next to project tasks. The workspace
mode menu offers only Code and Work. The persisted `rooms` route and older
links still resolve, but they open the matching Code conversation instead of a
separate surface. Room, Agent, message, thread and run identities are unchanged.

## Sidebar

- The top of the Code sidebar has two primary actions: New task for a project
  task, and a conversation button that opens the shared recipient picker.
- Automation (scheduled tasks and Loop) and Plugins & extensions are grouped
  into two compact menu rows; the project board keeps its own row when enabled.
- The Conversations section sits above Projects. It lists Agent private chats
  and group conversations together, newest activity first, with avatars or a
  member mosaic, a preview with the group author, an unread marker and a header
  count of unread conversations. Attention and running work outrank the preview.
- Four conversations are shown by default; the selected conversation always
  stays visible and View all expands the list. Agent pair transcripts stay in
  Agent details instead of the list.
- The section menu filters all, unread, needs-you and group conversations, and
  opens the Agent directory, archived conversations and recently deleted ones.
  Pin, archive, restore and recoverable deletion stay on each row.
- Older unbound Code threads remain under History inside the section.

## Picker and directory

One recipient picker serves the sidebar, the Code home shortcuts and empty
conversation states. Choosing one Agent opens its private chat; choosing several
creates a group. Agent creation and the Agent directory open from the same host.
A slow creation result opens its conversation only while the user is still on
the route, task and conversation where the picker was opened.

## Conversation view

Selecting any private or group conversation opens it inside Code through the
`agent-chat` route. Private headers keep the Agent identity, workspace and
session controls. Group headers show members, the collaboration mode (applied
to new topics), search, details and the room menu. Both headers toggle the Code
sidebar. Running and attention counts for the open room come from the Code
conversation list; without a loaded list the header simply omits task counts.

Files, file previews, browser previews and changes reuse the Code right panel.
The room drawer is embedded in the shared Collaboration tab and keeps its
navigation stack and focus restoration. Historical runs are read-only.

Private file trees follow `directActivity.workspace`, including the Agent's own
directory. Group file trees follow the room's linked repository roots and never
infer the directory from a previously active Code task. Changing a private
workspace epoch or removing a repository invalidates the panel's previous scope.

## Composer and execution

Private chats keep their fixed Agent recipient, model settings, permission
picker, attachments, structured input and execution capability. Group composers
expose mentions, recipients and Auto/Discuss/Execute intent; member models stay
configured per member. Room admission, workspace, approval and phase rules are
unchanged, and UI navigation grants no authority.

Notifications, workbench origin chips and send-to-Agent actions open the target
conversation in Code. Opening a Code conversation acknowledges the attention
badge that the mode menu shows while Work is active.

## Validation

Run TypeScript checks, the sidebar, rooms, workbench route and palette tests,
the application build and the authored-file line gate. The phone keeps its own
Rooms screens; their navigation is unaffected by this desktop change.
