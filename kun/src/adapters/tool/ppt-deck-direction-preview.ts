import { readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { asRecord, asString, loadPptdDeck, type PptdDeck } from '../../ppt/pptd-deck.js'
import { renderPptdPageSvg } from '../../ppt/pptd-preview-svg.js'
import {
  PPT_DECK_PREVIEW_MANIFEST,
  PPT_DECK_REVIEW_DIR,
  nextPreviewRevision,
  pptDeckWorkflowId,
  readPptDeckPreviewManifest,
  sha256,
  writePptDeckPreviewManifest,
  type PptDeckDirectionBundle,
  type PptDeckPreviewEntry
} from '../../ppt/ppt-deck-preview.js'
import { resolvePptDeck, writePptReviewFile, type PptDeckLocation } from './ppt-deck-tool-support.js'

export type PptDirectionInput = {
  name: string
  rationale: string
  recommended: boolean
  deck: string
  layout: string
  imagery: string
}

const ROLES = ['cover', 'representative', 'complex'] as const
const DIRECTION_FILE = /^dir_[a-f0-9]{12}-r\d+-(cover|representative|complex)\.svg$/

/** Fonts, palette, and background a sample deck declares in its theme. */
export function pptDeckThemeSummary(deck: PptdDeck): { fonts: string[]; colors: string[]; background: string } {
  const colors = Object.values(deck.colors)
    .map((value) => typeof value === 'string' ? value.trim().slice(0, 7).toUpperCase() : '')
    .filter((value) => /^#[0-9A-F]{6}$/.test(value))
  const fonts: string[] = []
  for (const style of Object.values(asRecord(deck.theme.textStyles) ?? {})) {
    const family = asRecord(style)?.fontFamily
    const names = typeof family === 'string' ? [family] : [asString(asRecord(family)?.latin), asString(asRecord(family)?.ea)]
    for (const name of names) if (name?.trim() && !fonts.includes(name.trim())) fonts.push(name.trim())
  }
  const background = asString(asRecord(deck.pages[0]?.record.background)?.type) ?? 'solid'
  return { fonts, colors: [...new Set(colors)], background }
}

function validateInputs(inputs: readonly PptDirectionInput[]): void {
  if (inputs.length !== 3) throw new Error('compare exactly three directions')
  if (inputs.filter((input) => input.recommended).length !== 1) throw new Error('mark exactly one direction as recommended')
  for (const input of inputs) {
    for (const field of ['name', 'rationale', 'deck', 'layout', 'imagery'] as const) {
      if (!input[field]) throw new Error(`each direction needs a ${field}`)
    }
  }
  if (new Set(inputs.map((input) => input.deck)).size !== 3) throw new Error('each direction needs its own sample deck folder')
}

/**
 * Render three 3-page sample decks for the direction whiteboard. Each
 * direction keeps a stable id per sample folder and bumps its revision only
 * when its pages changed. Nothing here gates the workflow: the agent asks the
 * user which direction to use and then builds the main deck.
 */
export async function previewPptDirections(
  main: PptDeckLocation,
  inputs: readonly PptDirectionInput[],
  context: ToolHostContext
): Promise<{ deck: string; directions: Array<{ directionId: string; name: string; deck: string; recommended: boolean }>; directionBundle: PptDeckDirectionBundle }> {
  validateInputs(inputs)
  const previous = await readPptDeckPreviewManifest(main.physicalProjectDir)
  const entries: PptDeckPreviewEntry[] = []
  const directions: PptDeckDirectionBundle['directions'] = []
  const summaries: Array<{ directionId: string; name: string; deck: string; recommended: boolean }> = []
  let recommendedDeck: PptdDeck | undefined
  let recommendedTitles: string[] = []
  let recommendedId = ''
  for (const input of inputs) {
    const sample = await resolvePptDeck(input.deck, context, { requireManifest: true })
    const loaded = await loadPptdDeck(sample.manifestPath!)
    if (loaded.pages.length !== ROLES.length) {
      throw new Error(`direction "${input.name}" needs exactly 3 sample pages (cover, representative content, most complex page); ${sample.projectRelative} has ${loaded.pages.length}`)
    }
    if (Math.abs(loaded.pageSize.width / loaded.pageSize.height - 16 / 9) > 0.02) {
      throw new Error(`direction "${input.name}" must use a 16:9 page size`)
    }
    const theme = pptDeckThemeSummary(loaded)
    if (theme.colors.length < 4) throw new Error(`direction "${input.name}" must define at least 4 theme colors in its .pptd`)
    if (theme.fonts.length === 0) throw new Error(`direction "${input.name}" must name its fonts in theme.textStyles`)
    // The sample folder is the direction's identity, so a board pick names the deck to build from.
    const directionId = sample.projectRelative
    const fileKey = `dir_${sha256(sample.projectRelative).slice(0, 12)}`
    const pages = await Promise.all(loaded.pages.map((page) => renderPptdPageSvg(loaded, page)))
    const svgHash = sha256(pages.map((page) => page.svg).join('\n'))
    const { revision } = nextPreviewRevision(previous.directions.find((entry) => entry.key === directionId), svgHash)
    const previews: PptDeckDirectionBundle['directions'][number]['previews'] = []
    for (const [index, role] of ROLES.entries()) {
      const imagePath = await writePptReviewFile(main, `directions/${fileKey}-r${revision}-${role}.svg`, pages[index].svg)
      previews.push({ role, imagePath })
    }
    entries.push({ key: directionId, slideId: fileKey, revision, svgHash, previewPath: previews[0].imagePath })
    directions.push({
      directionId,
      name: input.name,
      rationale: input.rationale,
      revision,
      recommended: input.recommended,
      fonts: theme.fonts.length === 1 ? [theme.fonts[0], theme.fonts[0]] : theme.fonts,
      colors: theme.colors,
      layout: input.layout,
      background: theme.background,
      imagery: input.imagery,
      previews
    })
    summaries.push({ directionId, name: input.name, deck: sample.projectRelative, recommended: input.recommended })
    if (input.recommended) {
      recommendedDeck = loaded
      recommendedTitles = pages.map((page) => page.title)
      recommendedId = directionId
    }
  }
  const keepPrefixes = [...entries, ...previous.directions].map((entry) => `${entry.slideId}-r${entry.revision}-`)
  const directionDir = join(main.physicalProjectDir, PPT_DECK_REVIEW_DIR, 'directions')
  for (const name of await readdir(directionDir).catch(() => [] as string[])) {
    if (DIRECTION_FILE.test(name) && !keepPrefixes.some((prefix) => name.startsWith(prefix))) {
      await rm(join(directionDir, name), { force: true })
    }
  }
  await writePptDeckPreviewManifest(main.physicalProjectDir, { ...previous, version: 1, directions: entries })
  return {
    deck: main.projectRelative,
    directions: summaries,
    directionBundle: {
      schemaVersion: 1,
      workflowId: pptDeckWorkflowId(main.projectRelative),
      childId: context.threadId,
      manifestPath: main.projectRelative === '.' ? PPT_DECK_PREVIEW_MANIFEST : `${main.projectRelative}/${PPT_DECK_PREVIEW_MANIFEST}`,
      previewMode: 'editable',
      deckTitle: recommendedDeck!.title || basename(main.physicalProjectDir),
      phase: 'awaiting_direction',
      recommendedDirectionId: recommendedId,
      slides: recommendedTitles.map((title, index) => ({ slideId: `${recommendedId}:${index + 1}`, index, title })),
      directions
    }
  }
}
