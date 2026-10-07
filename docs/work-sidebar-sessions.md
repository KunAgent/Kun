# Work sidebar: sessions and files

Work has one sidebar shaped like Code's: the mode menu, a **New session**
button with a **New document** icon, two paper rows (**Library** and the
**Discover papers** menu), then a **Sessions | Files** switch. Paper mode no
longer has its own toggle or sidebar; libraries are part of Work.

## Views

- **Sessions** (default, remembered in `kun.work.sidebarView.v1`) lists Work
  conversations grouped by work space and paper library, newest first. Each
  row shows what the session is attached to: the space itself, a document, a
  whiteboard or a paper. Opening a session mounts its space or library,
  reopens that resource and selects the conversation.
- **Files** shows every work space (whiteboards and file tree of the mounted
  one) followed by the paper libraries. Row actions appear on hover.

## Which conversation is shown

`write/work-sidebar-store.ts` keeps a pin: the session picked in the sidebar,
or an empty draft after **New session**, together with the document that was
open when it was set.

- In the sessions view the pinned session stays in the assistant while
  documents open and close. Sends reuse it
  (`ensureWriteThreadForWorkspace` -> `pinnedWriteSessionId`).
- In the files view the conversation follows the open document. Switching
  views never changes the conversation: the pin adopts the open document and
  is released as soon as another one opens (or when nothing is open it keeps
  the centered conversation).
- **New session** anywhere (sidebar, group `+`, assistant header `+`) is a
  draft: no thread exists until the first send, which binds it to whatever is
  open then (`prepareWorkSessionForSend`; other senders such as the paper
  reading dialog honor the draft through `ensureWriteThreadForWorkspace`).
  Whiteboards are the exception and create their bound session at once.
- Session rows offer rename, archive and delete; archived sessions are listed
  under Settings -> Archives.

## Layout

With nothing open on the documents surface the assistant fills the center
(`work-conversation-stage.ts`): Kun, a heading, quick actions and the composer,
like Code's home. Opening a document docks the assistant back into the right
panel. Phone layouts keep the overlay assistant.

## Papers

The documents/papers surfaces still exist internally, but the user never
toggles them: `switchPaperLibrary` always mounts the papers surface, and
`selectWriteWorkspace`/`addWriteWorkspace` always return to documents.

## Verification

```bash
npm run build
node scripts/smoke-development-direct-chat.cjs --work-only --work-papers --locale zh --evidence dist/work-smoke
```

Add `--theme dark` for the dark variant and `--work-code` to capture Code for
comparison. The smoke creates its spaces next to the smoke repository because
folders under the OS temp root are never treated as workspaces.
