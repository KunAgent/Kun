import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore } from '../../store/harness-store'
import { useTaskWorkspaceStore } from '../../store/task-workspace-store'
import type { PlanBuildHandoff } from '../../plan/plan-build-agent-store'
import { planBuildEffortLabelKey } from '../../plan/plan-build-effort'
import { AgentIcon } from '../agent-icon'

export type PlanBuildHandoffStage = 'preparing' | 'running' | 'review' | 'stopped' | 'waiting'

/** Where a handed-off build is, from its conversation and task worktree. */
export function planBuildHandoffStage(input: {
  turnStatus?: string
  prepState?: string
  busy?: boolean
}): PlanBuildHandoffStage {
  const { turnStatus, prepState, busy } = input
  if (prepState === 'failed') return 'stopped'
  if (busy || turnStatus === 'running' || turnStatus === 'queued' || turnStatus === 'pending') return 'running'
  if (turnStatus === 'completed') return 'review'
  if (turnStatus === 'failed' || turnStatus === 'interrupted' || turnStatus === 'cancelled') return 'stopped'
  if (prepState && prepState !== 'ready') return 'preparing'
  return 'waiting'
}

export function usePlanBuildHandoffStage(threadId: string): PlanBuildHandoffStage {
  const turnStatus = useChatStore((state) =>
    ((state.adeThreads ?? []).find((thread) => thread.id === threadId) ??
      state.threads.find((thread) => thread.id === threadId))?.latestTurnStatus)
  const busy = useChatStore((state) => state.activeThreadId === threadId && state.busy)
  const prepState = useTaskWorkspaceStore((state) => state.prepByThread[threadId]?.state)
  return planBuildHandoffStage({ turnStatus, prepState, busy })
}

/** Card state once the plan was handed to an external Agent conversation. */
export function PlanBuildHandoffRow({ handoff, onRebuild }: {
  handoff: PlanBuildHandoff
  onRebuild: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const agentId = handoff.route.agentId
  const agentName = useHarnessStore((state) =>
    state.rows.find((row) => row.definition.id === agentId)?.definition.displayName) ?? agentId
  const stage = usePlanBuildHandoffStage(handoff.threadId)
  const effort = handoff.route.reasoningEffort && handoff.route.reasoningEffort !== 'auto'
    ? t(planBuildEffortLabelKey(handoff.route.reasoningEffort)) : ''
  const route = [handoff.route.model, effort].filter(Boolean).join(' · ')
  return (
    <div data-plan-build-handoff={agentId} data-plan-build-handoff-stage={stage}
      className="flex w-full min-w-0 flex-wrap items-center gap-3 rounded-[16px] bg-ds-card-muted/70 p-3 dark:bg-white/[0.04]">
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-ds-border-muted bg-ds-card text-ds-ink">
        <AgentIcon harnessId={agentId} size={20} />
        {stage === 'running' || stage === 'preparing' ? (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-ds-card bg-accent" aria-hidden="true" />
        ) : null}
      </span>
      <div className="min-w-[180px] flex-1">
        <div className="text-[13.5px] font-semibold text-ds-ink">
          {t('planBuildHandedOff', { agent: agentName })}{route ? <span className="font-normal text-ds-muted"> · {route}</span> : null}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-ds-muted">{t(`planBuildHandoffStage${stage[0].toUpperCase()}${stage.slice(1)}`)}</div>
      </div>
      <button type="button" onClick={onRebuild}
        className="inline-flex h-8 shrink-0 items-center rounded-[10px] px-2.5 text-[12.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30">
        {t('planBuildRebuild')}
      </button>
      <button type="button" data-plan-build-open-session
        onClick={() => { void useChatStore.getState().selectThread(handoff.threadId) }}
        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-[10px] bg-accent px-3.5 text-[13px] font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        {t('planBuildOpenSession')}
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  )
}
