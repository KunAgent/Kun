import type { ReactElement, ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { ChevronDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import type { ModelReasoningEffort } from '@shared/app-settings'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { Toggle } from '../settings-controls'
import { ModelSelect, ReasoningEffortPicker } from './SubagentProfileControls'
import {
  AGENT_CATEGORY_ORDER,
  REASONING_OPTIONS,
  SURFACE_TABS,
  normalizeStoredReasoning,
  resolveReasoningOptions,
  type AgentCatalogFilter,
  type AgentCategory,
  type AgentCategoryFilter,
  type CatalogAgent,
  type SurfaceTab
} from './subagent-settings-support'

export function EditorSettingsCard({
  title,
  description,
  action,
  children
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <details className="group overflow-visible rounded-2xl border border-ds-border bg-ds-card/95 shadow-sm shadow-black/5 dark:shadow-black/25">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 transition hover:bg-ds-hover/55 group-open:border-b group-open:border-ds-border-muted [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold text-ds-ink">{title}</h2>
          {description ? <p className="mt-1 text-[13px] leading-5 text-ds-muted">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <ChevronDown className="h-4 w-4 text-ds-faint transition group-open:rotate-180" />
        </div>
      </summary>
      <div className="divide-y divide-ds-border-muted px-2 py-1">{children}</div>
    </details>
  )
}

export function CompactPolicySetting({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: ReactNode
}): ReactElement {
  return (
    <div className="flex items-center gap-4 bg-ds-card px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-ds-ink">{title}</div>
        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-4 text-ds-muted">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const CATEGORY_FALLBACKS: Record<AgentCategory, string> = {
  development: 'Development',
  review: 'Review',
  quality: 'Quality',
  planning: 'Planning',
  operations: 'Operations',
  research: 'Research',
  custom: 'Custom'
}

export function agentCategoryLabel(t: TFunction<'common'>, category: AgentCategory): string {
  return t(`subagentsPanel.category.${category}`, CATEGORY_FALLBACKS[category])
}

function sharedCategoryModel(agents: CatalogAgent[]): {
  model: string
  providerId: string
  mixed: boolean
} {
  if (agents.length === 0) return { model: '', providerId: '', mixed: false }
  const model = agents[0]?.profile.model ?? ''
  const providerId = agents[0]?.profile.providerId ?? ''
  const mixed = agents.some((agent) =>
    (agent.profile.model ?? '') !== model || (agent.profile.providerId ?? '') !== providerId)
  return mixed ? { model: '', providerId: '', mixed: true } : { model, providerId, mixed: false }
}

function sharedCategoryReasoning(agents: CatalogAgent[]): {
  effort: ModelReasoningEffort
  mixed: boolean
} {
  if (agents.length === 0) return { effort: 'off', mixed: false }
  const effort = normalizeStoredReasoning(agents[0]?.profile.reasoningEffort)
  const mixed = agents.some((agent) =>
    normalizeStoredReasoning(agent.profile.reasoningEffort) !== effort)
  return mixed ? { effort: 'off', mixed: true } : { effort, mixed: false }
}

export function categoryConfigurationSummary(
  agents: CatalogAgent[],
  t: TFunction<'common'>
): string {
  const sharedModel = sharedCategoryModel(agents)
  const sharedReasoning = sharedCategoryReasoning(agents)
  if (sharedModel.mixed || sharedReasoning.mixed) {
    return t('subagentsPanel.mixedConfiguration', 'Multiple configurations')
  }
  const model = sharedModel.model || t('agentsView.followDefault', 'Follow default')
  const reasoning = REASONING_OPTIONS.find((option) => option.id === sharedReasoning.effort)
  const reasoningLabel = reasoning ? t(reasoning.labelKey, reasoning.id) : sharedReasoning.effort
  return `${model} · ${reasoningLabel}`
}

export function CategoryBatchControls({
  agents,
  groups,
  categoryLabel,
  onModelsChange,
  onReasoningChange,
  onReset,
  t
}: {
  agents: CatalogAgent[]
  groups: ModelProviderModelGroup[]
  categoryLabel: string
  onModelsChange: (ids: string[], model: string, providerId: string) => void
  onReasoningChange: (ids: string[], effort: ModelReasoningEffort) => void
  onReset: (ids: string[]) => void
  t: TFunction<'common'>
}): ReactElement {
  const shared = sharedCategoryModel(agents)
  const sharedReasoning = sharedCategoryReasoning(agents)
  const ids = agents.map((agent) => agent.profile.id)
  const hasOverrides = agents.some((agent) =>
    Boolean(agent.profile.model || agent.profile.providerId || agent.profile.reasoningEffort))
  const reasoningOptions = shared.mixed
    ? REASONING_OPTIONS
    : resolveReasoningOptions(groups, shared.model, shared.providerId)
  return (
    <div
      data-testid="subagent-category-configuration"
      className="mb-2.5 rounded-xl border border-ds-border-muted bg-ds-main/45 p-3"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11.5px] font-semibold text-ds-heading">
            {t('subagentsPanel.categoryConfiguration', 'Category default configuration')}
          </div>
          <div className="mt-0.5 text-[10px] text-ds-faint">
            {t('subagentsPanel.categoryConfigurationDesc', 'Apply the same defaults to every agent in this category')}
          </div>
        </div>
        <button
          type="button"
          disabled={!hasOverrides}
          onClick={() => onReset(ids)}
          className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold text-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:text-ds-faint disabled:hover:bg-transparent"
        >
          {t('subagentsPanel.resetCategoryConfiguration', 'Reset defaults')}
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(160px,0.8fr)_minmax(280px,1.2fr)] md:items-end">
        <div className="min-w-0">
          <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-ds-faint">
            {t('agentsView.fModel', 'Model')}
          </div>
          <ModelSelect
            value={shared.model}
            providerId={shared.providerId}
            groups={groups}
            stretch
            emptyLabel={shared.mixed
              ? t('subagentsPanel.mixedModels', 'Mixed models')
              : undefined}
            ariaLabel={t(
              'subagentsPanel.batchModelAria',
              'Set the same model for all {{count}} agents in {{category}}',
              { count: agents.length, category: categoryLabel }
            )}
            onChange={(model, providerId) => onModelsChange(ids, model, providerId)}
          />
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-ds-faint">
            {t('subagentsPanel.reasoning', 'Reasoning')}
          </div>
          <ReasoningEffortPicker
            value={sharedReasoning.mixed ? null : sharedReasoning.effort}
            options={reasoningOptions}
            mixedLabel={sharedReasoning.mixed
              ? t('subagentsPanel.mixedReasoning', 'Mixed reasoning')
              : undefined}
            ariaLabel={t(
              'subagentsPanel.batchReasoningAria',
              'Set the same reasoning effort for all {{count}} agents in {{category}}',
              { count: agents.length, category: categoryLabel }
            )}
            onChange={(effort) => onReasoningChange(ids, effort)}
          />
        </div>
      </div>
    </div>
  )
}

export function surfaceLabel(t: TFunction<'common'>, surface: SurfaceTab): string {
  const fallbacks: Record<SurfaceTab, string> = {
    shared: 'Base',
    code: 'Code',
    write: 'Work',
    design: 'Design'
  }
  return t(`subagentsPanel.surface.${surface}`, fallbacks[surface])
}

export function SurfaceTabs({
  value,
  onChange,
  t
}: {
  value: SurfaceTab
  onChange: (surface: SurfaceTab) => void
  t: TFunction<'common'>
}): ReactElement {
  return (
    <div className="mb-3 grid grid-cols-4 gap-1 rounded-xl bg-ds-card-muted p-1" role="tablist">
      {SURFACE_TABS.map((surface) => (
        <button
          key={surface}
          type="button"
          role="tab"
          aria-selected={value === surface}
          onClick={() => onChange(surface)}
          className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
            value === surface
              ? 'bg-ds-card text-accent shadow-sm'
              : 'text-ds-muted hover:text-ds-heading'
          }`}
        >
          {surfaceLabel(t, surface)}
        </button>
      ))}
    </div>
  )
}

export function CatalogPagination({
  page,
  pageCount,
  total,
  onPageChange,
  t
}: {
  page: number
  pageCount: number
  total: number
  onPageChange: (page: number) => void
  t: TFunction<'common'>
}): ReactElement {
  return (
    <nav className="mt-3 flex items-center justify-between gap-3 border-t border-ds-border-muted pt-3" aria-label={t('subagentsPanel.pagination', 'Agent pages')}>
      <span className="text-[10.5px] text-ds-muted">
        {t('subagentsPanel.pageSummary', 'Page {{page}} of {{pages}} · {{count}} agents', {
          page,
          pages: pageCount,
          count: total
        })}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          aria-label={t('subagentsPanel.previousPage', 'Previous page')}
          className="rounded-lg border border-ds-border p-1.5 text-ds-muted transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-12 text-center text-[11px] font-semibold text-ds-heading">{page}/{pageCount}</span>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
          aria-label={t('subagentsPanel.nextPage', 'Next page')}
          className="rounded-lg border border-ds-border p-1.5 text-ds-muted transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </nav>
  )
}

export function ExtensionAgentsControl({
  status,
  enabledCount,
  count,
  onToggle,
  t
}: {
  status: 'disabled' | 'partial' | 'enabled'
  enabledCount: number
  count: number
  onToggle: (enabled: boolean) => void
  t: TFunction<'common'>
}): ReactElement {
  const enabled = status === 'enabled'
  const partial = status === 'partial'
  const statusLabel = enabled
    ? t('subagentsPanel.extensionAgents.enabled', 'All enabled')
    : partial
      ? t('subagentsPanel.extensionAgents.partial', '{{enabled}}/{{count}} enabled', {
        enabled: enabledCount,
        count
      })
      : t('subagentsPanel.extensionAgents.disabled', 'Disabled')
  const toggleTarget = !enabled

  return (
    <section className="mb-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2.5 shadow-sm shadow-black/5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-ds-heading">
            {t('subagentsPanel.extensionAgents.title', 'Extension agents')}
          </div>
          <div className="mt-0.5 text-[10.5px] text-ds-muted">
            {t('subagentsPanel.extensionAgents.description', 'Work and Design specialists · {{count}}', { count })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`text-[10.5px] font-semibold ${status !== 'disabled' ? 'text-accent' : 'text-ds-faint'}`}>
            {statusLabel}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            data-state={status}
            aria-label={t('subagentsPanel.extensionAgents.toggle', 'Toggle extension agents')}
            onClick={() => onToggle(toggleTarget)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              status !== 'disabled' ? 'bg-accent' : 'bg-ds-border'
            }`}
          >
            <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
              enabled ? 'translate-x-4' : partial ? 'translate-x-2' : 'translate-x-0'
            }`} />
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-ds-border-muted pt-2">
        <span className="text-[10px] text-ds-faint">
          {t('subagentsPanel.extensionAgents.baseAlwaysAvailable', 'Base agents are always available')}
        </span>
        <button
          type="button"
          onClick={() => onToggle(toggleTarget)}
          className="shrink-0 rounded-md px-1.5 py-1 text-[10px] font-semibold text-accent transition hover:bg-accent-soft"
        >
          <span>{enabled
            ? t('subagentsPanel.extensionAgents.keepBaseOnly', 'Keep base agents only')
            : partial
              ? t('subagentsPanel.extensionAgents.enableAllExtensions', 'Enable all extension agents')
              : t('subagentsPanel.extensionAgents.enableExtensions', 'Enable extension agents')}</span>
        </button>
      </div>
    </section>
  )
}

export function AgentCatalogToolbar({
  query,
  onQueryChange,
  selectedCategory,
  onCategoryChange,
  counts,
  total,
  t,
  compact = false
}: {
  query: string
  onQueryChange: (value: string) => void
  selectedCategory: AgentCategoryFilter
  onCategoryChange: (category: AgentCategoryFilter) => void
  counts: Map<AgentCatalogFilter, number>
  total: number
  t: TFunction<'common'>
  compact?: boolean
}): ReactElement {
  const filters: AgentCategoryFilter[] = [
    'all',
    'base',
    ...AGENT_CATEGORY_ORDER.filter((category) => (counts.get(category) ?? 0) > 0)
  ]
  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label={t('subagentsPanel.search', 'Search agents')}
          placeholder={t('subagentsPanel.searchPlaceholder', 'Search names, capabilities, or scenarios')}
          className={`w-full rounded-[10px] border border-ds-border bg-ds-card pl-9 pr-9 text-ds-heading outline-none transition placeholder:text-ds-faint focus:border-accent/45 focus:ring-2 focus:ring-accent/10 ${
            compact ? 'h-9 text-[12px]' : 'h-10 text-[13px]'
          }`}
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label={t('subagentsPanel.clearSearch', 'Clear search')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ds-faint hover:bg-ds-subtle hover:text-ds-heading"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {filters.map((filter) => {
          const active = selectedCategory === filter
          const count = filter === 'all' ? total : (counts.get(filter) ?? 0)
          const label = filter === 'all'
            ? t('subagentsPanel.category.all', 'All')
            : filter === 'base'
              ? t('subagentsPanel.category.baseAgent', 'Base agents')
              : agentCategoryLabel(t, filter)
          return (
            <button
              key={filter}
              type="button"
              aria-pressed={active}
              onClick={() => onCategoryChange(filter)}
              className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[10.5px] font-semibold transition ${
                active
                  ? 'border-accent bg-accent text-white shadow-sm'
                  : 'border-ds-border bg-ds-card text-ds-muted hover:border-accent/30 hover:text-ds-heading'
              }`}
            >
              <span>{label}</span>
              <span className={active ? 'text-white/80' : 'text-ds-faint'}>{count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
