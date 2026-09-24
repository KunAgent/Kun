import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PAPER_MARKS_ANNOTATIONS_FILE,
  PAPER_MARKS_DIR_NAME,
  mergePaperHighlights,
  paperAnnotationsFileSchema,
  paperAskMarkSchema,
  paperTranslateMarkSchema,
  type PaperAnnotationsFile,
  type PaperHighlight
} from '../../../shared/paper/paper-marks-types'
import { atomicWriteFile } from '../../atomic-json-file'

/**
 * `marks/` persistence (plan §5.4): `annotations.json` holds the deduped
 * highlight list; translate/ask cards live in per-id files. All writes are
 * atomic; reads tolerate missing/corrupt files so the reader never breaks on
 * a partially written mark.
 */

const MARK_ID_RE = /^[A-Za-z0-9_-]{1,80}$/

function marksDir(unitDirAbs: string): string {
  return join(unitDirAbs, PAPER_MARKS_DIR_NAME)
}

function annotationsPath(unitDirAbs: string): string {
  return join(marksDir(unitDirAbs), PAPER_MARKS_ANNOTATIONS_FILE)
}

export async function readPaperAnnotations(unitDirAbs: string): Promise<PaperHighlight[]> {
  try {
    const raw = await readFile(annotationsPath(unitDirAbs), 'utf8')
    const parsed = paperAnnotationsFileSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return []
    // Dedupe by id — first occurrence wins.
    const seen = new Set<string>()
    return parsed.data.items.filter((item) => !seen.has(item.id) && (seen.add(item.id), true))
  } catch {
    return []
  }
}

export async function writePaperAnnotations(
  unitDirAbs: string,
  items: readonly PaperHighlight[]
): Promise<PaperAnnotationsFile> {
  const file: PaperAnnotationsFile = { version: 1, items: [...items] }
  await atomicWriteFile(annotationsPath(unitDirAbs), JSON.stringify(file, null, 2))
  return file
}

/**
 * Merge-write: the caller's `items` patch the on-disk list by id instead of
 * replacing it wholesale, so external (Agent) edits made between the reader's
 * load and save are preserved.
 */
export async function mergeWritePaperAnnotations(
  unitDirAbs: string,
  items: readonly PaperHighlight[],
  removedIds: readonly string[] = []
): Promise<PaperHighlight[]> {
  const onDisk = await readPaperAnnotations(unitDirAbs)
  const removed = new Set(removedIds)
  const merged = mergePaperHighlights(
    onDisk.filter((item) => !removed.has(item.id)),
    items.filter((item) => !removed.has(item.id))
  )
  await writePaperAnnotations(unitDirAbs, merged)
  return merged
}

export async function readPaperMarkCard(
  unitDirAbs: string,
  markId: string
): Promise<unknown | null> {
  if (!MARK_ID_RE.test(markId)) return null
  try {
    const raw = await readFile(join(marksDir(unitDirAbs), `${markId}.json`), 'utf8')
    const json: unknown = JSON.parse(raw)
    const translate = paperTranslateMarkSchema.safeParse(json)
    if (translate.success) return translate.data
    const ask = paperAskMarkSchema.safeParse(json)
    if (ask.success) return ask.data
    return null
  } catch {
    return null
  }
}

export async function writePaperMarkCard(
  unitDirAbs: string,
  card: unknown
): Promise<void> {
  const translate = paperTranslateMarkSchema.safeParse(card)
  const ask = translate.success ? null : paperAskMarkSchema.safeParse(card)
  const parsed = translate.success ? translate.data : ask?.success ? ask.data : null
  if (!parsed || !MARK_ID_RE.test(parsed.id)) {
    throw new Error('Invalid mark card payload.')
  }
  await mkdir(marksDir(unitDirAbs), { recursive: true })
  await atomicWriteFile(
    join(marksDir(unitDirAbs), `${parsed.id}.json`),
    JSON.stringify(parsed, null, 2)
  )
}

export async function listPaperMarkCards(unitDirAbs: string): Promise<unknown[]> {
  try {
    const names = await readdir(marksDir(unitDirAbs))
    const out: unknown[] = []
    for (const name of names) {
      if (!name.endsWith('.json') || name === PAPER_MARKS_ANNOTATIONS_FILE) continue
      const card = await readPaperMarkCard(unitDirAbs, name.slice(0, -'.json'.length))
      if (card) out.push(card)
    }
    return out
  } catch {
    return []
  }
}
