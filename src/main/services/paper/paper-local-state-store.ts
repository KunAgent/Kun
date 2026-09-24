/**
 * Local reading state (§5.3): last-opened time, last page, page count per unit
 * under `<userData>/paper-library/<sha1(libraryRoot)>.json`. Local-only data —
 * deliberately not written into the library folder so git stays clean.
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { PaperLocalLibraryState } from '../../../shared/paper/paper-library-types'
import { atomicWriteFile } from '../../atomic-json-file'

const WRITE_THROTTLE_MS = 2_000

export type PaperUnitLocalStatePatch = {
  lastOpenedAt?: string
  lastPage?: number | null
  pageCount?: number | null
}

function stateFilePath(userDataDir: string, libraryRoot: string): string {
  const key = createHash('sha1').update(libraryRoot).digest('hex')
  return join(userDataDir, 'paper-library', `${key}.json`)
}

function emptyState(): PaperLocalLibraryState {
  return { version: 1, units: {} }
}

function normalizeState(raw: unknown): PaperLocalLibraryState {
  if (!raw || typeof raw !== 'object') return emptyState()
  const record = raw as { units?: unknown }
  const units: PaperLocalLibraryState['units'] = {}
  if (record.units && typeof record.units === 'object') {
    for (const [key, value] of Object.entries(record.units as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const unit = value as { lastOpenedAt?: unknown; lastPage?: unknown; pageCount?: unknown }
      units[key] = {
        ...(typeof unit.lastOpenedAt === 'string' ? { lastOpenedAt: unit.lastOpenedAt } : {}),
        ...(typeof unit.lastPage === 'number' && Number.isFinite(unit.lastPage)
          ? { lastPage: Math.max(1, Math.floor(unit.lastPage)) }
          : {}),
        ...(typeof unit.pageCount === 'number' && Number.isFinite(unit.pageCount)
          ? { pageCount: Math.max(1, Math.floor(unit.pageCount)) }
          : {})
      }
    }
  }
  return { version: 1, units }
}

const pendingWrites = new Map<string, { state: PaperLocalLibraryState; timer: NodeJS.Timeout }>()

export async function readPaperLocalLibraryState(
  userDataDir: string,
  libraryRoot: string
): Promise<PaperLocalLibraryState> {
  const filePath = stateFilePath(userDataDir, libraryRoot)
  const pending = pendingWrites.get(filePath)
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = normalizeState(JSON.parse(raw))
    if (pending) {
      // Unflushed writes win over the on-disk copy.
      parsed.units = { ...parsed.units, ...pending.state.units }
    }
    return parsed
  } catch {
    return pending ? { version: 1, units: { ...pending.state.units } } : emptyState()
  }
}

async function flushNow(userDataDir: string, libraryRoot: string): Promise<void> {
  const filePath = stateFilePath(userDataDir, libraryRoot)
  const pending = pendingWrites.get(filePath)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingWrites.delete(filePath)
  const onDisk = await readPaperLocalLibraryState(userDataDir, libraryRoot)
  onDisk.units = { ...onDisk.units, ...pending.state.units }
  await atomicWriteFile(filePath, `${JSON.stringify(onDisk, null, 2)}\n`)
}

/** Merge a unit patch and schedule a throttled atomic write (§5.3). */
export async function writePaperLocalUnitState(
  userDataDir: string,
  libraryRoot: string,
  unitDir: string,
  patch: PaperUnitLocalStatePatch
): Promise<PaperLocalLibraryState> {
  const filePath = stateFilePath(userDataDir, libraryRoot)
  const current = await readPaperLocalLibraryState(userDataDir, libraryRoot)
  const prev = current.units[unitDir] ?? {}
  const next = {
    ...prev,
    ...(patch.lastOpenedAt !== undefined ? { lastOpenedAt: patch.lastOpenedAt } : {}),
    ...(patch.lastPage !== undefined && patch.lastPage !== null
      ? { lastPage: Math.max(1, Math.floor(patch.lastPage)) }
      : {}),
    ...(patch.pageCount !== undefined && patch.pageCount !== null
      ? { pageCount: Math.max(1, Math.floor(patch.pageCount)) }
      : {})
  }
  const pending = pendingWrites.get(filePath)
  const mergedUnits = { ...(pending?.state.units ?? current.units), [unitDir]: next }
  const merged: PaperLocalLibraryState = { version: 1, units: mergedUnits }
  if (pending) clearTimeout(pending.timer)
  const timer = setTimeout(() => {
    void flushNow(userDataDir, libraryRoot)
  }, WRITE_THROTTLE_MS)
  if (typeof timer.unref === 'function') timer.unref()
  pendingWrites.set(filePath, { state: merged, timer })
  return merged
}

/** Test + shutdown helper: flush any pending writes for a library file. */
export async function flushPaperLocalLibraryState(
  userDataDir: string,
  libraryRoot: string
): Promise<void> {
  await flushNow(userDataDir, libraryRoot)
}
