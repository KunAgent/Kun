import { useCallback, useId, useMemo, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Info, Loader2, Search } from 'lucide-react'
import { AgentIcon } from '../agent-icon'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore } from '../../store/harness-store'
import { effectiveHarnessId } from '../../lib/ade-composer-harness'
import { harnessConnectionPresentation } from '../../lib/harness-connection-presentation'
import { resolvePlanBuildRoute, usePlanBuildAgentStore, type PlanBuildRoute } from '../../plan/plan-build-agent-store'
import { planBuildEffortLabelKey } from '../../plan/plan-build-effort'
import { useComposerPickerPopover } from '../chat/use-composer-picker-popover'
import { usePlanBuildAgentOptions } from './use-plan-build-agent-options'

export type PlanBuildRouteInfo = {
  route: PlanBuildRoute
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
  const composerReasoningEffort = useChatStore((state) => state.composerReasoningEffort)
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
    credentialMode: composerCredentialMode,
    reasoningEffort: composerReasoningEffort
  }), [picked, composerHarnessId, threadHarnessId, composerModel, composerProviderId, composerCredentialMode, composerReasoningEffort])
  const rowName = useHarnessStore((state) =>
    state.rows.find((row) => row.definition.id === route.agentId)?.definition.displayName)
  const external = route.agentId !== 'kun'
  return { route, external, agentName: rowName || (external ? route.agentId : 'Kun') }
}

const MENU_WIDTH = 600
const MENU_ESTIMATED_HEIGHT = 440
const SEARCH_THRESHOLD = 8

/**
 * Agent, model and reasoning chooser for a plan build: one chip (logo, Agent,
 * model, level) that opens a two-column menu. Agents that cannot run yet sit
 * in their own section and open a setup pane instead of changing the pick.
 * The pick is remembered per plan.
 */
