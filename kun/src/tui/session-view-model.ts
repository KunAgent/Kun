import { sanitizeTerminalText } from './safe-text.js'

/**
 * Renderer-neutral rules for the full-screen session view: sidebar docking,
 * how much of a long conversation is mounted, sidebar summaries and the line
 * printed after exit. The opentui app imports these; tests can too.
 */

/** Session sidebar width in cells, including its left rule and padding. */
export const SIDEBAR_WIDTH = 42
/** Narrower terminals show the sidebar as an overlay instead of docking it. */
export const SIDEBAR_DOCK_MIN_WIDTH = 120

export function sidebarDocks(terminalWidth: number): boolean {
  return terminalWidth >= SIDEBAR_DOCK_MIN_WIDTH
}

/** Entries mounted when a thread opens; older ones load on demand. */
export const MOUNT_BUDGET = 240
/** Entries added each time the reader reaches the top. */
export const MOUNT_STEP = 160

/** Index of the first mounted entry for a budget over `total` entries. */
export function firstMountedEntry(total: number, budget: number): number {
  return Math.max(0, total - Math.max(0, budget))
}

/**
 * The mounted window starts at a fixed entry so new output never unmounts
 * what the reader is looking at. While the view is pinned to the bottom the
 * top can be trimmed back to the budget without anything on screen moving.
 */
export function trimmedMountStart(total: number, start: number, pinnedToBottom: boolean): number {
  const clamped = Math.min(Math.max(0, start), total)
  if (!pinnedToBottom || total - clamped <= MOUNT_BUDGET + MOUNT_STEP) return clamped
  return firstMountedEntry(total, MOUNT_BUDGET)
}

export type SidebarTodo = { content: string; status: 'pending' | 'in_progress' | 'completed' }

const MAX_SIDEBAR_TODOS = 12

/** Todo rows for the sidebar: unfinished work first, capped with a count. */
export function sidebarTodos(items: readonly SidebarTodo[], limit = MAX_SIDEBAR_TODOS): { rows: SidebarTodo[]; more: number } {
  const open = items.filter((item) => item.status !== 'completed')
  const done = items.filter((item) => item.status === 'completed')
  const rows = [...open, ...done].slice(0, Math.max(0, limit))
  return { rows, more: Math.max(0, items.length - rows.length) }
}

/** Recorded spend for the thread, in every currency the provider reported. */
export function formatSessionCost(usd: number | undefined, cny: number | undefined): string | undefined {
  const parts = [
    ...(cny && cny > 0 ? [`¥${cny.toFixed(2)}`] : []),
    ...(usd && usd > 0 ? [`$${usd.toFixed(usd < 1 ? 3 : 2)}`] : [])
  ]
  return parts.length ? parts.join(' · ') : undefined
}

/** Printed after the screen is restored, so the session is easy to reopen. */
export function exitEpilogue(thread: { id: string; title?: string }): string {
  const title = sanitizeTerminalText(thread.title || 'Untitled')
  return `\n  Kun · ${title}\n  Resume with: kun tui --thread ${sanitizeTerminalText(thread.id)}\n\n`
}

/** Session rail width; the rail replaces the tab strip on very wide terminals. */
export const RAIL_WIDTH = 30
export const RAIL_MIN_WIDTH = 180

export function railDocks(terminalWidth: number): boolean {
  return terminalWidth >= RAIL_MIN_WIDTH
}

/** Context-usage ring for the prompt and sidebar: ○ ◔ ◑ ◕ ●. */
export function contextRing(percent: number): { glyph: string; level: 'ok' | 'warn' | 'danger' } {
  const value = Math.max(0, percent)
  const glyph = value < 13 ? '○' : value < 38 ? '◔' : value < 63 ? '◑' : value < 88 ? '◕' : '●'
  return { glyph, level: value >= 90 ? 'danger' : value >= 70 ? 'warn' : 'ok' }
}

export type SessionTabStatus = 'running' | 'waiting' | 'unread' | 'idle'

/**
 * Status shown beside a session's tab number. The open session reports its
 * live projection; others rely on the thread list, so a reply that landed
 * after the reader left them shows as unread.
 */
export function sessionTabStatus(input: {
  current: boolean
  running: boolean
  waiting?: boolean
  updatedAt?: string
  lastSeenAt?: string
}): SessionTabStatus {
  if (input.current) return input.waiting ? 'waiting' : input.running ? 'running' : 'idle'
  if (input.running) return 'running'
  if (input.updatedAt && input.lastSeenAt && input.updatedAt > input.lastSeenAt) return 'unread'
  return 'idle'
}

/** Open tabs in opening order, at most `limit`, always keeping `current`. */
export function nextOpenTabs(tabs: readonly string[], current: string | undefined, limit = 9): string[] {
  if (!current) return [...tabs]
  if (tabs.includes(current)) return [...tabs]
  const next = [...tabs, current]
  while (next.length > limit) {
    const drop = next.findIndex((id) => id !== current)
    next.splice(drop, 1)
  }
  return next
}

/** "now", "5m", "3h", "yday", "4d" */
export function relativeTime(iso: string | undefined, nowMs = Date.now()): string {
  const time = Date.parse(iso ?? '')
  if (!Number.isFinite(time)) return ''
  const minutes = Math.floor(Math.max(0, nowMs - time) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  if (hours < 48) return 'yday'
  return `${Math.floor(hours / 24)}d`
}

/** Threads grouped by workspace, the given workspace first, each group capped. */
export function groupByWorkspace<T extends { workspace: string }>(
  threads: readonly T[],
  firstWorkspace: string | undefined,
  perGroup = 6
): Array<{ workspace: string; threads: T[] }> {
  const groups = new Map<string, T[]>()
  for (const thread of threads) {
    const list = groups.get(thread.workspace) ?? []
    if (list.length < perGroup) list.push(thread)
    groups.set(thread.workspace, list)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (left === firstWorkspace ? -1 : right === firstWorkspace ? 1 : 0))
    .map(([workspace, list]) => ({ workspace, threads: list }))
}
