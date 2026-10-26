import { useCallback, useId, useMemo, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Loader2, Settings2 } from 'lucide-react'
import type { AgentDispatchAssignmentRoute } from '@shared/agent-dispatch'
import { AgentIcon } from '../agent-icon'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore } from '../../store/harness-store'
import { effectiveHarnessId } from '../../lib/ade-composer-harness'
import { harnessConnectionPresentation } from '../../lib/harness-connection-presentation'
import { resolvePlanBuildRoute, usePlanBuildAgentStore } from '../../plan/plan-build-agent-store'
import { useComposerPickerPopover } from '../chat/use-composer-picker-popover'
import { usePlanBuildAgentOptions } from './use-plan-build-agent-options'

export type PlanBuildRouteInfo = {
  route: AgentDispatchAssignmentRoute
  external: boolean
  agentName: string
}

/** The Agent a build of this plan runs on: the card's pick, else the composer's Agent. */
export function usePlanBuildRoute(planId: string): PlanBuildRouteInfo {
  const picked = usePlanBuildAgentStore((state) => (planId ? state.plans[planId] : undefined))
  const composerHarnessId = useChatStore((state) => state.composerHarnessId)
  const composerModel = useChatStore((state) => state.composerModel)
  const composerProviderId = useChatStore((state) => state.composerProviderId)
  const composerCredentialMode = useChatStore((state) => state.composerCredentialMode)
  const threadHarnessId = useChatStore((state) => {
    const id = state.activeThreadId
    if (!id) return undefined
    return (state.threads.find((thread) => thread.id === id) ??
      (state.adeThreads ?? []).find((thread) => thread.id === id))?.harnessId
  })
  const route = useMemo(() => resolvePlanBuildRoute(picked, {
    harnessId: effectiveHarnessId(composerHarnessId, threadHarnessId),
    model: composerModel,
    providerId: composerProviderId,
    credentialMode: composerCredentialMode
  }), [picked, composerHarnessId, threadHarnessId, composerModel, composerProviderId, composerCredentialMode])
  const rowName = useHarnessStore((state) =>
    state.rows.find((row) => row.definition.id === route.agentId)?.definition.displayName)
  const external = route.agentId !== 'kun'
  return { route, external, agentName: rowName || (external ? route.agentId : 'Kun') }
}

const MENU_WIDTH = 560
const MENU_ESTIMATED_HEIGHT = 340

/**
 * Agent + model chooser for a plan build: one chip (logo, Agent, model) that
 * opens a two-column menu. The pick is remembered per plan.
 */
