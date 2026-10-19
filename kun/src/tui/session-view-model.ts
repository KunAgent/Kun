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
