import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { PptDeckSlideAsset as PptSlideAsset } from '../../ppt/ppt-deck-preview.js'
import { withFileMutationQueue } from './file-mutation-queue.js'

/**
 * Per-project record of imported slide images. Images are supplementary
 * assets, so the review needs to say which ones are the user's own material
 * and which were generated, and the host caps how many generated images one
 * deck may use.
 */
export const PPT_ASSET_LEDGER_PATH = '.kun-ppt-review/assets.json'
export const PPT_GENERATED_ASSET_LIMIT = 6

const Ledger = z.object({
  version: z.literal(1),
  assets: z.record(z.string(), z.object({
    origin: z.enum(['user', 'generated']),
    source: z.string().min(1)
  }).strict())
}).strict()
type Ledger = z.infer<typeof Ledger>

function ledgerPath(projectDir: string): string {
  return join(projectDir, PPT_ASSET_LEDGER_PATH)
}

export async function readPptAssetLedger(projectDir: string): Promise<Ledger> {
  const raw = await readFile(ledgerPath(projectDir), 'utf8').catch(() => undefined)
  if (raw === undefined) return { version: 1, assets: {} }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { version: 1, assets: {} }
  }
  const parsed = Ledger.safeParse(value)
  return parsed.success ? parsed.data : { version: 1, assets: {} }
}

export function generatedAssetCount(ledger: Ledger): number {
  return Object.values(ledger.assets).filter((asset) => asset.origin === 'generated').length
}

/** Record one imported media file (project-relative, e.g. media/hero.png). */
export async function recordPptAsset(
  projectDir: string,
  mediaPath: string,
  asset: { origin: 'user' | 'generated'; source: string }
): Promise<void> {
  const target = ledgerPath(projectDir)
  await withFileMutationQueue(target, async () => {
    const ledger = await readPptAssetLedger(projectDir)
    ledger.assets[mediaPath] = asset
    await mkdir(dirname(target), { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
    await rename(temporary, target)
  })
}

/**
 * Classify the image slots a rendered page embeds (project-relative paths);
 * anything not imported through the ledger was already in the project.
 */
export function pptSlideAssets(
  slots: ReadonlyArray<{ path: string; rect?: PptSlideAsset['rect'] }>,
  ledger: Ledger,
  toWorkspacePath: (projectRelative: string) => string
): PptSlideAsset[] {
  return slots.slice(0, 32).map((slot) => ({
    path: toWorkspacePath(slot.path),
    origin: ledger.assets[slot.path]?.origin ?? 'project',
    ...(slot.rect && slot.rect.width > 0 && slot.rect.height > 0 ? { rect: slot.rect } : {})
  }))
}
