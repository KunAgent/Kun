import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'

/**
 * Recent terminal output kept for "restore after restart". Plain text only
 * (no colors), capped per session and overall so localStorage stays small.
 */
const STORAGE_KEY = 'kun.terminal.snapshots.v1'
const MAX_SESSIONS = 24
const MAX_LINE_CHARS = 400
const MAX_TOTAL_CHARS = 1_200_000

export type TerminalSnapshot = {
  lines: string[]
  savedAt: number
}

type SnapshotStore = Record<string, TerminalSnapshot>

function readStore(): SnapshotStore {
  try {
    const raw = readBrowserStorageItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : null
    if (!parsed || typeof parsed !== 'object') return {}
    const store: SnapshotStore = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const snapshot = value as Partial<TerminalSnapshot>
      if (Array.isArray(snapshot?.lines) && typeof snapshot.savedAt === 'number') {
        store[key] = { lines: snapshot.lines.filter((line): line is string => typeof line === 'string'), savedAt: snapshot.savedAt }
      }
    }
    return store
  } catch {
    return {}
  }
}

function writeStore(store: SnapshotStore): void {
  const entries = Object.entries(store).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, MAX_SESSIONS)
  let total = 0
  const kept: SnapshotStore = {}
  for (const [key, snapshot] of entries) {
    const size = snapshot.lines.reduce((sum, line) => sum + line.length + 1, 0)
    if (total + size > MAX_TOTAL_CHARS) continue
    total += size
    kept[key] = snapshot
  }
  try {
    writeBrowserStorageItem(STORAGE_KEY, JSON.stringify(kept))
  } catch { /* Snapshots are best effort. */ }
}

export function normalizeSnapshotLines(lines: readonly string[], maxLines: number): string[] {
  const trimmed = lines.map((line) => line.replace(/\s+$/, '').slice(0, MAX_LINE_CHARS))
  while (trimmed.length && !trimmed[trimmed.length - 1]) trimmed.pop()
  while (trimmed.length && !trimmed[0]) trimmed.shift()
  return trimmed.slice(-maxLines)
}

export function saveTerminalSnapshots(snapshots: Record<string, string[]>, maxLines: number, now = Date.now()): void {
  const store = readStore()
  for (const [key, lines] of Object.entries(snapshots)) {
    const normalized = normalizeSnapshotLines(lines, maxLines)
    if (normalized.length) store[key] = { lines: normalized, savedAt: now }
    else delete store[key]
  }
  writeStore(store)
}

export function loadTerminalSnapshot(key: string): TerminalSnapshot | null {
  return readStore()[key] ?? null
}

export function dropTerminalSnapshot(key: string): void {
  const store = readStore()
  if (!(key in store)) return
  delete store[key]
  writeStore(store)
}
