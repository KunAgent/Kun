import type { NormalizedThread } from '../../agent/types'
import type { ConversationExportFormat } from '@shared/conversation-export'
import { DEFAULT_CONVERSATION_EXPORT_INCLUDE, type ConversationExportInclude } from '../../lib/conversation-export'

export type ExportScope = 'all' | 'workspace' | 'week'
export type ExportLayout = 'files' | 'merge'
export type ExportGroupId = 'today' | 'yesterday' | 'week' | 'earlier'

export type ExportPrefs = {
  format: ConversationExportFormat
  layout: ExportLayout
  include: ConversationExportInclude
}

export const DEFAULT_EXPORT_PREFS: ExportPrefs = {
  format: 'md',
  layout: 'files',
  include: DEFAULT_CONVERSATION_EXPORT_INCLUDE
}

const PREFS_KEY = 'kun.conversationExport.prefs.v1'
const DAY_MS = 86_400_000

export function loadExportPrefs(): ExportPrefs {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(PREFS_KEY) ?? 'null') as Partial<ExportPrefs> | null
    if (!raw || typeof raw !== 'object') return DEFAULT_EXPORT_PREFS
    const include = { ...DEFAULT_EXPORT_PREFS.include }
    for (const key of Object.keys(include) as Array<keyof ConversationExportInclude>) {
      const value = raw.include?.[key]
      if (typeof value === 'boolean') include[key] = value
    }
    return {
      format: raw.format === 'pdf' ? 'pdf' : 'md',
      layout: raw.layout === 'merge' ? 'merge' : 'files',
      include
    }
  } catch {
    return DEFAULT_EXPORT_PREFS
  }
}

export function saveExportPrefs(prefs: ExportPrefs): void {
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Preferences are a convenience; exporting still works without them.
  }
}

/** Threads a person can sensibly export: their own conversations, not side or worker threads. */
export function isExportableThread(thread: NormalizedThread): boolean {
  if (thread.relation === 'side' || thread.executionUnit) return false
  return thread.agentSurface === undefined || thread.agentSurface === 'code'
}

export function workspaceLabel(workspace: string | undefined): string {
  const parts = (workspace ?? '').replaceAll('\\', '/').split('/').filter(Boolean)
  return parts.at(-1) ?? ''
}

export function filterExportThreads(options: {
  threads: NormalizedThread[]
  query: string
  scope: ExportScope
  activeWorkspace: string
  includeArchived: boolean
  now: number
}): NormalizedThread[] {
  const query = options.query.trim().toLowerCase()
  return options.threads
    .filter((thread) => {
      if (!isExportableThread(thread)) return false
      if (thread.archived === true && !options.includeArchived) return false
      if (options.scope === 'workspace' && options.activeWorkspace && thread.workspace !== options.activeWorkspace) return false
      if (options.scope === 'week' && options.now - Date.parse(thread.updatedAt) > 7 * DAY_MS) return false
      if (!query) return true
      return `${thread.title}\n${workspaceLabel(thread.workspace)}`.toLowerCase().includes(query)
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function exportGroupFor(updatedAt: string, now: number): ExportGroupId {
  const time = Date.parse(updatedAt)
  const today = startOfDay(now)
  if (Number.isNaN(time) || time < today - 6 * DAY_MS) return 'earlier'
  if (time >= today) return 'today'
  if (time >= today - DAY_MS) return 'yesterday'
  return 'week'
}

export function groupExportThreads(
  threads: NormalizedThread[],
  now: number
): Array<{ id: ExportGroupId; threads: NormalizedThread[] }> {
  const order: ExportGroupId[] = ['today', 'yesterday', 'week', 'earlier']
  return order
    .map((id) => ({ id, threads: threads.filter((thread) => exportGroupFor(thread.updatedAt, now) === id) }))
    .filter((group) => group.threads.length > 0)
}

export function formatExportRowTime(updatedAt: string, locale: string, now: number): string {
  const time = Date.parse(updatedAt)
  if (Number.isNaN(time)) return ''
  const sameDay = time >= startOfDay(now)
  return new Intl.DateTimeFormat(locale, sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric' }).format(time)
}

export function exportFileName(title: string, format: ConversationExportFormat): string {
  const trimmed = title.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Kun-conversation'
  return `${trimmed}.${format}`
}

export function localDateToken(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