export function PlanBuildAgentPicker({ planId, route, disabled, compact = false }: {
  planId: string
  route: AgentDispatchAssignmentRoute
  disabled: boolean
  compact?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const setRoute = usePlanBuildAgentStore((state) => state.setRoute)
  const options = usePlanBuildAgentOptions(route, disabled, (next) => setRoute(planId, next))
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const closeMenu = useCallback((): void => setOpen(false), [])
  const { triggerRef, menuRef, menuStyle } = useComposerPickerPopover({
    open,
    onClose: closeMenu,
    preferredWidth: MENU_WIDTH,
    estimatedHeight: MENU_ESTIMATED_HEIGHT
  })
  const agentName = options.row?.definition.displayName ?? (options.external ? route.agentId : 'Kun')
  const modelCount = options.groups.reduce((sum, group) => sum + group.modelIds.length, 0)

  const openSettings = (harnessId?: string): void => {
    closeMenu()
    if (harnessId) useHarnessStore.setState({ settingsHarnessId: harnessId })
    useChatStore.getState().openSettings('agentsHarnesses')
  }

  const menu = open && typeof document !== 'undefined' ? createPortal(
    <div ref={menuRef} id={menuId} role="menu" aria-label={t('planBuildAgentMenuTitle')}
      style={{ ...menuStyle, overflowY: 'auto' }} data-plan-build-agent-menu
      className="ds-no-drag fixed z-50 flex overflow-hidden rounded-[16px] border border-ds-border bg-ds-main shadow-[0_22px_60px_rgba(15,23,42,0.18)] dark:shadow-[0_22px_60px_rgba(0,0,0,0.45)]">
      <div className="flex w-[260px] shrink-0 flex-col gap-0.5 border-r border-ds-border-muted p-2">
        <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-ds-muted">{t('planBuildAgentMenuTitle')}</div>
        {options.rows.map((row) => {
          const id = row.definition.id
          const { code, labelKey, nextStepKey } = harnessConnectionPresentation(row)
          const detecting = code === 'detecting'
          const blocked = code != null
          const status = blocked
            ? [labelKey ? t(labelKey) : null, nextStepKey && !detecting ? t(nextStepKey) : null].filter(Boolean).join(' · ')
            : id === 'kun' ? t('planBuildAgentStatusKun') : t('planBuildAgentStatusReady')
          const selected = id === (options.pendingAgent ?? route.agentId)
          return (
            <div key={id} className="flex items-center gap-1">
              <button type="button" role="menuitem" disabled={blocked && !selected}
                data-plan-build-agent-option={id}
                onClick={() => options.selectAgent(id)}
                className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent ${selected ? 'bg-accent-soft/70' : ''}`}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-ds-border-muted bg-white">
                  <AgentIcon harnessId={id} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ds-ink">{row.definition.displayName}</span>
                  <span className={`block truncate text-[11.5px] ${blocked ? 'text-amber-700 dark:text-amber-300' : 'text-ds-muted'}`}>{status}</span>
                </span>
                {detecting || id === options.pendingAgent ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ds-muted" strokeWidth={1.75} />
                  : selected ? <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2.2} /> : null}
              </button>
              {blocked && !detecting ? (
                <button type="button" role="menuitem" onClick={() => openSettings(id)}
                  aria-label={`${row.definition.displayName} ${t('adeHarnessOpenSettings')}`}
                  className="shrink-0 rounded-md p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink">
                  <Settings2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-2">
        <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-ds-muted">
          {t('planBuildAgentModels', { agent: agentName })}
        </div>
        {modelCount === 0 ? (
          <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-ds-muted" data-plan-build-agent-models-empty>
            {options.modelsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> : null}
            {t(options.modelsLoading ? 'planBuildAgentModelsLoading' : 'planBuildAgentModelsEmpty')}
          </div>
        ) : options.groups.map((group) => (
          <div key={group.providerId} className="flex flex-col gap-0.5">
            {options.groups.length > 1 ? (
              <div className="truncate px-2.5 pt-1 text-[10.5px] uppercase tracking-wider text-ds-faint">{group.label}</div>
            ) : null}
            {group.modelIds.map((model) => {
              const selected = group.providerId === options.selectedGroupId && model === options.displayModel
              return (
                <button key={`${group.providerId}:${model}`} type="button" role="menuitem"
                  data-plan-build-model-option={model}
                  onClick={() => { options.selectModel(model, group.providerId); closeMenu() }}
                  className={`flex h-[34px] w-full items-center gap-2 rounded-[9px] px-2.5 text-left text-[13px] text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${selected ? 'bg-ds-hover' : ''}`}>
                  <span className="min-w-0 flex-1 truncate">{model}</span>
                  {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.2} /> : null}
                </button>
              )
            })}
          </div>
        ))}
        <div className="min-h-2 flex-1" />
        <div data-plan-build-agent-note
          className={`mx-1 mb-1 mt-2 rounded-[10px] px-2.5 py-2 text-[11.5px] leading-[1.55] text-ds-muted ${options.external ? 'bg-amber-500/10' : 'bg-ds-card-muted/70'}`}>
          {t(options.external ? 'planBuildAgentNoteExternal' : 'planBuildAgentNoteKun')}
        </div>
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div data-plan-build-agent={route.agentId} className="ds-no-drag relative min-w-0">
      <button ref={triggerRef} type="button" disabled={disabled}
        aria-haspopup="menu" aria-controls={menuId} aria-expanded={open}
        aria-label={t('planBuildAgentMenuTitle')}
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) options.refresh()
        }}
        className={`inline-flex min-w-0 max-w-full items-center gap-2 rounded-[10px] border bg-ds-card pl-1.5 pr-2.5 text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60 ${compact ? 'h-[34px] text-[12.5px]' : 'h-9 text-[13px]'} ${open ? 'border-accent shadow-[0_0_0_3px_rgba(79,95,224,0.15)]' : 'border-ds-border'}`}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border border-ds-border-muted bg-white">
          <AgentIcon harnessId={route.agentId} size={16} />
        </span>
        <span className="shrink-0 font-semibold">{agentName}</span>
        {options.displayModel ? (
          <>
            <span className="shrink-0 text-ds-faint">·</span>
            <span className="min-w-0 truncate text-ds-muted" title={options.displayModel}>{options.displayModel}</span>
          </>
        ) : null}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ds-muted transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2} />
      </button>
      {menu}
    </div>
  )
}
