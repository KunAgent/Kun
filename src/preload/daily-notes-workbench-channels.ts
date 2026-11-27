// Workbench-preload copy of Daily Notes IPC channel names. Sandboxed preloads
// cannot require shared Rollup chunks, so index.ts must not share a runtime
// import of src/shared/daily-notes.ts with src/preload/daily-notes.ts.
export const DAILY_NOTES_WORKBENCH_IPC = {
  workbenchDirectory: 'daily-notes:wb-directory',
  workbenchToggleWindow: 'daily-notes:wb-toggle-window',
  workbenchCloseWindow: 'daily-notes:wb-close-window',
  workbenchListDays: 'daily-notes:wb-list-days',
  workbenchRead: 'daily-notes:wb-read',
  workbenchSave: 'daily-notes:wb-save',
  workbenchRollover: 'daily-notes:wb-rollover',
  workbenchAppendTask: 'daily-notes:wb-append-task',
  workbenchSetDone: 'daily-notes:wb-set-done',
  workbenchGetTaskStatus: 'daily-notes:wb-task-status',
  workbenchBindDispatch: 'daily-notes:wb-bind-dispatch',
  workbenchPublishSummaries: 'daily-notes:wb-publish-summaries',
  workbenchExternalChange: 'daily-notes:wb-external-change',
  workbenchCommand: 'daily-notes:wb-command',
  workbenchReply: 'daily-notes:wb-reply'
} as const
