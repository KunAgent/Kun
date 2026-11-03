import { useMemo, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, FolderOpen, PanelRightOpen, Presentation } from 'lucide-react'
import type { ChatBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { requestCodeCanvasPanelOpen } from '../../lib/code-canvas-panel-event'
import { latestPptDeckCards, pptDeckHasLaterCall, type PptDeckCardPhase, type PptDeckCardState } from './ppt-deck-card-model'

const STATE_CLASS: Readonly<Record<PptDeckCardPhase, string>> = {
  directions: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  review: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  qa_failed: 'bg-red-500/10 text-red-600 dark:text-red-300',
  exported: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
}

const STATE_LABEL_KEYS: Readonly<Record<PptDeckCardPhase, string>> = {
  directions: 'pptDeckStateDirections',
  review: 'pptDeckStateReview',
  qa_failed: 'pptDeckStateQaFailed',
  exported: 'pptDeckStateExported'
}

function Chip({ tone = 'neutral', children }: { tone?: 'neutral' | 'user' | 'generated'; children: ReactNode }): ReactElement {
  const toneClass = tone === 'user'
    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : tone === 'generated'
      ? 'bg-accent-tint/10 text-accent'
      : 'bg-ds-hover text-ds-muted'
  return <span className={`whitespace-nowrap rounded-full px-2 py-[2px] text-[11.5px] font-medium ${toneClass}`}>{children}</span>
}

function ActionButton({ primary = false, onClick, children, testId }: {
  primary?: boolean
  onClick: () => void
  children: ReactNode
  testId: string
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={primary
        ? 'flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-[12px] font-semibold text-white transition hover:opacity-90'
        : 'flex h-7 items-center gap-1 rounded-md bg-ds-hover px-2.5 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-subtle'}
      data-testid={testId}
    >
      {children}
    </button>
  )
}

/**
 * One deck's current state under the slides skill: what the whiteboard
 * shows, where slide images came from, and the next step. Actions send an
 * ordinary user turn to the main agent or open files; nothing here runs a
 * PPT workflow of its own.
 */
export function PptDeckCard({ card, readOnly = false }: { card: PptDeckCardState; readOnly?: boolean }): ReactElement {
  const { t } = useTranslation('common')
  const stale = useChatStore((s) => pptDeckHasLaterCall(s.blocks ?? [], card.blockId, card.deck))
  const busy = useChatStore((s) => s.busy)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const exported = card.phase === 'exported' ? card.pptx : undefined
  const meta = card.phase === 'directions'
    ? t('pptDeckMetaDirections', { deck: card.deck })
    : t(exported ? 'pptDeckMetaExported' : 'pptDeckMeta', { deck: card.deck, pages: card.pageCount, revision: card.revision })
  const openBoard = (): void => requestCodeCanvasPanelOpen({
    reason: card.phase === 'directions' ? 'ppt-direction' : 'ppt-review',
    blockId: card.blockId,
    ...(card.workflowId ? { workflowId: card.workflowId } : {}),
    ...(card.childId ? { childId: card.childId } : {})
  })
  const exportDeck = (): void => {
    if (busy || !sendMessage) return
    void sendMessage(t('pptDeckExportMessage'), 'agent').catch(() => false)
  }

  return (
    <div className="rounded-[14px] border border-ds-border bg-ds-card px-4 py-3" data-testid="ppt-deck-card" data-phase={card.phase}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <Presentation className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-ds-ink" title={card.deckTitle}>{card.deckTitle}</span>
          <span className="block truncate text-[12px] text-ds-muted" title={card.deck}>{meta}</span>
        </span>
        <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12px] font-semibold ${STATE_CLASS[card.phase]}`}>
          {t(STATE_LABEL_KEYS[card.phase])}
        </span>
      </div>

      {card.phase === 'directions' && card.directions ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ds-muted">
          <span className="text-ds-ink">{t('pptDeckDirections', { n: card.directions.count })}</span>
          {card.directions.recommendedName ? <Chip>{t('pptDeckRecommended', { name: card.directions.recommendedName })}</Chip> : null}
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ds-muted">
          <span className="text-ds-faint">{t('pptDeckImagesLabel')}</span>
          {card.images.user > 0 ? <Chip tone="user">{t('pptDeckAssetUser', { n: card.images.user })}</Chip> : null}
          {card.images.generated > 0 ? <Chip tone="generated">{t('pptDeckAssetGenerated', { n: card.images.generated })}</Chip> : null}
          {card.images.project > 0 ? <Chip>{t('pptDeckAssetProject', { n: card.images.project })}</Chip> : null}
          <Chip>{t('pptDeckNativeSlides', { n: card.images.nativeSlides })}</Chip>
          {card.imageAssets === 'unavailable' ? <span className="text-ds-faint">{t('pptDeckImageAssetsUnavailable')}</span> : null}
          {card.imageAssets === 'disabled' ? <span className="text-ds-faint">{t('pptDeckImageAssetsDisabled')}</span> : null}
          {card.qa
            ? <span className="text-ds-faint">{t('pptDeckQa', { errors: card.qa.errors, warnings: card.qa.warnings })}</span>
            : card.lintIssues > 0 ? <span className="text-ds-faint">{t('pptDeckLint', { n: card.lintIssues })}</span> : null}
        </div>
      )}

      {exported ? (
        <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-2.5 rounded-[10px] bg-ds-hover px-3 py-2" data-testid="ppt-deck-pptx">
          <FileText className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.8} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-ds-ink" title={exported.output}>{exported.output}</span>
            <span className="block text-[11.5px] text-ds-muted">
              {t('pptDeckPptxMeta', { n: exported.slides ?? card.pageCount, editable: exported.editableSlides ?? exported.slides ?? card.pageCount })}
            </span>
          </span>
          <ActionButton primary onClick={() => void window.kunGui?.openWorkspaceFileInSystem?.({ path: exported.output, ...(workspaceRoot ? { workspaceRoot } : {}) })} testId="ppt-deck-open">
            {t('pptDeckOpen')}
          </ActionButton>
          {workspaceRoot ? (
            <ActionButton onClick={() => void window.kunGui?.revealWorkspaceFileInFolder?.({ path: exported.output, workspaceRoot })} testId="ppt-deck-reveal">
              <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              {t('pptDeckReveal')}
            </ActionButton>
          ) : null}
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <ActionButton onClick={openBoard} testId="ppt-deck-open-board">
            <PanelRightOpen className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {t('pptDeckOpenBoard')}
          </ActionButton>
          {card.phase === 'review' && !readOnly && !stale && !busy ? (
            <ActionButton primary onClick={exportDeck} testId="ppt-deck-export">
              {t('pptDeckExport')}
            </ActionButton>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** Deck cards for one finished turn: the latest state of each deck its PPT tools touched. */
export function PptDeckCards({ blocks, readOnly = false }: { blocks: readonly ChatBlock[]; readOnly?: boolean }): ReactElement | null {
  const cards = useMemo(() => latestPptDeckCards(blocks), [blocks])
  if (cards.length === 0) return null
  return <div className="space-y-3">{cards.map((card) => <PptDeckCard key={card.blockId} card={card} readOnly={readOnly} />)}</div>
}
