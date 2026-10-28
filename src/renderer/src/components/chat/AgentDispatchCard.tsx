import { useTeamWorkers } from '../workers/use-team-workers'
import { useChatStore } from '../../store/chat-store'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, GitBranch, ShieldCheck, Split, Timer } from 'lucide-react'
import {
  AgentDispatchIntentPublicSchema,
  type AgentDispatchAssignmentRoute,
  type AgentDispatchIntentView
} from '@shared/agent-dispatch'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { useAgentDispatchIntent } from './use-agent-dispatch-intent'
import { AgentDispatchIntentControls } from './AgentDispatchIntentControls'
import { AgentDispatchStatusBadge } from './AgentDispatchStatusBadge'
import { AgentDispatchAssignmentList } from './AgentDispatchAssignmentList'
import { assignmentRoute, dispatchAssignments, dispatchRoutesEditable, replaceAssignmentRoute,
  sameAssignmentRoute } from './agent-dispatch-card-model'
import { openWorkerSession } from '../workers/worker-view-store'
import { TaskSuggestionCard } from './TaskSuggestionCard'
import { AgentIcon } from '../agent-icon'
import { agentIconId } from '../../lib/agent-icon-aliases'
import { isTaskSuggestionBlock } from './task-suggestion-card-model'
import { useDispatchInteractionHold } from './use-dispatch-interaction-hold'

export function isAgentDispatchBlock(block: ChatBlock): block is ToolBlock & { meta: Record<string, unknown> & { dispatchIntentId: string } } {
  return block.kind === 'tool' && typeof block.meta?.dispatchIntentId === 'string'
}

/** Cards that are a turn's outcome and may need the user: dispatch and task-suggestion cards. */
export function isOutcomeCardBlock(block: ChatBlock): boolean {
  return isAgentDispatchBlock(block) || isTaskSuggestionBlock(block)
}

/**
 * Dispatch and suggestion cards of one process run. Folded turns render them
 * outside the fold too: a waiting card needs the user, and a running one is the turn's outcome.
 */
export function AgentDispatchGroup({ blocks, readOnly = false }: { blocks: readonly ChatBlock[]; readOnly?: boolean }) {
  const cards = blocks.filter((block): block is ToolBlock => isOutcomeCardBlock(block))
  if (!cards.length) return null
  return <div className="space-y-3">{cards.map((block) => isTaskSuggestionBlock(block)
    ? <TaskSuggestionCard key={block.id} block={block} readOnly={readOnly} />
    : <AgentDispatchCard key={block.id} block={block} readOnly={readOnly} />)}</div>
}

type Draft = { title: string; task: string; routes: AgentDispatchAssignmentRoute[] }

const fieldClass = 'w-full rounded-lg border border-ds-border bg-ds-main px-2.5 py-2 text-ds-ink focus:border-accent focus:outline-none'

