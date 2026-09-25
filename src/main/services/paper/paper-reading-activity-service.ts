/**
 * Reading-activity aggregation for the library heat bar (R3.1). Walks every
 * unit's `marks/` directory and counts marks per page — `annotations.json`
 * contributes one count per highlight, each card file (`<id>.json`) one count
 * on its `page`. Content never leaves the main process: only the per-page
 * counts are returned.
 *
 * Results are cached in memory keyed by the unit's marks-file signature
 * (name + mtime + size), so re-entering the library tab is cheap.
 */
import { readdir, stat } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PAPER_MARKS_DIR_NAME } from '../../../shared/paper/paper-marks-types'
import type {
  PaperLocalLibraryState,
  PaperUnitReadingActivity
} from '../../../shared/paper/paper-library-types'
import type { ScannedPaperUnit } from './paper-library-service'

type CacheEntry = { signature: string; pages: number[] }
const activityCache = new Map<string, CacheEntry>()

function pageOfMarkJson(json: unknown): number[] {
  if (!json || typeof json !== 'object') return []
  const record = json as { page?: unknown; items?: unknown }
  const pages: number[] = []
  // `annotations.json` shape: { version, items: [{ page }, ...] }
  if (Array.isArray(record.items)) {
    for (const item of record.items) {
      const page = (item as { page?: unknown })?.page
      if (typeof page === 'number' && Number.isInteger(page) && page >= 1 && page < 100_000) {
        pages.push(page)
      }
    }
    return pages
  }
  // Card shape (translate / ask / visual): { page, ... }
  const page = record.page
  if (typeof page === 'number' && Number.isInteger(page) && page >= 1 && page < 100_000) {
    pages.push(page)
  }
  return pages
}

async function marksSignature(marksDir: string): Promise<string | null> {
  let names: string[]
  try {
    names = await readdir(marksDir)
  } catch {
    return null
  }
  const jsonFiles = names.filter((name) => name.endsWith('.json'))
  if (jsonFiles.length === 0) return ''
  const parts: string[] = []
  for (const name of jsonFiles) {
    try {
      const info = await stat(join(marksDir, name))
      parts.push(`${name}:${info.mtimeMs}:${info.size}`)
    } catch {
      parts.push(`${name}:missing`)
    }
  }
  parts.sort()
  return parts.join('|')
}

async function unitPageCounts(unitDirAbs: string): Promise<number[]> {
  const marksDir = join(unitDirAbs, PAPER_MARKS_DIR_NAME)
  const signature = await marksSignature(marksDir)
  if (signature === null) return []
  const cached = activityCache.get(unitDirAbs)
  if (cached && cached.signature === signature) return cached.pages

  const counts = new Map<number, number>()
  let names: string[] = []
  try {
    names = await readdir(marksDir)
  } catch {
    names = []
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const raw = await readFile(join(marksDir, name), 'utf8')
      for (const page of pageOfMarkJson(JSON.parse(raw))) {
        counts.set(page, (counts.get(page) ?? 0) + 1)
      }
    } catch {
      // Corrupt or partially written mark files are skipped — counts only.
    }
  }
  const maxPage = Math.max(0, ...counts.keys())
  const pages = new Array<number>(maxPage).fill(0)
  counts.forEach((count, page) => {
    pages[page - 1] = count
  })
  activityCache.set(unitDirAbs, { signature, pages })
  return pages
}

/** Aggregate mark counts for every scanned unit, merged with local state. */
export async function readPaperReadingActivity(
  units: readonly ScannedPaperUnit[],
  local: PaperLocalLibraryState
): Promise<Record<string, PaperUnitReadingActivity>> {
  const activity: Record<string, PaperUnitReadingActivity> = {}
  await Promise.all(
    units.map(async (unit) => {
      const pages = await unitPageCounts(unit.dirAbs)
      const state = local.units[unit.unitDir]
      const pageCount = state?.pageCount
      const lastPage = state?.lastPage
      if (pages.length === 0 && !pageCount && !lastPage) return
      activity[unit.unitDir] = {
        pages,
        ...(pageCount ? { pageCount } : {}),
        ...(lastPage ? { lastPage } : {})
      }
    })
  )
  return activity
}

/** Test helper: drop the in-memory cache. */
export function resetPaperReadingActivityCache(): void {
  activityCache.clear()
}
