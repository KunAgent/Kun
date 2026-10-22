import { useMemo, type ReactElement, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { Check, FileText, FolderOpen, Hourglass, Minus, PanelRightOpen, X } from 'lucide-react'
import type { ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { requestCodeCanvasPanelOpen } from '../../lib/code-canvas-panel-event'
import { readChildActivityFromBlock } from './explore-peek-summary'
import {
  pptAgentAction,
  pptAgentProgress,
  pptWorkflowHasLaterCall,
  pptWorkflowUsedDirections,
  readPptAgentResult,
  type PptProgressStepId,
  type PptProgressStepState
} from './ppt-agent-progress'

const STEP_LABEL_KEYS: Readonly<Record<PptProgressStepId, string>> = {
  plan: 'pptProgressStepPlan',
  direction: 'pptProgressStepDirection',
  build: 'pptProgressStepBuild',
  preview: 'pptProgressStepPreview',
  review: 'pptProgressStepReview',
  export: 'pptProgressStepExport'
}

const DOT_CLASS: Readonly<Record<PptProgressStepState, string>> = {
  done: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  current: 'bg-accent text-white motion-safe:animate-pulse',
  waiting: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  error: 'bg-red-500/10 text-red-600 dark:text-red-300',
  skipped: 'bg-ds-hover text-ds-faint',
  todo: 'bg-ds-hover text-ds-faint'
}

function StepDot({ state, index }: { state: PptProgressStepState; index: number }): ReactElement {
  const icon = state === 'done' ? <Check className="h-3 w-3" strokeWidth={2.6} />
    : state === 'waiting' ? <Hourglass className="h-3 w-3" strokeWidth={2.2} />
      : state === 'error' ? <X className="h-3 w-3" strokeWidth={2.6} />
        : state === 'skipped' ? <Minus className="h-3 w-3" strokeWidth={2.6} />
          : <span className="text-[10.5px] font-bold leading-none">{index + 1}</span>
  return (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${DOT_CLASS[state]}`} aria-hidden="true">
      {icon}
    </span>
  )
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
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
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
 * PPT-specific band inside the subagent card: the workflow stepper, what the
 * child put on the whiteboard, where slide images came from, and the next
 * user action. Actions only send an ordinary user turn to the main agent,
 * which resumes the same PPT child; nothing here talks to the child directly.
 */
export function PptAgentProgressPanel({ block, status, t }: {
  block: ToolBlock
  status: string
  t: TFunction<'common'>
}): ReactElement | null {
  const result = useMemo(() => readPptAgentResult(block.detail), [block.detail])
  const action = pptAgentAction(block)
  const workflowId = result?.workflowId
  const usedDirections = useChatStore((s) => pptWorkflowUsedDirections(s.blocks ?? [], workflowId))
  const stale = useChatStore((s) => pptWorkflowHasLaterCall(s.blocks ?? [], block.id, workflowId))
  const busy = useChatStore((s) => s.busy)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const activityTool = readChildActivityFromBlock(block)?.toolName
  const progress = pptAgentProgress({
    action,
    result,
    running: status === 'running' || status === 'queued',
    failed: status === 'failed' || block.status === 'error',
    activityTool,
    usedDirections
  })
  const phase = result?.phase
  const review = result?.review
  const deck = result?.deck
  const send = (text: string): void => {
    if (busy || !sendMessage) return
    void sendMessage(text, 'agent').catch(() => false)
  }
  const openBoard = (): void => requestCodeCanvasPanelOpen({
    reason: phase === 'awaiting_direction' ? 'ppt-direction' : 'ppt-review',
    blockId: block.id,
    ...(workflowId ? { workflowId } : {}),
    ...(result?.childId ? { childId: result.childId } : {})
  })
  const deckTarget = deck ? { path: deck.output, ...(workspaceRoot ? { workspaceRoot } : {}) } : undefined
  const recommended = result?.directions?.recommendedName

  return (
    <div className="border-t border-ds-border-muted px-4 py-3" data-testid="ppt-agent-progress">
      <ol className="flex min-w-0 items-center gap-1.5" aria-label={t('pptProgressStepsLabel')}>
        {progress.steps.map((step, index) => {
          const label = t(STEP_LABEL_KEYS[step.id])
          const title = step.state === 'skipped' ? t('pptProgressStepSkipped', { step: label })
            : step.state === 'waiting' ? t('pptProgressStepWaiting', { step: label })
              : step.state === 'error' ? t('pptProgressStepFailed', { step: label })
                : label
          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1.5" title={title} data-step={step.id} data-state={step.state}>
              <StepDot state={step.state} index={index} />
              <span className={`truncate text-[12px] ${
                step.state === 'current' || step.state === 'waiting' ? 'font-semibold text-ds-ink'
                  : step.state === 'done' ? 'text-ds-muted' : 'text-ds-faint'
              }`}>{label}</span>
              {index < progress.steps.length - 1 ? (
                <span className={`h-px min-w-2 flex-1 ${step.state === 'done' ? 'bg-emerald-500/40' : 'bg-ds-border-muted'}`} aria-hidden="true" />
              ) : null}
            </li>
          )
        })}
      </ol>

      {phase === 'awaiting_direction' && result?.directions ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ds-muted">
          <span className="text-ds-ink">{t('pptProgressDirections', { n: result.directions.count })}</span>
          {recommended ? <Chip>{t('pptProgressRecommended', { name: recommended })}</Chip> : null}
          <Chip>{t('pptProgressSamplesRendered')}</Chip>
        </div>
      ) : null}

      {review && phase !== 'awaiting_direction' ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ds-muted">
          {phase === 'awaiting_review'
            ? <span className="text-ds-ink">{t('pptProgressPreviews', { n: review.slides })}</span>
            : null}
          <span className="text-ds-faint">{t('pptProgressImagesLabel')}</span>
          {review.userImages > 0 ? <Chip tone="user">{t('pptProgressAssetUser', { n: review.userImages })}</Chip> : null}
          {review.generatedImages > 0 ? <Chip tone="generated">{t('pptProgressAssetGenerated', { n: review.generatedImages })}</Chip> : null}
          {review.projectImages > 0 ? <Chip>{t('pptProgressAssetProject', { n: review.projectImages })}</Chip> : null}
          <Chip>{t('pptProgressNativeSlides', { n: review.nativeSlides })}</Chip>
          {result?.imageAssets === 'unavailable' ? <span className="text-ds-faint">{t('pptProgressImageAssetsUnavailable')}</span> : null}
          {result?.imageAssets === 'disabled' ? <span className="text-ds-faint">{t('pptProgressImageAssetsDisabled')}</span> : null}
          {review.qa ? <span className="text-ds-faint">{t('pptProgressQa', { errors: review.qa.errors, warnings: review.qa.warnings })}</span> : null}
        </div>
      ) : null}

      {deck && phase === 'completed' ? (
        <div className="mt-2.5 flex min-w-0 items-center gap-2.5 rounded-[10px] bg-ds-hover px-3 py-2" data-testid="ppt-agent-deck">
          <FileText className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.8} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-ds-ink" title={deck.output}>{deck.output}</span>
            <span className="block text-[11.5px] text-ds-muted">
              {typeof deck.slides === 'number'
                ? t('pptProgressDeckMeta', { n: deck.slides, editable: deck.editableSlides ?? deck.slides })
                : null}
              {deck.validated ? ` · ${t('pptProgressValidated')}` : null}
            </span>
          </span>
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 empty:hidden">
        {(phase === 'awaiting_direction' || phase === 'awaiting_review' || (phase === 'completed' && review)) ? (
          <ActionButton onClick={openBoard} testId="ppt-agent-open-board">
            <PanelRightOpen className="h-3.5 w-3.5" strokeWidth={2} />
            {t('pptProgressOpenBoard')}
          </ActionButton>
        ) : null}
        {phase === 'awaiting_direction' && recommended && !stale && !busy ? (
          <ActionButton primary onClick={() => send(t('pptProgressUseRecommendedMessage', { name: recommended }))} testId="ppt-agent-use-recommended">
            {t('pptProgressUseRecommended')}
          </ActionButton>
        ) : null}
        {phase === 'awaiting_review' && !stale && !busy ? (
          <ActionButton primary onClick={() => send(t('pptProgressApproveMessage'))} testId="ppt-agent-approve">
            {t('pptProgressApprove')}
          </ActionButton>
        ) : null}
        {deckTarget && phase === 'completed' ? (
          <>
            <ActionButton primary onClick={() => void window.kunGui?.openWorkspaceFileInSystem?.(deckTarget)} testId="ppt-agent-open-deck">
              {t('pptProgressOpenDeck')}
            </ActionButton>
            {workspaceRoot ? (
              <ActionButton
                onClick={() => void window.kunGui?.revealWorkspaceFileInFolder?.({ path: deck!.output, workspaceRoot })}
                testId="ppt-agent-reveal-deck"
              >
                <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} />
                {t('pptProgressRevealDeck')}
              </ActionButton>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
