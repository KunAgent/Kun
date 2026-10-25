import type { ComposerContextAttachment } from '@kun/extension-api'
import type { WorkspaceOfficeSelection, WorkspacePresentationViewReference } from '@shared/office-document'
import type { DesignComposerContext } from '../../design/design-composer-context'
import { createWorkspaceOfficeViewPositionAttachment } from '../../lib/workspace-office-view-context'
import { normalizeWriteQuotedSelections, type WriteQuotedSelection } from '../../write/quoted-selection'
import { createWriteTurnReferenceAttachments, mergeWriteComposerContexts } from '../../write/write-turn-reference-context'
import { writeBasenameFromPath, writeJoinPath } from '../../write/write-workspace-store-helpers'
import type { LibraryArtifact } from '../artifact-types'

/** What the viewer is showing when the user writes to Kun. */
export type ArtifactChatView = {
  /** Slide on screen in the deck viewer. */
  presentation: WorkspacePresentationViewReference | null
  /** Live selection: Word or slide text, or a cell range. */
  selection: WorkspaceOfficeSelection | null
  /** Passages pinned with the viewer's quote action; they stay until sent. */
  quotes: WriteQuotedSelection[]
  /** The user removed the automatic chip; the turn targets the whole file. */
  detached: boolean
}

export const EMPTY_ARTIFACT_CHAT_VIEW: ArtifactChatView = { presentation: null, selection: null, quotes: [], detached: false }

export const ARTIFACT_VIEW_CHIP_ID = 'artifact-view'
export const ARTIFACT_SELECTION_CHIP_ID = 'artifact-selection'

type Translate = (key: string, options?: Record<string, unknown>) => string

function excerpt(text: string, max = 24): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(compact)
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : compact
}

function liveSelection(view: ArtifactChatView): WorkspaceOfficeSelection | null {
  return !view.detached && view.selection && view.selection.charCount > 0 ? view.selection : null
}

export function artifactSelectionQuote(
  selection: WorkspaceOfficeSelection,
  artifact: Pick<LibraryArtifact, 'path' | 'workspaceRoot'>,
  now = Date.now()
): WriteQuotedSelection | null {
  const text = selection.text.trim()
  if (!text || selection.charCount <= 0) return null
  const quote: WriteQuotedSelection = {
    id: `artifact-quote-${now}-${Math.random().toString(36).slice(2)}`,
    text,
    sourceKind: selection.sourceKind,
    sourceFormat: selection.sourceFormat,
    sourceTitle: artifact.path,
    sourceFilePath: writeJoinPath(artifact.workspaceRoot, artifact.path),
    ...(selection.sourceKind === 'word'
      ? { pageStart: selection.pageStart, pageEnd: selection.pageEnd ?? selection.pageStart }
      : selection.sourceKind === 'presentation'
        ? { slide: selection.slide }
        : selection.sourceKind === 'spreadsheet'
          ? { sheetName: selection.sheetName, cellRange: selection.cellRange, ...(selection.formulas?.length ? { formulas: selection.formulas } : {}) }
          : {}),
    charCount: selection.charCount,
    createdAt: new Date(now).toISOString()
  }
  return normalizeWriteQuotedSelections([quote])[0] ?? null
}

/** Chips inside the composer: pinned quotes, then the live selection or the slide on screen. */
export function artifactContextChips(view: ArtifactChatView, t: Translate): DesignComposerContext[] {
  const chips: DesignComposerContext[] = view.quotes.map((quote) => ({
    id: quote.id,
    kind: 'document-quote',
    label: quote.sourceKind === 'spreadsheet' && quote.cellRange
      ? t('artifactChatChipRange', { range: `${quote.sheetName ?? ''}!${quote.cellRange}` })
      : t('artifactChatChipQuote', { text: excerpt(quote.text) }),
    removable: true
  }))
  const selection = liveSelection(view)
  if (selection) {
    chips.push({
      id: ARTIFACT_SELECTION_CHIP_ID,
      kind: 'document-quote',
      label: selection.sourceKind === 'spreadsheet' && selection.cellRange
        ? t('artifactChatChipRange', { range: `${selection.sheetName ?? ''}!${selection.cellRange}` })
        : t('artifactChatChipSelection', { text: excerpt(selection.text) }),
      removable: true
    })
  } else if (!view.detached && view.presentation) {
    chips.push({
      id: ARTIFACT_VIEW_CHIP_ID,
      kind: 'design-target',
      label: t('artifactChatChipSlide', { slide: view.presentation.slide }),
      removable: true
    })
  }
  return chips
}

export function artifactTurnQuotes(view: ArtifactChatView, artifact: Pick<LibraryArtifact, 'path' | 'workspaceRoot'>): WriteQuotedSelection[] {
  const selection = liveSelection(view)
  const live = selection ? artifactSelectionQuote(selection, artifact) : null
  return normalizeWriteQuotedSelections(live ? [...view.quotes, live] : view.quotes)
}

/** The same structured context a Work turn carries: the file as a writable resource, quotes and the slide on screen. */
export async function artifactTurnContexts(input: {
  artifact: Pick<LibraryArtifact, 'path' | 'workspaceRoot' | 'ext'>
  view: ArtifactChatView
  query: string
  now?: number
}): Promise<ComposerContextAttachment[]> {
  const { artifact, view } = input
  const references = await createWriteTurnReferenceAttachments({
    workspaceRoot: artifact.workspaceRoot,
    activeResource: {
      sourceName: writeBasenameFromPath(artifact.path),
      locator: artifact.path,
      resourceKind: 'office',
      access: 'read-write',
      sourceFormat: artifact.ext.replace(/^\./, '').toLowerCase()
    },
    selections: artifactTurnQuotes(view, artifact),
    retrieval: null,
    officeDocument: null,
    query: input.query,
    ...(input.now !== undefined ? { now: input.now } : {})
  })
  const views = !view.detached && view.presentation
    ? [await createWorkspaceOfficeViewPositionAttachment({ workspaceRoot: artifact.workspaceRoot, view: view.presentation, ...(input.now !== undefined ? { now: input.now } : {}) })]
    : []
  return mergeWriteComposerContexts(references, views, [])
}

/** The request plus one line naming the file, so the turn edits it even outside Work mode. */
export function artifactTurnPrompt(request: string, artifact: Pick<LibraryArtifact, 'path'>, view: ArtifactChatView): string {
  const slide = !view.detached && view.presentation
    ? ` The user is looking at slide ${view.presentation.slide} of ${view.presentation.slideCount}.`
    : ''
  return `${request.trim()}\n\n(Target file: \`${artifact.path}\` in this workspace. Apply requested changes to that file directly; the open viewer reloads it.${slide})`
}
