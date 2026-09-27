import { normalizePath } from '../../../write/write-workspace-store-helpers'

/**
 * Sidebar collapse memory: which workspace roots the user collapsed, and
 * which folder groups are collapsed inside each root. Stored in localStorage;
 * a root/group not present is expanded by default.
 */

const WORKSPACES_KEY = 'kun.paper.sidebar.collapsedWorkspaces'
const GROUPS_KEY = 'kun.paper.sidebar.collapsedGroups'

function readStringSet(raw: string | null): Set<string> {
  try {
    const value = JSON.parse(raw ?? '[]') as unknown
    return Array.isArray(value) ? new Set(value.filter((item) => typeof item === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable: collapse state lasts for this session only.
  }
}

/** Workspace roots the user collapsed. */
export function readCollapsedWorkspaces(): ReadonlySet<string> {
  try {
    return readStringSet(window.localStorage.getItem(WORKSPACES_KEY))
  } catch {
    return new Set()
  }
}

export function writeCollapsedWorkspaces(collapsed: ReadonlySet<string>): void {
  write(WORKSPACES_KEY, [...collapsed])
}

/** Collapsed group names inside `libraryRoot`. */
export function readCollapsedGroups(libraryRoot: string): ReadonlySet<string> {
  const root = normalizePath(libraryRoot)
  try {
    const all = JSON.parse(window.localStorage.getItem(GROUPS_KEY) ?? '{}') as unknown
    if (!all || typeof all !== 'object') return new Set()
    return readStringSet(JSON.stringify((all as Record<string, unknown>)[root] ?? []))
  } catch {
    return new Set()
  }
}

export function writeCollapsedGroups(libraryRoot: string, collapsed: ReadonlySet<string>): void {
  const root = normalizePath(libraryRoot)
  if (!root) return
  try {
    const all = JSON.parse(window.localStorage.getItem(GROUPS_KEY) ?? '{}') as unknown
    const record = all && typeof all === 'object' ? (all as Record<string, unknown>) : {}
    record[root] = [...collapsed]
    write(GROUPS_KEY, record)
  } catch {
    write(GROUPS_KEY, { [root]: [...collapsed] })
  }
}
