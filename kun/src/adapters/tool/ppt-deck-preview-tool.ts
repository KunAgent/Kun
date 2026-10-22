import { readdir, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { asRecord, loadPptdDeck, type PptdDeck } from '../../ppt/pptd-deck.js'
import { lintPptdDeck } from '../../ppt/pptd-lint.js'
import { renderPptdPageSvg } from '../../ppt/pptd-preview-svg.js'
import {
  PPT_DECK_PREVIEW_MANIFEST,
  PPT_DECK_REVIEW_DIR,
  nextPreviewRevision,
  pptDeckPreviewFileKey,
  pptDeckWorkflowId,
  readPptDeckPreviewManifest,
  sha256,
  writePptDeckPreviewManifest,
  type PptDeckPreviewEntry,
  type PptDeckReviewBundle
} from '../../ppt/ppt-deck-preview.js'
import { withToolBoundary } from './builtin-tool-utils.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { pptSlideAssets, readPptAssetLedger } from './ppt-asset-ledger.js'
import { previewPptDirections, type PptDirectionInput } from './ppt-deck-direction-preview.js'
import {
  portableRelative,
  pptImageAssetState,
  pptToolsDisabled,
  resolvePptDeck,
  stringArg,
  writePptReviewFile,
  type PptDeckLocation,
  type PptDeckToolOptions
} from './ppt-deck-tool-support.js'
import { assertCanWritePath } from './sandbox-policy.js'

export const PPT_PREVIEW_TOOL_NAME = 'ppt_preview'

const PREVIEW_FILE = /^slide_[a-f0-9]{16}-r\d+\.svg$/

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

function styleFingerprint(deck: PptdDeck): string {
  return sha256(JSON.stringify({ size: deck.pageSize, theme: deck.theme })).slice(0, 32)
}

/**
 * Render every page, write SVGs only for pages whose output changed, and
 * return the review bundle the whiteboard projects. Shared by ppt_preview and
 * ppt_export (which refreshes the board before attaching QA results).
 */
export async function refreshPptDeckPreview(deck: PptDeckLocation, context: ToolHostContext): Promise<{
  bundle: PptDeckReviewBundle
  changedPages: number[]
  issues: ReturnType<typeof lintPptdDeck>
  deckTitle: string
}> {
  if (!deck.manifestPath) throw new Error('the deck folder has no .pptd manifest yet')
  assertCanWritePath(join(deck.projectDir, PPT_DECK_REVIEW_DIR), context)
  const loaded = await loadPptdDeck(deck.manifestPath)
  const previous = await readPptDeckPreviewManifest(deck.physicalProjectDir)
  const ledger = await readPptAssetLedger(deck.physicalProjectDir)
  const entries: PptDeckPreviewEntry[] = []
  const changedPages: number[] = []
  const slides: PptDeckReviewBundle['slides'] = []
  for (const page of loaded.pages) {
    const rendered = await renderPptdPageSvg(loaded, page)
    // Slide cards are keyed by page file, so board feedback names the page to edit.
    const slideId = page.file
    const fileKey = pptDeckPreviewFileKey(page.file)
    const svgHash = sha256(rendered.svg)
    const prior = previous.slides.find((entry) => entry.key === page.file)
    const { revision, changed } = nextPreviewRevision(prior, svgHash)
    const fileName = `previews/${fileKey}-r${revision}.svg`
    const absolute = join(deck.physicalProjectDir, PPT_DECK_REVIEW_DIR, fileName)
    const previewPath = changed || !await exists(absolute)
      ? await writePptReviewFile(deck, fileName, rendered.svg)
      : portableRelative(deck.physicalWorkspaceRoot, absolute)
    if (changed) changedPages.push(page.index + 1)
    entries.push({ key: page.file, slideId: fileKey, revision, svgHash, previewPath })
    const assets = pptSlideAssets(
      rendered.imageSlots.map((slot) => ({
        path: portableRelative(deck.physicalProjectDir, resolve(loaded.deckDir, slot.path)),
        rect: slot.rect
      })),
      ledger,
      (projectRelative) => portableRelative(deck.physicalWorkspaceRoot, resolve(deck.physicalProjectDir, projectRelative))
    )
    slides.push({
      slideId,
      index: page.index,
      title: rendered.title,
      previewPath,
      revision,
      status: 'ready',
      ...(assets.length ? { assets } : {})
    })
  }
  const keep = new Set([...entries, ...previous.slides].map((entry) => basename(entry.previewPath)))
  const previewDir = join(deck.physicalProjectDir, PPT_DECK_REVIEW_DIR, 'previews')
  for (const name of await readdir(previewDir).catch(() => [] as string[])) {
    if (PREVIEW_FILE.test(name) && !keep.has(name)) await rm(join(previewDir, name), { force: true })
  }
  await writePptDeckPreviewManifest(deck.physicalProjectDir, { ...previous, version: 1, slides: entries })
  const deckTitle = loaded.title || basename(deck.physicalProjectDir)
  return {
    deckTitle,
    changedPages,
    issues: lintPptdDeck(loaded),
    bundle: {
      workflowId: pptDeckWorkflowId(deck.projectRelative),
      childId: context.threadId,
      manifestPath: deck.projectRelative === '.' ? PPT_DECK_PREVIEW_MANIFEST : `${deck.projectRelative}/${PPT_DECK_PREVIEW_MANIFEST}`,
      deckTitle,
      styleFingerprint: styleFingerprint(loaded),
      phase: 'awaiting_review',
      slides
    }
  }
}

function directionInputs(value: unknown): PptDirectionInput[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((entry) => {
    const record = asRecord(entry) ?? {}
    return {
      name: stringArg(record.name),
      rationale: stringArg(record.rationale),
      recommended: record.recommended === true,
      deck: stringArg(record.deck),
      layout: stringArg(record.layout),
      imagery: stringArg(record.imagery)
    }
  })
}

export function createPptPreviewTool(options: PptDeckToolOptions): LocalTool {
  return LocalToolHost.defineTool({
    name: PPT_PREVIEW_TOOL_NAME,
    description: [
      'Render an editable PPTD deck with Kun\'s built-in renderer and put the pages on the review whiteboard.',
      'Only pages whose output changed get a new revision, so call it again after every edit.',
      'Returns a compact summary: changed pages, layout warnings to fix, and each slide\'s image origins.',
      'Pass exactly three `directions` (each a 3-page sample deck: cover, representative content, most complex page) to compare visual directions instead; `deck` is then the folder the final deck will live in.'
    ].join(' '),
    toolKind: 'file_change',
    policy: 'auto',
    sideEffect: 'unknown',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise: () => options.enabled?.() !== false,
    inputSchema: {
      type: 'object',
      properties: {
        deck: { type: 'string', description: 'Workspace-relative .pptd file or deck folder.' },
        directions: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          description: 'Optional visual-direction comparison. Exactly one must be recommended.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Short direction name shown to the user.' },
              rationale: { type: 'string', description: 'One sentence on why this direction fits.' },
              recommended: { type: 'boolean' },
              deck: { type: 'string', description: 'Workspace-relative folder of this 3-page sample deck.' },
              layout: { type: 'string', description: 'Layout system in a few words.' },
              imagery: { type: 'string', description: 'Imagery strategy in a few words.' }
            },
            required: ['name', 'rationale', 'recommended', 'deck', 'layout', 'imagery'],
            additionalProperties: false
          }
        }
      },
      required: ['deck'],
      additionalProperties: false
    },
    execute: async (args, context) => withToolBoundary(async () => {
      const disabled = pptToolsDisabled(options)
      if (disabled) return disabled
      const directions = directionInputs(args.directions)
      if (directions) {
        const main = await resolvePptDeck(stringArg(args.deck), context, { requireManifest: false, create: true })
        return { output: { ...await previewPptDirections(main, directions, context), imageAssets: pptImageAssetState(options) } }
      }
      const deck = await resolvePptDeck(stringArg(args.deck), context, { requireManifest: true })
      const preview = await refreshPptDeckPreview(deck, context)
      return {
        output: {
          deck: deck.projectRelative,
          deckTitle: preview.deckTitle,
          pageCount: preview.bundle.slides.length,
          changedPages: preview.changedPages,
          imageAssets: pptImageAssetState(options),
          issues: preview.issues,
          reviewBundle: preview.bundle
        }
      }
    })
  })
}
