# Code conversations and Rooms

The desktop keeps Code, Work and Rooms as workspace modes. Code contains
project tasks and a lower Conversations section for persistent Agent private
chats. Rooms keeps the former Bots IM interface, with Agent private chats,
group rooms and Agent-to-Agent collaboration. The Code section is an additional
entry to the same private conversations. Both surfaces share the Code
right-panel components.

## Navigation and history

- New task creates an ordinary project task through the existing Code path.
- Conversations lists Agent identities, avatars, previews and activity. Add
  selects or creates an Agent and opens its existing private conversation.
- Projects and Conversations scroll independently. A keyboard-accessible
  divider controls the Conversations section height.
- Pin, archive, restore and recoverable deletion remain available for private
  chats. Older unbound Code threads remain under History in Conversations.
- The mode dropdown uses Rooms branding. Its IM list shows private and group
  conversations together by default. Conversation-type filters and the Agent
  directory remain available.
- Rooms Add opens one recipient picker for existing Agents, private Agent
  creation and multi-Agent group creation. The Code Conversations picker opens
  private chats.
- Selecting a private conversation in Rooms keeps the Rooms mode and sidebar.
  Selecting that Agent in Code opens the same room through `agent-chat`, the
  internal Code presentation route.
- Code and Rooms remember their selections independently. A private chat has
  one room ID, message history, Agent configuration and room-owned draft across
  both entries. Project task drafts and other room drafts retain their own scope.
  Existing room, Agent, message, thread and run identities remain unchanged.

## Shared workspace

Files, file previews, browser previews and changes reuse the Code components.
The existing room drawer is embedded in the shared Collaboration tab, preserving
its navigation stack and focus restoration. Viewing historical runs is read-only.

The private file tree follows `directActivity.workspace`, including the Agent's
owned directory when no external directory is attached. Group file trees follow
the room's linked repository roots. They never infer the directory from a
previously active Code task. Every file target retains its own workspace root.
Changing a private workspace/context epoch or removing a repository invalidates
the room panel's previous scope.

Opening a file updates only the right panel. Main recipient, room selection,
draft and Code project selection stay independent. Explicit task links still
open Code, with room provenance retained by the existing workbench link protocol.
Source-message and run links preserve their target when switching conversations.

## Composer and execution

Private chats retain their fixed Agent recipient, model settings, permission
picker, attachments, structured input and existing execution capability in
both Code and Rooms. Private conversations can perform authorized work from
either entry.

Group composers expose mentions, recipients and Auto/Discuss/Execute intent.
Member models remain configured per member. The existing room admission,
workspace, approval and phase rules apply; UI navigation grants no authority.
File-tree citations bind to the private workspace identity or matching room
repository, rather than adding references from another task.

Asynchronous Agent creation, lookup, content opening and notification navigation
must not replace a newer task or conversation selection. Inactive collaboration
pages remain mounted for local state but do not consume active inspector work.

## Validation

Run TypeScript checks, the Rooms/sidebar/palette regression tests, the application
build and the authored-file line gate. The offline Electron smoke uses synthetic
Agent identities, groups, tasks and an isolated Manager profile:

```sh
node scripts/smoke-development-direct-chat.cjs --workbench-only --evidence /tmp/kun-agent-chat-workbench-smoke
```

It checks Code private selection, private and group creation through the Rooms
picker, the mixed IM list, project/private/group navigation, shared private
history and draft, file preview scope, unchanged recipients and reload recovery.
An offline greeting establishes public history before the cross-surface checks.
Existing direct-chat delivery and approval smoke use Code Conversations.
