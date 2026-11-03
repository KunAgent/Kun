import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import { normalizePath } from './write-workspace-store-helpers'
import {
  writeEditorItemKey,
  writePaperViewIdFromTabKey,
  writeWhiteboardIdFromTabKey
} from './write-editor-layout'
import type { WriteEditorLayoutV1 } from './write-workspace-store-types'

/**
 * Each session remembers the tabs that were open while it was the current
 * session, so picking it again brings back that workbench instead of just
 * the conversation. Stored per thread id, most recent first, capped.
 */
export const WORK_SESSION_TABS_KEY = 'kun.work.sessionTabs.v1'
const MAX_SESSIONS = 80
const MAX_TABS = 12

export type WorkSessionTabs = {
  workspaceRoot: string
  /** Editor item keys: file paths, `whiteboard:<id>`, `paper-view:<view>`. */
  keys: string[]
  focused: string
  at: number
}

type Stored = Record<string, WorkSessionTabs>

function readAll(): Stored {
  try {
    const parsed = JSON.parse(readBrowserStorageItem(WORK_SESSION_TABS_KEY) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Stored : {}
  } catch {
    return {}
  }
}

function writeAll(stored: Stored): void {
  const entries = Object.entries(stored).sort(([, a], [, b]) => b.at - a.at).slice(0, MAX_SESSIONS)
  writeBrowserStorageItem(WORK_SESSION_TABS_KEY, JSON.stringify(Object.fromEntries(entries)))
}

/** Every open tab key (focused group first), deduplicated and capped. */
export function workSessionTabsFromLayout(layout: WriteEditorLayoutV1): { keys: string[]; focused: string } {
  const groups = [...layout.groups].sort((a, b) =>
    (a.id === layout.focusedGroupId ? 0 : 1) - (b.id === layout.focusedGroupId ? 0 : 1))
  const keys: string[] = []
  for (const group of groups) {
    for (const item of group.tabs) {
      const key = writeEditorItemKey(item)
      if (!keys.includes(key)) keys.push(key)
    }
  }
  const focusedGroup = layout.groups.find((group) => group.id === layout.focusedGroupId) ?? layout.groups[0]
  return { keys: keys.slice(0, MAX_TABS), focused: focusedGroup?.activePath ?? '' }
}

export function rememberWorkSessionTabs(threadId: string, workspaceRoot: string, layout: WriteEditorLayoutV1): void {
  const id = threadId.trim()
  const root = normalizePath(workspaceRoot)
  if (!id || !root) return
  const next = workSessionTabsFromLayout(layout)
  const stored = readAll()
  const previous = stored[id]
  // An empty workbench is not worth remembering over a real one.
  if (next.keys.length === 0) return
  if (previous && previous.workspaceRoot === root && previous.focused === next.focused &&
    previous.keys.join('\n') === next.keys.join('\n')) return
  stored[id] = { workspaceRoot: root, ...next, at: Date.now() }
  writeAll(stored)
}

export function readWorkSessionTabs(threadId: string): WorkSessionTabs | null {
  const entry = readAll()[threadId.trim()]
  if (!entry || !Array.isArray(entry.keys) || typeof entry.workspaceRoot !== 'string') return null
  return entry
}

export function forgetWorkSessionTabs(threadId: string): void {
  const stored = readAll()
  if (!stored[threadId]) return
  delete stored[threadId]
  writeAll(stored)
}

export type WorkSessionTabTarget =
  | { kind: 'file'; path: string }
  | { kind: 'whiteboard'; boardId: string }
  | { kind: 'paper-view'; view: NonNullable<ReturnType<typeof writePaperViewIdFromTabKey>> }

/** What an editor item key opens. */
export function workSessionTabTarget(key: string): WorkSessionTabTarget | null {
  const boardId = writeWhiteboardIdFromTabKey(key)
  if (boardId) return { kind: 'whiteboard', boardId }
  const view = writePaperViewIdFromTabKey(key)
  if (view) return { kind: 'paper-view', view }
  return key.trim() ? { kind: 'file', path: key } : null
}
