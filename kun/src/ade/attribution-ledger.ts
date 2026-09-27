import { createHash } from 'node:crypto'
import { z } from 'zod'
import { adeAttributionFile } from './ade-paths.js'
import { readAdeJson, writeAdeJson } from './ade-file.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'

/**
 * AI line attribution ledger (docs/ade/11 §6.2): each observed write stores
 * the content hash of every line inside its written range. Attribution is
 * reverse lookup — a current line belongs to the most recent entry whose
 * hashes contain it; lines a human rewrote simply stop matching.
 *
 * Local-only (`dataDir/ade/attribution/<workspaceId>.json`), never committed
 * to git. Only writes through Kun-observable channels can be attributed —
 * edits an agent made by piping scripts inside a terminal stay unattributed
 * by design.
 */
const MAX_ENTRIES = 50_000

const AttributionEntrySchema = z.object({
  /** Path relative to the task workspace root. */
  path: z.string().min(1).max(4_096),
  lineHashes: z.array(z.string().min(1).max(64)).max(200_000),
  unitId: z.string().min(1).max(256),
  harnessId: z.string().min(1).max(64),
  dispatchId: z.string().min(1).max(256).optional(),
  at: z.string()
}).strict()
export type AttributionEntry = z.infer<typeof AttributionEntrySchema>

const AttributionFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(AttributionEntrySchema).max(MAX_ENTRIES)
}).strict()

/** One line's attribution; missing fields mean human-or-unknown authorship. */
export type AttributionLine = {
  line: number
  unitId?: string
  harnessId?: string
  dispatchId?: string
}

/** Trailing whitespace never participates in identity (11 §6.1). */
export function normalizeLine(line: string): string {
  return line.replace(/\s+$/, '')
}

export function lineHash(normalized: string): string {
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Empty lines and bracket-only lines are ubiquitous boilerplate; recording
 * them would mis-attribute whole regions to whichever agent wrote them last.
 */
export function isAttributableLine(line: string): boolean {
  const trimmed = normalizeLine(line).trim()
  return trimmed !== '' && !/^[{}()[\];,]+$/.test(trimmed)
}

/** Content hashes for every attributable line of a written fragment. */
export function lineHashesFor(text: string): string[] {
  const hashes: string[] = []
  for (const line of text.split('\n')) {
    if (isAttributableLine(line)) hashes.push(lineHash(normalizeLine(line)))
  }
  return hashes
}

export class AttributionLedger {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly dataDir: string,
    private readonly nowIso: () => string
  ) {}

  /**
   * Append a write event. Writes serialize per workspace through a promise
   * chain so bursts of tool results cannot interleave read-modify-write.
   */
  record(workspaceId: string, entry: AttributionEntry): Promise<void> {
    const next = (this.queues.get(workspaceId) ?? Promise.resolve()).then(() =>
      this.append(workspaceId, entry))
    this.queues.set(workspaceId, next.catch(() => undefined))
    return next
  }

  /** Per-line attribution for the file's CURRENT content. */
  async attribute(
    workspaceId: string,
    path: string,
    content: string
  ): Promise<AttributionLine[]> {
    const file = await this.read(workspaceId)
    if (!file) return []
    const byPath = file.entries.filter((entry) => entry.path === path)
    if (!byPath.length) return []
    const lines: AttributionLine[] = []
    const rows = content.split('\n')
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      if (row === undefined || !isAttributableLine(row)) continue
      const hash = lineHash(normalizeLine(row))
      for (let back = byPath.length - 1; back >= 0; back -= 1) {
        const entry = byPath[back]
        if (entry && entry.lineHashes.includes(hash)) {
          lines.push({
            line: index + 1,
            unitId: entry.unitId,
            harnessId: entry.harnessId,
            ...(entry.dispatchId ? { dispatchId: entry.dispatchId } : {})
          })
          break
        }
      }
    }
    return lines
  }

  private async append(workspaceId: string, entry: AttributionEntry): Promise<void> {
    await withManagerDataMutex(`ade-attribution:${workspaceId}`, async () => {
      const file = await this.read(workspaceId) ?? { version: 1 as const, entries: [] }
      file.entries.push(entry)
      if (file.entries.length > MAX_ENTRIES) {
        file.entries.splice(0, file.entries.length - MAX_ENTRIES)
      }
      await writeAdeJson(adeAttributionFile(this.dataDir, workspaceId), file)
    })
  }

  private async read(workspaceId: string) {
    return readAdeJson(
      adeAttributionFile(this.dataDir, workspaceId),
      AttributionFileSchema,
      () => null
    )
  }
}
