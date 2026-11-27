import type { AppLocale } from './app-locales'

export type DailyNotesAppearance = { locale: AppLocale; theme: 'light' | 'dark' | 'system' }

export type DailyNotesContext = DailyNotesAppearance & { pinned: boolean; canPin: boolean }

export type DailyNoteStatusTone = 'pending' | 'running' | 'attention' | 'completed' | 'failed' | 'idle'

export type DailyNoteLinkSummary = {
  url: string
  tone: DailyNoteStatusTone
  statusText: string
  detail?: string
  canMarkDone?: boolean
}

export type DailyNoteSendItem = {
  day: string
  line: number
  text: string
  quadrant: 1 | 2 | 3 | 4 | null
  notes: string[]
}

export type DailyNoteSendRequest = {
  mode: 'send' | 'draft'
  items: DailyNoteSendItem[]
}

export type DailyNoteSendResult = {
  ok: boolean
  roomId?: string
  messageId?: string
  agentLabel?: string
  error?: string
}

export type DailyNoteChangedEvent = {
  day: string
  markdown: string
  days: string[]
}

export type DailyNoteRolloverResult = {
  movedCount: number
  fromMarkdown: string
  toMarkdown: string
}

export type DailyNoteViewMode = 'page' | 'quadrants' | 'calendar'

export type DailyNoteDockPayload = {
  day?: string
  viewMode?: DailyNoteViewMode
}

export type DailyNoteTargetProject = {
  root: string
  label: string
}

export type DailyNoteTargetThread = {
  id: string
  title: string
  workspaceRoot: string
  workspaceLabel: string
  status: 'running' | 'error' | 'idle'
}

export type DailyNoteTargetsSnapshot = {
  activeWorkspaceRoot: string
  projects: DailyNoteTargetProject[]
  threads: DailyNoteTargetThread[]
}

export type DailyNoteStartThreadRequest = {
  prompt: string
  title: string
  workspaceRoot: string | null
}

export type DailyNoteStartThreadResult = {
  ok: boolean
  threadId?: string
  title?: string
  error?: string
}

export interface DailyNotesApi {
  context(): Promise<DailyNotesContext>
  listDays(): Promise<string[]>
  read(day: string): Promise<string>
  save(day: string, markdown: string): Promise<void>
  setPinned(enabled: boolean): Promise<boolean>
  onCloseRequest(finishEditing: () => Promise<boolean>): () => void
  rollover?(fromDay: string, toDay: string): Promise<DailyNoteRolloverResult>
  sendToKun?(request: DailyNoteSendRequest): Promise<DailyNoteSendResult>
  startThread?(request: DailyNoteStartThreadRequest): Promise<DailyNoteStartThreadResult>
  listTargets?(): Promise<DailyNoteTargetsSnapshot>
  dockToWorkbench?(payload?: DailyNoteDockPayload): Promise<boolean>
  openLink?(url: string): Promise<boolean>
  watchLinks?(urls: string[]): Promise<Record<string, DailyNoteLinkSummary>>
  onExternalChange?(listener: (event: DailyNoteChangedEvent) => void): () => void
  onLinkSummaries?(listener: (summaries: Record<string, DailyNoteLinkSummary>) => void): () => void
}

export type DailyNotesWorkbenchCommand =
  | { requestId: string; kind: 'send-to-kun'; request: DailyNoteSendRequest }
  | { requestId: string; kind: 'start-thread'; request: DailyNoteStartThreadRequest }
  | { requestId: string; kind: 'list-targets' }
  | { requestId: string; kind: 'dock-in-workbench'; payload?: DailyNoteDockPayload }
  | { requestId: string; kind: 'open-link'; url: string }
  | { requestId: string; kind: 'watch-links'; urls: string[] }

export interface DailyNotesWorkbenchBridge {
  getDirectory(): Promise<string>
  toggleWindow(): Promise<{ open: boolean }>
  closeWindow(): Promise<void>
  listDays(): Promise<string[]>
  read(day: string): Promise<string>
  save(day: string, markdown: string): Promise<void>
  rollover(fromDay: string, toDay: string): Promise<DailyNoteRolloverResult>
  appendTask(input: {
    day?: string
    text: string
    quadrant?: 1 | 2 | 3 | 4 | null
    linkLabel?: string
    linkUrl?: string
  }): Promise<{ day: string }>
  setTaskDone(input: {
    day: string
    taskText?: string
    linkId?: string
    done: boolean
  }): Promise<boolean>
  getTaskStatus(input: {
    day: string
    taskText?: string
    linkId?: string
  }): Promise<{ found: boolean; done: boolean }>
  bindDispatchLink(input: {
    day: string
    taskText?: string
    previousUrl?: string
    roomId: string
    linkId: string
    label?: string
  }): Promise<boolean>
  publishLinkSummaries(summaries: Record<string, DailyNoteLinkSummary>): void
  onExternalChange(listener: (event: DailyNoteChangedEvent) => void): () => void
  onCommand(handler: (command: DailyNotesWorkbenchCommand, reply: (response: unknown) => void) => void): () => void
}

export const DAILY_NOTES_CHANNELS = {
  open: 'daily-notes:open',
  context: 'daily-notes:context',
  listDays: 'daily-notes:list-days',
  read: 'daily-notes:read',
  save: 'daily-notes:save',
  pin: 'daily-notes:pin',
  requestClose: 'daily-notes:request-close',
  finishClose: 'daily-notes:finish-close',
  rollover: 'daily-notes:rollover',
  sendToKun: 'daily-notes:send-to-kun',
  startThread: 'daily-notes:start-thread',
  listTargets: 'daily-notes:list-targets',
  dockToWorkbench: 'daily-notes:dock-to-wb',
  openLink: 'daily-notes:open-link',
  watchLinks: 'daily-notes:watch-links',
  externalChange: 'daily-notes:external-change',
  linkSummaries: 'daily-notes:link-summaries',
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

export function localNoteDay(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function isNoteDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T12:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
