import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { ChevronDown, ChevronRight, Pencil, Power, Search, Trash2 } from 'lucide-react'
import type { KunSubagentSurfaceV1, ModelReasoningEffort } from '@shared/app-settings'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { ModelSelect, ReasoningEffortPicker } from './SubagentProfileControls'
import {
  agentCategoryLabel,
  surfaceLabel
} from './SubagentCatalogControls'
import { AgentKun } from './AgentKun'
import {
  normalizeStoredReasoning,
  profileSurfaces,
  resolveReasoningOptions,
  type AgentCategory,
  type CatalogAgent,
  type EditorVariant,
  type SurfaceTab
} from './subagent-settings-support'

export function AgentCategorySection({
  category,
  count,
  expanded,
  onToggle,
  t,
  compact = false,
  summary,
  configuration,
  children
}: {
  category: AgentCategory
  count: number
  expanded: boolean
  onToggle: () => void
  t: TFunction<'common'>
  compact?: boolean
  summary: string
  configuration?: ReactNode
  children: ReactNode
}): ReactElement {
  const label = agentCategoryLabel(t, category)
  return (
    <section
      data-agent-category={category}
      className={`mb-2 overflow-visible rounded-xl border transition ${
        expanded
          ? 'border-accent/20 bg-ds-card shadow-sm shadow-black/[0.03]'
          : 'border-ds-border-muted bg-ds-card/80 hover:border-accent/20'
      }`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={t('subagentsPanel.toggleCategory', 'Toggle {{category}} category', { category: label })}
        onClick={onToggle}
        className={`flex w-full min-w-0 items-center gap-2 rounded-xl text-left font-semibold text-ds-heading transition hover:bg-ds-hover/60 ${
          compact ? 'px-3 py-2.5 text-[11.5px]' : 'px-3 py-3 text-[12.5px]'
        }`}
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-ds-faint transition ${expanded ? 'rotate-90' : ''}`} />
        <span className="truncate">{label}</span>
        <span className="rounded-full bg-ds-card-muted px-1.5 py-0.5 text-[9.5px] font-semibold text-ds-muted">{count}</span>
        {!expanded ? (
          <span
            title={summary}
            className="ml-auto max-w-[55%] truncate rounded-full bg-ds-card-muted px-2 py-1 text-[9.5px] font-medium text-ds-muted"
          >
            {summary}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className={compact ? 'px-2.5 pb-2.5' : 'px-3 pb-3'}>
          {configuration}
          {children}
        </div>
      ) : null}
    </section>
  )
}

function agentSourceChip(
  agent: Pick<CatalogAgent, 'builtin' | 'source'>,
  t: TFunction<'common'>
): ReactElement | null {
  if (agent.source === 'workspace' || (!agent.builtin && agent.source === 'configured')) {
    return (
      <span className="shrink-0 rounded-full bg-violet-500/10 px-1.5 py-px text-[8.5px] font-semibold text-violet-600 dark:text-violet-400">
        {t('subagentsPanel.customTag', 'Custom')}
      </span>
    )
  }
  if (agent.builtin || agent.source === 'builtin') {
    return (
      <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-px text-[8.5px] font-semibold text-accent">
        {t('subagentsPanel.builtin', 'Built-in')}
      </span>
    )
  }
  return null
}

export function CatalogAgentRow({
  agent,
  selected,
  variant,
  onSelect,
  t,
  children
}: {
  agent: CatalogAgent
  selected: boolean
  variant: EditorVariant
  onSelect: () => void
  t: TFunction<'common'>
  children?: ReactNode
}): ReactElement {
  const { profile, name, desc } = agent
  const settings = variant === 'settings'
  const modelLabel = profile.model || t('agentsView.followDefault', 'Follow default')
  return (
    <div
      data-agent-id={profile.id}
      data-agent-source={agent.source}
      className={`overflow-visible rounded-xl border transition ${
        selected
          ? 'border-accent/70 bg-accent-soft/45 shadow-[0_0_0_1px_rgba(59,130,216,0.08)]'
          : 'border-ds-border-muted bg-ds-card hover:border-accent/25 hover:bg-ds-hover/35'
      } ${profile.enabled ? '' : 'opacity-60'}`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`flex w-full min-w-0 items-center gap-2.5 text-left ${settings ? 'px-3 py-2.5' : 'px-2.5 py-2'}`}
      >
        <span
          className={`flex shrink-0 items-center justify-center rounded-full ${settings ? 'h-10 w-10' : 'h-9 w-9'}`}
          style={{
            background: 'radial-gradient(circle at 50% 36%, #fff 0%, rgba(238,244,251,0.9) 78%)',
            boxShadow: 'inset 0 0 0 1px rgba(188,214,245,0.7)'
          }}
        >
          <AgentKun id={profile.id} disabled={!profile.enabled} className={settings ? 'h-8 w-8' : 'h-7 w-7'} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={`truncate font-semibold text-ds-heading ${settings ? 'text-[12.5px]' : 'text-[12px]'}`}>{name}</span>
            {agentSourceChip(agent, t)}
            {agent.baseAgent ? (
              <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-px text-[8.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                {t('subagentsPanel.surface.shared', 'Base')}
              </span>
            ) : null}
          </span>
          <span className={`mt-0.5 block truncate text-ds-muted ${settings ? 'text-[10.5px]' : 'text-[10px]'}`}>{desc}</span>
          {settings ? (
            <span className="mt-1 inline-flex max-w-full rounded-md bg-ds-card-muted px-1.5 py-0.5 text-[9px] font-semibold text-ds-muted">
              <span className="truncate">{modelLabel}</span>
            </span>
          ) : null}
        </span>
        {!settings ? (
          <span className="flex max-w-[132px] shrink-0 flex-col items-end gap-0.5">
            <span className="text-[8.5px] font-semibold uppercase tracking-wide text-ds-faint">
              {t('subagentsPanel.effectiveModel', 'Effective model')}
            </span>
            <span
              title={modelLabel}
              className="max-w-full truncate text-[9.5px] font-semibold text-ds-muted"
            >
              {modelLabel}
            </span>
          </span>
        ) : null}
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-ds-faint transition ${selected && !settings ? 'rotate-90' : ''}`} />
      </button>
      {children}
    </div>
  )
}

