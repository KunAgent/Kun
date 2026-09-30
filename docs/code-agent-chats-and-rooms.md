# Code conversations and Rooms

The desktop keeps Code, Work and Rooms as workspace modes. Code contains
project tasks and a lower Conversations section for persistent Agent private
chats. Rooms contains group conversations and Agent-to-Agent collaboration.
Both conversation surfaces share the Code right-panel components.

## Navigation and history

- New task creates an ordinary project task through the existing Code path.
- Conversations lists Agent identities, avatars, previews and activity. Add
  selects or creates an Agent and opens its existing private conversation.
- Projects and Conversations scroll independently. A keyboard-accessible
  divider controls the Conversations section height.
- Pin, archive, restore and recoverable deletion remain available for private
  chats. Older unbound Code threads remain under History in Conversations.
- The mode dropdown uses Rooms branding. Group creation selects members; Agent
  management remains available without mixing private chats into the room list.
- `agent-chat` is an internal Code-owned presentation route, not a fourth mode.
  Private and group selections use separate storage keys. Room, Agent, message,
  thread and run identities remain unchanged.

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
picker, attachments, structured input and existing execution capability. Moving
the entry does not restrict private conversations to discussion.

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

It checks both creation pickers, project/private/group navigation, private and
group file preview scope, unchanged recipients, draft isolation and reload
recovery. Existing direct-chat delivery and approval smoke use Code Conversations.
