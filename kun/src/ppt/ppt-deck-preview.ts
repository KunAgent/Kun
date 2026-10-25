import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { PptGeometryQaIssueV1 } from './ppt-geometry-qa-report.js'

/**
 * Preview state for one PPTD deck, owned by the deck tools. It only remembers
 * which rendered SVG each page file currently points at, so unchanged pages
 * keep their revision and whiteboard image, and only edited pages re-render.
 * The bundle shapes below are what the review and direction whiteboards
 * already project.
 */

export const PPT_DECK_REVIEW_DIR = '.kun-ppt-review'
export const PPT_DECK_PREVIEW_MANIFEST = `${PPT_DECK_REVIEW_DIR}/preview.json`

const PreviewEntry = z.object({
  key: z.string().min(1),
  slideId: z.string().min(1),
  revision: z.number().int().positive(),
  svgHash: z.string().regex(/^[a-f0-9]{64}$/),
  previewPath: z.string().min(1)
}).strict()

const PreviewManifest = z.object({
  version: z.literal(1),
  slides: z.array(PreviewEntry).max(200).default([]),
  directions: z.array(PreviewEntry).max(32).default([])
}).strict()
export type PptDeckPreviewManifest = z.infer<typeof PreviewManifest>
export type PptDeckPreviewEntry = z.infer<typeof PreviewEntry>

export type PptDeckSlideAsset = {
  path: string
  origin: 'user' | 'generated' | 'project'
  rect?: { x: number; y: number; width: number; height: number }
}

export type PptDeckReviewSlide = {
  slideId: string
  index: number
  title: string
  previewPath?: string
  revision: number
  status: 'ready' | 'failed'
  error?: string
  qaIssues?: PptGeometryQaIssueV1[]
  assets?: PptDeckSlideAsset[]
}

export type PptDeckReviewBundle = {
  workflowId: string
  childId: string
  manifestPath: string
  deckTitle: string
  styleFingerprint: string
  phase: 'awaiting_review' | 'failed_recoverable' | 'completed'
  slides: PptDeckReviewSlide[]
}

export type PptDeckDirectionBundle = {
  schemaVersion: 1
  workflowId: string
  childId: string
  manifestPath: string
  previewMode: 'editable'
  deckTitle: string
  phase: 'awaiting_direction'
  recommendedDirectionId: string
  slides: Array<{ slideId: string; index: number; title: string }>
  directions: Array<{
    directionId: string
    name: string
    rationale: string
    revision: number
    recommended: boolean
    fonts: string[]
    colors: string[]
    layout: string
    background: string
    imagery: string
    previews: Array<{ role: 'cover' | 'representative' | 'complex'; imagePath: string }>
  }>
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Whiteboard identity for a deck folder (workspace-relative). It stays
 * readable because review context sent back from the board names the deck
 * the agent should edit.
 */
export function pptDeckWorkflowId(projectRelative: string): string {
  return `deck:${projectRelative || '.'}`
}

/** File-name-safe key for one page file's preview SVGs. */
export function pptDeckPreviewFileKey(pageFile: string): string {
  return `slide_${sha256(pageFile).slice(0, 16)}`
}

export function pptDeckPreviewManifestPath(projectDir: string): string {
  return join(projectDir, PPT_DECK_PREVIEW_MANIFEST)
}

export async function readPptDeckPreviewManifest(projectDir: string): Promise<PptDeckPreviewManifest> {
  const raw = await readFile(pptDeckPreviewManifestPath(projectDir), 'utf8').catch(() => undefined)
  if (raw === undefined) return { version: 1, slides: [], directions: [] }
  try {
    const parsed = PreviewManifest.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : { version: 1, slides: [], directions: [] }
  } catch {
    return { version: 1, slides: [], directions: [] }
  }
}

export async function writePptDeckPreviewManifest(projectDir: string, manifest: PptDeckPreviewManifest): Promise<void> {
  const target = pptDeckPreviewManifestPath(projectDir)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(PreviewManifest.parse(manifest), null, 2)}\n`, 'utf8')
  await rename(temporary, target)
}

/**
 * Decide the revision for a freshly rendered SVG: same bytes keep the previous
 * revision and file, anything else bumps it and needs a new file.
 */
export function nextPreviewRevision(
  previous: PptDeckPreviewEntry | undefined,
  svgHash: string
): { revision: number; changed: boolean } {
  if (previous && previous.svgHash === svgHash) return { revision: previous.revision, changed: false }
  return { revision: (previous?.revision ?? 0) + 1, changed: true }
}

/** Attach export QA issues to the review slides by slide index. */
export function withPptDeckQaIssues(
  bundle: PptDeckReviewBundle,
  issues: readonly PptGeometryQaIssueV1[],
  phase: PptDeckReviewBundle['phase']
): PptDeckReviewBundle {
  return {
    ...bundle,
    phase,
    slides: bundle.slides.map((slide) => ({
      ...slide,
      qaIssues: issues.filter((issue) => issue.slideIndex === slide.index)
    }))
  }
}