export function AgentDetailsPanel({
  agent,
  groups,
  onModelChange,
  onReasoningChange,
  selectedSurface,
  onToggleSurface,
  onToggle,
  onEdit,
  onDelete,
  t
}: {
  agent: CatalogAgent
  groups: ModelProviderModelGroup[]
  onModelChange: (model: string, providerId: string) => void
  onReasoningChange: (effort: ModelReasoningEffort) => void
  selectedSurface: SurfaceTab
  onToggleSurface: () => void
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  t: TFunction<'common'>
}): ReactElement {
  const { profile, builtin, name, desc, category, source, filePath } = agent
  const surfaces = profileSurfaces(profile)
  const inherited = selectedSurface !== 'shared' && surfaces.includes('shared')
  const assigned = inherited || surfaces.includes(selectedSurface)
  const workspaceLocked = source === 'workspace'
  const locked = profile.id === 'general' || inherited || workspaceLocked
  return (
    <aside className="lg:sticky lg:top-4" data-testid="subagent-details-panel">
      <div className="flex items-start gap-3">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
          style={{
            background: 'radial-gradient(circle at 50% 36%, #fff 0%, rgba(238,244,251,0.9) 78%)',
            boxShadow: 'inset 0 0 0 1px rgba(188,214,245,0.7)'
          }}
        >
          <AgentKun id={profile.id} disabled={!profile.enabled} className="h-10 w-10" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-[14px] font-semibold text-ds-heading">{name}</h3>
            {agentSourceChip(agent, t)}
          </div>
          <p className="mt-1 text-[11.5px] leading-5 text-ds-muted">{desc}</p>
          {workspaceLocked && filePath ? (
            <p className="mt-1 truncate text-[10px] text-ds-faint" title={filePath}>
              {t('subagentsPanel.workspaceFile', 'Defined in {{path}}', { path: filePath })}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-4 border-t border-ds-border-muted pt-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-ds-border-muted bg-ds-card px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-ds-heading">
              {surfaceLabel(t, selectedSurface)}
            </div>
            <div className="mt-0.5 text-[10px] text-ds-muted">
              {inherited
                ? t('subagentsPanel.surfaceInherited', 'Inherited from Base')
                : assigned
                  ? t('subagentsPanel.surfaceAssigned', 'Available in this mode')
                  : t('subagentsPanel.surfaceUnassigned', 'Not available in this mode')}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-label={surfaceLabel(t, selectedSurface)}
            aria-checked={assigned}
            disabled={locked}
            onClick={onToggleSurface}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${assigned ? 'bg-accent' : 'bg-ds-card-muted'} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${assigned ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ds-faint">
            {t('agentsView.fModel', 'Model')}
          </div>
          {workspaceLocked ? (
            <div className="rounded-lg border border-ds-border-muted bg-ds-card-muted px-3 py-2 text-[11px] text-ds-muted">
              {t('agentsView.followDefault', 'Follow default')}
            </div>
          ) : (
            <ModelSelect
              value={profile.model ?? ''}
              providerId={profile.providerId ?? ''}
              groups={groups}
              stretch
              onChange={onModelChange}
            />
          )}
        </div>
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ds-faint">
            {t('subagentsPanel.reasoning', 'Reasoning')}
          </div>
          {workspaceLocked ? (
            <div className="rounded-lg border border-ds-border-muted bg-ds-card-muted px-3 py-2 text-[11px] text-ds-muted">
              {t('composerReasoningOff', 'Off')}
            </div>
          ) : (
            <ReasoningEffortPicker
              value={normalizeStoredReasoning(profile.reasoningEffort)}
              options={resolveReasoningOptions(groups, profile.model ?? '', profile.providerId ?? '')}
              onChange={onReasoningChange}
            />
          )}
        </div>

        <div>
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-ds-faint">
            {t('subagentsPanel.capabilities', 'Capabilities')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-md bg-ds-card-muted px-2 py-1 text-[10px] font-medium text-ds-muted">
              {agentCategoryLabel(t, category)}
            </span>
            <span className="rounded-md bg-ds-card-muted px-2 py-1 text-[10px] font-medium text-ds-muted">
              {profile.toolPolicy === 'readOnly'
                ? t('agentsView.toolReadOnly', 'Read-only')
                : t('agentsView.toolInherit', 'All tools')}
            </span>
            <span className="rounded-md bg-ds-card-muted px-2 py-1 text-[10px] font-medium text-ds-muted">
              {profile.mode === 'primary'
                ? t('agentsView.modePersona', 'Persona')
                : profile.mode === 'all'
                  ? t('agentsView.modeBoth', 'Both')
                  : t('agentsView.modeDelegate', 'Delegate')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-card px-3 py-2">
          <span className={`h-2 w-2 rounded-full ${profile.enabled ? 'bg-emerald-500' : 'bg-ds-faint'}`} />
          <span className="text-[11px] font-medium text-ds-muted">
            {profile.enabled ? t('enable', 'Enabled') : t('disable', 'Disabled')}
          </span>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2 border-t border-ds-border-muted pt-4">
        {!builtin && source !== 'workspace' ? (
          <button data-settings-action="ghost" data-settings-size="icon" aria-label={profile.enabled ? t('disable', 'Disable') : t('enable', 'Enable')}
            type="button"
            onClick={onToggle}
            className="rounded-lg border border-ds-border px-2.5 py-2 text-ds-muted transition hover:bg-ds-hover hover:text-ds-heading"
            title={profile.enabled ? t('disable', 'Disable') : t('enable', 'Enable')}
          >
            <Power className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {source === 'workspace' ? (
          <div className="flex-1 rounded-lg border border-ds-border-muted bg-ds-card-muted px-3 py-2 text-[11px] text-ds-muted">
            {t('subagentsPanel.workspaceReadOnly', 'Edit this role in .kun/agents/*.md')}
          </div>
        ) : (
          <button data-settings-action="primary" data-settings-size="default"
            type="button"
            onClick={onEdit}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[11.5px] font-semibold text-white transition hover:bg-accent/90"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('agentsView.edit', 'Edit')}
          </button>
        )}
        {!builtin && source !== 'workspace' ? (
          <button data-settings-action="danger-ghost" data-settings-size="icon" aria-label={t('agentsView.delete', 'Delete')}
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-ds-border px-2.5 py-2 text-ds-muted transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
            title={t('agentsView.delete', 'Delete')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </aside>
  )
}

export function EmptyCatalogState({
  query,
  t,
  compact = false
}: {
  query: string
  t: TFunction<'common'>
  compact?: boolean
}): ReactElement {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'min-h-40' : 'min-h-56'}`}>
      <Search className="h-7 w-7 text-ds-faint" strokeWidth={1.6} />
      <div className="mt-3 text-[12.5px] font-semibold text-ds-heading">
        {t('subagentsPanel.emptyTitle', 'No matching agents')}
      </div>
      <p className="mt-1 max-w-56 text-[11px] leading-5 text-ds-muted">
        {query
          ? t('subagentsPanel.emptySearch', 'Try another name, capability, or scenario.')
          : t('subagentsPanel.emptyCategory', 'Choose another category to continue browsing.')}
      </p>
    </div>
  )
}

export function BoundedNumberInput({
  ariaLabel,
  value,
  min,
  max,
  onCommit
}: {
  ariaLabel?: string
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
}): ReactElement {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const commit = (): void => {
    const parsed = Number(draft)
    const next = Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, Math.floor(parsed)))
      : value
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }

  return (
    <input
      type="number"
      aria-label={ariaLabel}
      min={min}
      max={max}
      value={draft}
      onChange={(event) => {
        const raw = event.target.value
        setDraft(raw)
        const parsed = Number(raw)
        if (raw.trim() && Number.isInteger(parsed) && parsed >= min && parsed <= max && parsed !== value) {
          onCommit(parsed)
        }
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      className="w-28 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-right font-mono text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
    />
  )
}
