import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore } from '../../store/harness-store'
import type { PlanBuildHandoff } from '../../plan/plan-build-agent-store'
import { AgentIcon } from '../agent-icon'

/** Card state once the plan was handed to an external Agent conversation. */
export function PlanBuildHandoffRow({ handoff, onRebuild }: {
  handoff: PlanBuildHandoff
  onRebuild: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const agentId = handoff.route.agentId
  const agentName = useHarnessStore((state) =>
    state.rows.find((row) => row.definition.id === agentId)?.definition.displayName) ?? agentId
  const model = handoff.route.model ? `${handoff.route.model} · ` : ''
  return (
    <div data-plan-build-handoff={agentId}
      className="flex w-full min-w-0 flex-wrap items-center gap-3 rounded-[16px] bg-ds-card-muted/70 p-3 dark:bg-white/[0.04]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-ds-border-muted bg-white">
        <AgentIcon harnessId={agentId} size={20} />
      </span>
      <div className="min-w-[180px] flex-1">
        <div className="text-[13.5px] font-semibold text-ds-ink">{t('planBuildHandedOff', { agent: agentName })}</div>
        <div className="mt-0.5 truncate text-[12px] text-ds-muted">{t('planBuildHandedOffDetail', { model })}</div>
      </div>
      <button type="button" onClick={onRebuild}
        className="inline-flex h-8 shrink-0 items-center rounded-[10px] px-2.5 text-[12.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30">
        {t('planBuildRebuild')}
      </button>
      <button type="button" data-plan-build-open-session
        onClick={() => { void useChatStore.getState().selectThread(handoff.threadId) }}
        className="inline-flex h-9 shrink-0 items-center rounded-[10px] border border-ds-border bg-ds-card px-3.5 text-[13px] font-medium text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30">
        {t('planBuildOpenSession')}
      </button>
    </div>
  )
}