function AgentDispatchCard({ block, readOnly }: { block: ToolBlock; readOnly: boolean }) {
  const { t } = useTranslation('common')
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const id = block.meta!.dispatchIntentId as string
  const parsed = AgentDispatchIntentPublicSchema.safeParse(block.meta?.dispatchIntent)
  const { intent, act, busy, error } = useAgentDispatchIntent(id, parsed.success ? parsed.data : undefined)
  const { overview } = useTeamWorkers(intent?.source.threadId ?? null, Boolean(intent?.target?.dispatchIds?.length))
  const [draft, setDraft] = useState<Draft>()
  const [saveError, setSaveError] = useState('')
  const [routeFailed, setRouteFailed] = useState(false)
  const hold = useDispatchInteractionHold(intent, act, (ok) => setRouteFailed(!ok))
  const intentState = intent?.state
  // The editor belongs to a paused card; any other transition (resume elsewhere, cancel) closes it.
  useEffect(() => { if (intentState && intentState !== 'paused') setDraft(undefined) }, [intentState])
  if (!intent) return <section className="rounded-2xl border border-ds-border bg-ds-card p-4 text-[13px] text-ds-muted" role="status">
    {error || t('dispatchIntent.loading')}
  </section>
  const recommendation = intent.recommendation
  const assignments = dispatchAssignments(intent)
  const batch = assignments.length > 1
  const locked = readOnly || activeThreadId !== intent.source.threadId
  // Older batch cards carry one shared route that Kun keeps fixed.
  const canEditRoutes = !locked && dispatchRoutesEditable(intent) && (Boolean(recommendation.assignments) || !batch)
  const localRoutes = draft?.routes ?? hold.routes
  const shown = localRoutes ? assignments.map((assignment, index) => ({ label: assignment.label, ...localRoutes[index],
    ...(localRoutes[index].agentId === assignment.agentId && assignment.agentName ? { agentName: assignment.agentName } : {}) }))
    : assignments
  const iconIds = shown.map((assignment) => agentIconId(assignment.agentId))
  const sharedIconId = iconIds.every((id) => id === iconIds[0]) ? iconIds[0] : undefined
  const workerIds = intent.target?.workerIds ?? (intent.target?.threadId ? [intent.target.threadId] : [])
  const openWorker = (workerId: string, label?: string) => openWorkerSession(workerId, label)
  const changeRoute = (index: number, route: AgentDispatchAssignmentRoute) => {
    setRouteFailed(false)
    if (draft) { setDraft({ ...draft, routes: replaceAssignmentRoute(draft.routes, index, route) }); return }
    // A counting-down card holds the pick until the user stops for a moment.
    if (hold.changeRoute(index, route)) return
    if (sameAssignmentRoute(assignments[index], route)) return
    void act('update', { recommendation: { assignments: replaceAssignmentRoute(assignments, index, route) } })
      .then((next) => setRouteFailed(!next))
  }
  const startEdit = (paused: AgentDispatchIntentView) => {
    const held = hold.release()
    setDraft({ title: paused.recommendation.title, task: paused.recommendation.task,
      routes: held ?? dispatchAssignments(paused).map(assignmentRoute) })
  }
  const save = async () => {
    if (!draft?.title.trim() || !draft.task.trim()) return
    const routesChanged = draft.routes.some((route, index) => !sameAssignmentRoute(route, assignments[index]))
    const next = await act('update', { recommendation: { title: draft.title.trim(), task: draft.task.trim(),
      ...(routesChanged ? { assignments: draft.routes } : {}) } })
    if (next) { setDraft(undefined); setSaveError('') }
    else setSaveError(t('dispatchIntent.updateFailed'))
  }
  const workspaceName = recommendation.workspace?.split(/[\\/]/).filter(Boolean).pop()
  const autoStarted = intent.decision?.decision === 'allow' && intent.decision.reason.startsWith('Started automatically')
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-sm"
    data-agent-dispatch-card data-intent-id={id} data-state={intent.state}>
    <header className="flex min-w-0 items-start gap-3 px-4 py-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-tint/10 text-accent">
        {sharedIconId ? <AgentIcon harnessId={sharedIconId} size={16} /> : <Split size={16} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-medium text-ds-faint">{t(batch ? 'dispatchIntent.kickerBatch' : 'dispatchIntent.kicker')}</p>
        <h4 className="mt-0.5 line-clamp-2 break-words text-[14px] font-semibold leading-5 text-ds-ink" title={recommendation.title}>
          {batch ? t('dispatchIntent.batchTitle', { n: assignments.length }) : recommendation.title}
        </h4>
      </div>
      <AgentDispatchStatusBadge intent={intent} dispatches={overview?.dispatches} />
    </header>
    {draft ? <div className="space-y-2 border-t border-ds-border-muted px-4 py-3 text-[13px]">
      {!batch ? <input value={draft.title} maxLength={512} aria-label={t('dispatchIntent.title')}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={fieldClass} /> : null}
      <textarea value={draft.task} aria-label={t('dispatchIntent.task')} rows={batch ? 4 : 5}
        placeholder={batch ? t('dispatchIntent.batchTaskHint') : undefined}
        onChange={(event) => setDraft({ ...draft, task: event.target.value })} className={`${fieldClass} text-[12.5px] leading-5`} />
    </div> : null}
    {/* Held picks stay local, so the hold's own pause must not lock the pickers (a disabled chip eats the click). */}
    <AgentDispatchAssignmentList intent={intent} dispatches={overview?.dispatches} assignments={shown} editable={canEditRoutes} busy={busy && !hold.holding}
      onRouteChange={changeRoute} onInteract={hold.touch} onPendingChange={hold.setPending} onOpenWorker={openWorker} />
    <footer className="space-y-2.5 border-t border-ds-border-muted px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ds-faint">
        {workspaceName ? <span className="inline-flex min-w-0 items-center gap-1" title={recommendation.workspace}>
          <GitBranch size={12} className="shrink-0" aria-hidden /><span className="truncate">{workspaceName}</span>
        </span> : null}
        <span className="inline-flex items-center gap-1" title={t('dispatchIntent.permissionLabel')}>
          <ShieldCheck size={12} aria-hidden />
          {t(`dispatchIntent.permission.${recommendation.effectivePermissionMode ?? recommendation.permissionMode}`)}
        </span>
        {autoStarted ? <span className="inline-flex items-center gap-1"><Timer size={12} aria-hidden />{t('dispatchIntent.autoStarted')}</span> : null}
        {hold.holding ? <span className="min-w-0 text-ds-muted" data-dispatch-hold role="status">
          {t('dispatchIntent.holdHint', { seconds: hold.secondsLeft })}</span>
          : canEditRoutes && !draft ? <span className="min-w-0">{t('dispatchIntent.routeHint')}</span> : null}
      </div>
      <details className="text-[12px] text-ds-muted">
        <summary className="w-fit cursor-pointer select-none hover:text-ds-ink">{t('dispatchIntent.details')}</summary>
        <p className="mt-2 whitespace-pre-wrap break-words leading-5">{recommendation.task}</p>
        {recommendation.acceptanceCriteria?.length ? <ul className="mt-2 space-y-1">
          {recommendation.acceptanceCriteria.map((criterion, index) => <li key={index} className="flex gap-1.5">
            <Check size={12} className="mt-1 shrink-0 text-ds-faint" aria-hidden /><span className="break-words">{criterion}</span>
          </li>)}
        </ul> : null}
      </details>
      {draft ? <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <button type="button" disabled={busy || !draft.title.trim() || !draft.task.trim()} onClick={() => void save()}
          className="inline-flex h-8 items-center rounded-lg bg-accent px-3 font-medium text-white transition hover:brightness-110 disabled:opacity-50">
          {t('dispatchIntent.save')}
        </button>
        <button type="button" disabled={busy} onClick={() => { setDraft(undefined); void act('resume') }}
          className="inline-flex h-8 items-center rounded-lg px-2.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50">
          {t('dispatchIntent.keepRecommendation')}
        </button>
      </div> : <AgentDispatchIntentControls intentId={id} initial={intent} readOnly={locked} showStatus={false} pausable
        onEdit={locked ? undefined : startEdit} onTakeover={() => { if (workerIds[0]) openWorker(workerIds[0]) }} />}
      {saveError || (draft && error) ? <p role="alert" className="break-words text-xs text-red-600 dark:text-red-300">{saveError || error}</p> : null}
      {!draft && routeFailed && error ? <p role="alert" className="break-words text-xs text-red-600 dark:text-red-300">
        {t('dispatchIntent.routeUpdateFailed', { message: error })}</p> : null}
      {intent.replacementReason ? <p className="break-words text-xs text-ds-muted">{intent.replacementReason}</p> : null}
      {intent.resultSummary ? <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-ds-subtle px-3 py-2 text-[12px] leading-5 text-ds-ink">
        {intent.resultSummary}
      </div> : null}
    </footer>
  </section>
}
