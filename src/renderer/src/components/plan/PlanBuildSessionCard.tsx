import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Circle, FileText, GitBranch, Loader2, X } from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore } from '../../store/harness-store'
import { useTaskWorkspaceStore } from '../../store/task-workspace-store'
import { planBuildHandoffForThread, usePlanBuildAgentStore } from '../../plan/plan-build-agent-store'
import { planBuildEffortLabelKey } from '../../plan/plan-build-effort'
import { AgentIcon } from '../agent-icon'
import { usePlanBuildHandoffStage, type PlanBuildHandoffStage } from './PlanBuildHandoffRow'

type StepState = 'done' | 'active' | 'todo' | 'failed'

/** Ordered build steps for a stage: worktree, Agent takes over, build, review. */
export function planBuildSessionSteps(stage: PlanBuildHandoffStage, worktreeReady: boolean): StepState[] {
  if (stage === 'stopped') return worktreeReady ? ['done', 'done', 'failed', 'todo'] : ['failed', 'todo', 'todo', 'todo']
  if (stage === 'review') return ['done', 'done', 'done', 'active']
  if (stage === 'running') return ['done', 'done', 'active', 'todo']
  return worktreeReady ? ['done', 'active', 'todo', 'todo'] : ['active', 'todo', 'todo', 'todo']
}

/** Whether the active conversation is a plan build handed to an Agent. */
export function useIsPlanBuildSession(): boolean {
  const threadId = useChatStore((state) => state.activeThreadId)
  return usePlanBuildAgentStore((state) => Boolean(planBuildHandoffForThread(state.handoffs, threadId)))
}

/**
 * Header of a handed-off plan build conversation: which plan, which Agent
 * and model, the isolation it runs under, and how far it got. Replaces the
 * empty new-task page while the worktree is still being prepared.
 */
export function PlanBuildSessionCard(): ReactElement | null {
  const { t } = useTranslation('common')
  const threadId = useChatStore((state) => state.activeThreadId)
  const match = usePlanBuildAgentStore((state) => planBuildHandoffForThread(state.handoffs, threadId))
  const prep = useTaskWorkspaceStore((state) => (threadId ? state.prepByThread[threadId] : undefined))
  const stage = usePlanBuildHandoffStage(threadId ?? '')
  const agentId = match?.handoff.route.agentId ?? ''
  const agentName = useHarnessStore((state) =>
    state.rows.find((row) => row.definition.id === agentId)?.definition.displayName) ?? agentId
  if (!match || !threadId) return null
  const { handoff } = match
  const worktreeReady = prep?.state === 'ready' || Boolean(prep?.path) || stage === 'running' || stage === 'review'
  const steps = planBuildSessionSteps(prep?.state === 'failed' ? 'stopped' : stage, worktreeReady)
  const effort = handoff.route.reasoningEffort && handoff.route.reasoningEffort !== 'auto'
    ? t(planBuildEffortLabelKey(handoff.route.reasoningEffort)) : ''
  const route = [agentName, handoff.route.model, effort].filter(Boolean).join(' · ')
  const labels = [
    t('planBuildSessionStepWorktree'),
    t('planBuildSessionStepAgent', { agent: agentName }),
    t('planBuildSessionStepBuild'),
    t('planBuildSessionStepReview')
  ]
  const details = [
    prep?.state === 'failed' ? prep.error || t('planBuildSessionWorktreeFailed') : t('planBuildSessionWorktreeDetail'),
    t('planBuildSessionAgentDetail'),
    '',
    t('planBuildSessionReviewDetail')
  ]
  const icon = (state: StepState): ReactElement => state === 'done'
    ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={2.4} />
    : state === 'active' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" strokeWidth={2.2} />
      : state === 'failed' ? <X className="h-3.5 w-3.5 text-red-600 dark:text-red-400" strokeWidth={2.4} />
        : <Circle className="h-3 w-3 text-ds-faint" strokeWidth={2} />
  return (
    <section data-plan-build-session={agentId} data-plan-build-session-stage={stage}
      className="ds-no-drag mx-auto mt-3 w-full max-w-[760px] min-w-0 px-4">
      <div className="rounded-[14px] border border-ds-border bg-ds-card px-4 py-3 shadow-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.8} />
          <span className="shrink-0 text-[13.5px] font-semibold text-ds-ink">{t('planBuildSessionTitle')}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ds-muted" title={handoff.planPath}>
            {handoff.planTitle || handoff.planPath}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] bg-ds-card-muted px-2 py-0.5 text-[12px] text-ds-muted">
            <AgentIcon harnessId={agentId} size={13} />
            <span className="truncate">{route}</span>
          </span>
          {handoff.sourceThreadId ? (
            <button type="button" data-plan-build-session-back
              onClick={() => { void useChatStore.getState().selectThread(handoff.sourceThreadId!) }}
              className="shrink-0 rounded-[7px] px-2 py-0.5 text-[12px] text-accent transition hover:bg-accent-soft">
              {t('planBuildSessionBack')}
            </button>
          ) : null}
        </div>
        <ol className="m-0 mt-2.5 grid list-none grid-cols-1 gap-x-4 gap-y-1.5 p-0 sm:grid-cols-2">
          {labels.map((label, index) => (
            <li key={label} data-plan-build-session-step={steps[index]} className="flex min-w-0 items-start gap-2">
              <span className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center">{icon(steps[index])}</span>
              <span className="min-w-0">
                <span className={`block text-[12.5px] ${steps[index] === 'todo' ? 'text-ds-muted' : 'font-medium text-ds-ink'}`}>{label}</span>
                {details[index] ? <span className="block truncate text-[11.5px] text-ds-muted">{details[index]}</span> : null}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-2 flex min-w-0 items-center gap-1.5 border-t border-ds-border-muted pt-2 text-[11.5px] text-ds-muted">
          <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <span className="truncate">{t('planBuildSessionIsolation', { agent: agentName })}</span>
        </div>
      </div>
    </section>
  )
}