export function PlanBuildAgentPicker({ planId, route, disabled, compact = false }: {
  planId: string
  route: PlanBuildRoute
  disabled: boolean
  compact?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const setRoute = usePlanBuildAgentStore((state) => state.setRoute)
  const options = usePlanBuildAgentOptions(route, disabled, (next) => setRoute(planId, next))
  const [open, setOpen] = useState(false)
  const [setupId, setSetupId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
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
  const needle = query.trim().toLowerCase()
  const visibleGroups = options.groups
    .map((group) => ({ ...group, modelIds: needle ? group.modelIds.filter((id) => id.toLowerCase().includes(needle)) : group.modelIds }))
    .filter((group) => group.modelIds.length > 0)
  const rows = options.rows.map((row) => ({ row, presentation: harnessConnectionPresentation(row) }))
  const readyRows = rows.filter(({ presentation }) => presentation.code == null || presentation.code === 'detecting')
  const setupRows = rows.filter(({ presentation }) => presentation.code != null && presentation.code !== 'detecting')
  const setupRow = setupId ? setupRows.find(({ row }) => row.definition.id === setupId) : undefined
  const effortLabel = options.effort !== 'auto' ? t(planBuildEffortLabelKey(options.effort)) : ''
  const menuHeight = Math.min(MENU_ESTIMATED_HEIGHT, typeof menuStyle.maxHeight === 'number' ? menuStyle.maxHeight : MENU_ESTIMATED_HEIGHT)

  const openSettings = (harnessId?: string): void => {
    closeMenu()
    if (harnessId) useHarnessStore.setState({ settingsHarnessId: harnessId })
    useChatStore.getState().openSettings('agentsHarnesses')
  }

  const rowClass = (active: boolean): string =>
    `flex h-[38px] w-full min-w-0 shrink-0 items-center gap-2.5 rounded-[9px] px-2 text-left transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-55 ${active ? 'bg-accent-soft/70' : ''}`
  const icon = (id: string): ReactElement => (
    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] border border-ds-border-muted bg-white">
      <AgentIcon harnessId={id} size={15} />
    </span>
  )

  const setupPane = setupRow ? (
    <div data-plan-build-agent-setup={setupRow.row.definition.id} className="flex min-h-0 flex-1 flex-col gap-3 p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-ds-border-muted bg-white">
          <AgentIcon harnessId={setupRow.row.definition.id} size={20} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-ds-ink">
            {t('planBuildAgentSetupTitle', { agent: setupRow.row.definition.displayName })}
          </div>
          <div className="truncate text-[12px] text-ds-muted">
            {[setupRow.presentation.labelKey ? t(setupRow.presentation.labelKey) : null,
              setupRow.presentation.nextStepKey ? t(setupRow.presentation.nextStepKey) : null].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
      <p className="m-0 text-[12.5px] leading-[1.6] text-ds-muted">
        {t('planBuildAgentSetupBody', { agent: setupRow.row.definition.displayName })}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-plan-build-agent-setup-open onClick={() => openSettings(setupRow.row.definition.id)}
          className="inline-flex h-9 items-center rounded-[9px] bg-accent px-3.5 text-[13px] font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          {t('planBuildAgentSetupAction', { agent: setupRow.row.definition.displayName })}
        </button>
        <button type="button" onClick={() => setSetupId(null)}
          className="inline-flex h-9 items-center rounded-[9px] border border-ds-border bg-ds-card px-3 text-[13px] text-ds-ink transition hover:bg-ds-hover">
          {t('planBuildAgentSetupBack', { agent: agentName })}
        </button>
      </div>
      <div className="mt-auto text-[11.5px] text-ds-muted">{t('planBuildAgentSetupKeep')}</div>
    </div>
  ) : null

  const modelPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 p-2">
      {modelCount > SEARCH_THRESHOLD ? (
        <label className="mx-0.5 mb-1 flex h-[34px] shrink-0 items-center gap-2 rounded-[9px] border border-ds-border bg-ds-card-muted/60 px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={2} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} data-plan-build-model-search
            placeholder={t('planBuildAgentSearch', { agent: agentName })}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ds-ink outline-none placeholder:text-ds-faint" />
        </label>
      ) : (
        <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-ds-muted">{t('planBuildAgentModels', { agent: agentName })}</div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {modelCount === 0 ? (
          <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-ds-muted" data-plan-build-agent-models-empty>
            {options.modelsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> : null}
            {t(options.modelsLoading ? 'planBuildAgentModelsLoading' : 'planBuildAgentModelsEmpty')}
          </div>
        ) : visibleGroups.map((group) => (
          <div key={group.providerId} className="flex flex-col gap-0.5">
            {options.groups.length > 1 ? (
              <div className="truncate px-2.5 pb-0.5 pt-2 text-[11px] text-ds-muted">{group.label}</div>
            ) : null}
            {group.modelIds.map((model) => {
              const selected = group.providerId === options.selectedGroupId && model === options.displayModel
              return (
                <button key={`${group.providerId}:${model}`} type="button" role="menuitemradio" aria-checked={selected}
                  data-plan-build-model-option={model}
                  onClick={() => options.selectModel(model, group.providerId)}
                  className={`flex h-[34px] w-full shrink-0 items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px] text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${selected ? 'bg-accent-soft/70' : ''}`}>
                  <span className="min-w-0 flex-1 truncate">{model}</span>
                  {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.2} /> : null}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      {options.effortChoices.length > 1 ? (
        <div data-plan-build-effort className="flex shrink-0 flex-wrap items-center gap-2.5 border-t border-ds-border-muted px-2.5 pb-0.5 pt-2">
          <span className="text-[11.5px] text-ds-muted">{t('planBuildEffort')}</span>
          <div role="radiogroup" aria-label={t('planBuildEffort')} className="flex flex-wrap gap-0.5 rounded-[8px] bg-ds-card-muted p-0.5">
            {options.effortChoices.map((effort) => {
              const active = effort === options.effort
              return (
                <button key={effort} type="button" role="radio" aria-checked={active} data-plan-build-effort-option={effort}
                  onClick={() => options.selectEffort(effort)}
                  className={`h-6 rounded-[6px] px-2.5 text-[12px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${active ? 'bg-ds-card font-semibold text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'}`}>
                  {t(planBuildEffortLabelKey(effort))}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )

  const menu = open && typeof document !== 'undefined' ? createPortal(
    <div ref={menuRef} id={menuId} role="menu" aria-label={t('planBuildAgentMenuTitle')}
      style={{ ...menuStyle, height: menuHeight }} data-plan-build-agent-menu
      className="ds-no-drag fixed z-50 flex flex-col overflow-hidden rounded-[14px] border border-ds-border bg-ds-main shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:shadow-[0_22px_60px_rgba(0,0,0,0.45)]">
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[210px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-ds-border-muted p-2">
          <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold text-ds-muted">{t('planBuildAgentMenuTitle')}</div>
          {readyRows.map(({ row, presentation }) => {
            const id = row.definition.id
            const detecting = presentation.code === 'detecting'
            const selected = !setupRow && id === (options.pendingAgent ?? route.agentId)
            return (
              <button key={id} type="button" role="menuitemradio" aria-checked={selected} disabled={detecting}
                data-plan-build-agent-option={id}
                onClick={() => { setSetupId(null); setQuery(''); options.selectAgent(id) }}
                className={rowClass(selected)}>
                {icon(id)}
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ds-ink">{row.definition.displayName}</span>
                {id === 'kun' ? <span className="shrink-0 rounded-[5px] bg-ds-card-muted px-1.5 text-[10.5px] text-ds-muted">{t('planBuildAgentTagKun')}</span> : null}
                {detecting || id === options.pendingAgent ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ds-muted" strokeWidth={1.75} /> : null}
              </button>
            )
          })}
          {setupRows.length > 0 ? (
            <div className="px-2 pb-1 pt-3 text-[11px] font-semibold text-ds-muted">{t('planBuildAgentSectionSetup')}</div>
          ) : null}
          {setupRows.map(({ row }) => {
            const id = row.definition.id
            return (
              <button key={id} type="button" role="menuitem" data-plan-build-agent-setup-option={id}
                onClick={() => setSetupId(id)} className={rowClass(setupId === id)}>
                <span className="opacity-60">{icon(id)}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ds-muted">{row.definition.displayName}</span>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
              </button>
            )
          })}
        </div>
        {setupPane ?? modelPane}
      </div>
      <div data-plan-build-agent-note className="flex shrink-0 items-start gap-1.5 border-t border-ds-border-muted bg-ds-card-muted/50 px-3.5 py-2 text-[11.5px] leading-[1.55] text-ds-muted">
        <Info className="mt-[2px] h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.8} />
        <span>{options.external ? t('planBuildAgentNoteExternal', { agent: agentName }) : t('planBuildAgentNoteKun')}</span>
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
          setSetupId(null)
          setQuery('')
          if (next) options.refresh()
        }}
        className={`inline-flex min-w-0 max-w-full items-center gap-2 rounded-[10px] border bg-ds-card pl-1.5 pr-2.5 text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60 ${compact ? 'h-[34px] text-[12.5px]' : 'h-9 text-[13px]'} ${open ? 'border-accent shadow-[0_0_0_3px_rgba(79,95,224,0.15)]' : 'border-ds-border'}`}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border border-ds-border-muted bg-white">
          <AgentIcon harnessId={route.agentId} size={16} />
        </span>
        <span className="shrink-0 font-semibold">{agentName}</span>
        {options.displayModel ? (
          <span className="min-w-0 truncate text-ds-muted" title={options.displayModel}>
            {options.displayModel}{effortLabel ? ` · ${effortLabel}` : ''}
          </span>
        ) : null}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ds-muted transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2} />
      </button>
      {menu}
    </div>
  )
}
