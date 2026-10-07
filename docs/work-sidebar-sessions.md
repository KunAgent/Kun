# Work: spaces, sessions and papers

Work is one space at a time. The sidebar is the map of that space: the mode
menu, **New session** with a **New document** icon, the space switcher, then
three collapsible sections (collapse state in `kun.work.sidebarSections.v1`):

- **Sessions**: the Work conversations of this space, newest first, with the
  draft row on top while a new session has not been sent yet. The `...` menu
  opens Settings -> Archives; rows offer rename, archive (with **Undo**) and
  delete.
- **Files**: whiteboards and the file tree. The space's `papers` folder is
  hidden here because the next section shows it.
- **Papers**: the library (with the unread count), **Discover papers** and the
  paper folders of `<space>/papers`. Library, discover, reader and research
  open as editor tabs next to documents.

## The session law

`write/work-session-store.ts` keeps one current session per space (`''` is a
draft). `useWorkbenchWriteAssistantRuntime` enforces it.

1. Opening a document, whiteboard or paper never switches the session. It
   becomes the context chip above the composer (`WorkContextChip`), whose
   menu lists the sessions about it, starts a new one about it, or removes it
   from the next turns (`work-context-store.ts`; the submit path then sends no
   active resource and skips current-file retrieval).
2. Clicking a session makes it current and restores the tabs it had
   (`work-session-tabs.ts`, `kun.work.sessionTabs.v1`); a session without
   remembered tabs reopens what it is anchored to.
3. **New session** is a draft. The first send creates the session anchored to
   what is open (`prepareWorkSessionForSend`) and binds an ordinary whiteboard
   to it. If the space changes while the session is created, nothing is sent.
4. Pages that are sessions themselves become current when they come to the
   front: a PPT review board's task and an Agent research run.

With nothing open the assistant fills the center (home: hero, quick pills,
composer and continue cards); otherwise it docks right. It is the same session
and composer either way.

## Spaces and papers

Papers are not a mode. Every space has `<space>/papers`; importing or adding a
PDF puts it into the current space. Former paper libraries were folded into
the space list once (`work-space-migration.ts`) and are marked with a cap in
the switcher. Removing a space also drops it from the phone's paper libraries.

## Importing papers

The import dialog (from the library, the papers section, the home card, a
dropped PDF or "Add to papers" on a PDF in Files) imports into the current
space. Each line resolves on its own; a paper that is already in the space is
reported as such instead of duplicated (dedupe by DOI/arXiv id and by the
original PDF path). The summary offers **Open** (one paper), **Interpret these
N** and **View in library**.

## Batch interpretation

Select papers in the library (or use the import summary) and choose **Batch
interpret**. The dialog asks for the reading purpose, whether papers that
already have a session are skipped, and one explicit consent for sending the
paper text to the fixed provider/model shown. Then each paper, one at a time,
gets its own session anchored to the paper (`paper-batch-interpret.ts`):

- The paper text comes from the evidence material; a paper without text is
  skipped, and deeper purposes skip papers with abstract-only material.
- The turn is a bounded paper turn (one model request, fixed model, size cap).
- The current session is never changed. Progress is in the task panel at the
  bottom left (open, stop); the sessions appear in the sidebar and as a count
  badge on the library rows; a notice at the end opens the first one.

## Verification

```bash
npm run build
node scripts/smoke-development-direct-chat.cjs --work-only --work-papers --locale zh --evidence dist/work-smoke
```

Add `--theme dark` for the dark variant. The smoke covers the home, the first
send, documents keeping the session, the library tab, importing with dedupe,
a batch interpretation, the draft, reopening a session with its tabs, archive
with undo and the archives link. It creates its spaces next to the smoke
repository because folders under the OS temp root are never treated as
workspaces.
