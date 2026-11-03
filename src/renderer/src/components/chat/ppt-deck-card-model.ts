import type { ChatBlock, ToolBlock } from '../../agent/types'

/**
 * Pure read model for the deck card under `ppt_preview` / `ppt_export`
 * results: which deck a call touched, what the whiteboard now shows, where
 * slide images came from, and whether a validated PPTX exists. Everything
 * comes from the tool result itself.
 */

export const PPT_DECK_TOOL_NAMES: ReadonlySet<string> = new Set(['ppt_preview', 'ppt_export'])

export type PptDeckCardPhase = 'directions' | 'review' | 'qa_failed' | 'exported'

export type PptDeckCardState = {
  blockId: string
  deck: string
  deckTitle: string
  phase: PptDeckCardPhase
  workflowId?: string
  childId?: string
  pageCount: number
  revision: number
  imageAssets?: 'enabled' | 'disabled' | 'unavailable'
  directions?: { count: number; recommendedName?: string }
  images: { user: number; generated: number; project: number; nativeSlides: number }
  /** Layout hints from the built-in preview lint. */
  lintIssues: number
  /** Geometry QA counts from the latest export. */
  qa?: { errors: number; warnings: number }
  pptx?: { output: string; slides?: number; editableSlides?: number }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record).filter((entry): entry is Record<string, unknown> => Boolean(entry)) : []
}

function parseJson(value: string | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined
  try {
    return record(JSON.parse(value))
  } catch {
    return undefined
  }
}

function slideImages(slides: Array<Record<string, unknown>>): PptDeckCardState['images'] {
  const origins = new Map<string, string>()
  let nativeSlides = 0
  for (const slide of slides) {
    const assets = records(slide.assets)
    if (assets.length === 0) nativeSlides += 1
    for (const asset of assets) {
      const path = text(asset.path)
      const origin = text(asset.origin)
      if (path && origin) origins.set(path, origin)
    }
  }
  const count = (origin: string) => [...origins.values()].filter((value) => value === origin).length
  return { user: count('user'), generated: count('generated'), project: count('project'), nativeSlides }
}

export function isPptDeckToolBlock(block: ChatBlock): block is ToolBlock {
  return block.kind === 'tool' && typeof block.meta?.toolName === 'string' && PPT_DECK_TOOL_NAMES.has(block.meta.toolName.trim())
}

/** Parse a settled deck tool result; running calls and unrelated errors return undefined. */
export function readPptDeckCard(block: ChatBlock): PptDeckCardState | undefined {
  if (!isPptDeckToolBlock(block) || (block.status !== 'success' && block.status !== 'error')) return undefined
  const output = parseJson(block.detail)
  const deck = text(output?.deck)
  if (!output || !deck) return undefined
  const toolName = typeof block.meta?.toolName === 'string' ? block.meta.toolName.trim() : ''
  const imageAssets = output.imageAssets === 'enabled' || output.imageAssets === 'disabled' || output.imageAssets === 'unavailable'
    ? output.imageAssets
    : undefined
  const direction = record(output.directionBundle)
  if (direction) {
    const directions = records(direction.directions)
    return {
      blockId: block.id,
      deck,
      deckTitle: text(direction.deckTitle) ?? deck,
      phase: 'directions',
      workflowId: text(direction.workflowId),
      childId: text(direction.childId),
      pageCount: records(direction.slides).length,
      revision: Math.max(0, ...directions.map((entry) => typeof entry.revision === 'number' ? entry.revision : 0)),
      ...(imageAssets ? { imageAssets } : {}),
      directions: { count: directions.length, recommendedName: text(directions.find((entry) => entry.recommended === true)?.name) },
      images: { user: 0, generated: 0, project: 0, nativeSlides: 0 },
      lintIssues: 0
    }
  }
  const review = record(output.reviewBundle)
  if (!review) return undefined
  const slides = records(review.slides)
  const exported = toolName === 'ppt_export' && output.validated === true ? text(output.output) : undefined
  const qaCounts = record(record(output.qa)?.counts)
  const qa = qaCounts && typeof qaCounts.errors === 'number' && typeof qaCounts.warnings === 'number'
    ? { errors: qaCounts.errors, warnings: qaCounts.warnings }
    : undefined
  return {
    blockId: block.id,
    deck,
    deckTitle: text(output.deckTitle) ?? text(review.deckTitle) ?? deck,
    phase: exported ? 'exported' : toolName === 'ppt_export' ? 'qa_failed' : 'review',
    workflowId: text(review.workflowId),
    childId: text(review.childId),
    pageCount: slides.length,
    revision: Math.max(0, ...slides.map((slide) => typeof slide.revision === 'number' ? slide.revision : 0)),
    ...(imageAssets ? { imageAssets } : {}),
    images: slideImages(slides),
    lintIssues: toolName === 'ppt_preview' && Array.isArray(output.issues) ? output.issues.length : 0,
    ...(qa ? { qa } : {}),
    ...(exported
      ? {
          pptx: {
            output: exported,
            ...(typeof output.slides === 'number' ? { slides: output.slides } : {}),
            ...(typeof output.editableSlides === 'number' ? { editableSlides: output.editableSlides } : {})
          }
        }
      : {})
  }
}

/** The latest card per deck among these blocks, in first-seen deck order. */
export function latestPptDeckCards(blocks: readonly ChatBlock[]): PptDeckCardState[] {
  const latest = new Map<string, PptDeckCardState>()
  for (const block of blocks) {
    const card = readPptDeckCard(block)
    if (card) latest.set(card.deck, card)
  }
  return [...latest.values()]
}

/** True when a later deck call for the same deck exists, so this card's actions are stale. */
export function pptDeckHasLaterCall(blocks: readonly ChatBlock[], blockId: string, deck: string): boolean {
  const index = blocks.findIndex((block) => block.id === blockId)
  if (index < 0) return false
  return blocks.slice(index + 1).some((block) => readPptDeckCard(block)?.deck === deck)
}
