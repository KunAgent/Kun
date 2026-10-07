import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from 'react'
import type { TFunction } from 'i18next'
import { Check, ChevronRight, Search, Settings2, Sparkles, Zap } from 'lucide-react'
import { modelSupportsImageInput } from '@shared/app-settings-provider-core'
import type { ComposerFastModeState } from './composer-fast-mode'
import { ComposerModelSourceIcon } from './ComposerModelSourceIcon'
import { DevinModelList } from './DevinModelList'
import {
  UNGROUPED_MODEL_PROVIDER_ID,
  composerModelMenuItemSelected,
  composerReasoningEffortForRailKey,
  filterComposerModelIds,
  modelProfileForModel,
  orderComposerReasoningRailEfforts,
  type ComposerModelMenuGroup,
  type ComposerReasoningEffort
} from './floating-composer-model-picker-logic'
import { ModelCapabilityBadge } from './floating-composer-model-picker-rows'

/** Show the filter only when scanning the list stops being quick. */
export const COMPOSER_MODEL_FILTER_THRESHOLD = 8
/** Up to this many models every provider starts expanded. */
export const COMPOSER_MODEL_EXPAND_ALL_THRESHOLD = 12

export type ComposerReasoningOption = { id: ComposerReasoningEffort; labelKey: string }

/** Intensity levels shown as segments; adaptive is a separate switch. */
export function composerReasoningLevels(options: readonly ComposerReasoningOption[]): ComposerReasoningEffort[] {
  return orderComposerReasoningRailEfforts(options.map((option) => option.id)).filter((effort) => effort !== 'auto')
}

/** Level chosen when the user turns adaptive reasoning off. */
export function composerReasoningLevelAfterAuto(levels: readonly ComposerReasoningEffort[]): ComposerReasoningEffort | undefined {
  return levels.includes('high') ? 'high' : levels[levels.length - 1]
}

/** Providers expanded when the panel opens: all of them for short lists, otherwise the current one. */
export function initialExpandedModelGroups(groups: readonly ComposerModelMenuGroup[], selectedProviderId: string | null): Set<string> {
  const total = groups.reduce((sum, group) => sum + group.modelIds.length, 0)
  if (groups.length <= 1 || total <= COMPOSER_MODEL_EXPAND_ALL_THRESHOLD) return new Set(groups.map((group) => group.providerId))
  return new Set([selectedProviderId ?? groups[0]!.providerId])
}

type ComposerModelPanelProps = {
  t: TFunction<'common'>
  panelRef: RefObject<HTMLDivElement | null>
  style: CSSProperties
  locked: boolean
  reasoningEnabled: boolean
  reasoningOptions: ComposerReasoningOption[]
  currentReasoning: ComposerReasoningEffort
  onReasoningChange?: (effort: ComposerReasoningEffort) => void
  fastModeState: ComposerFastModeState
  fastModeEnabled: boolean
  onFastModeToggle?: () => void
  groups: ComposerModelMenuGroup[]
  selectedProviderId: string | null
  currentModel: string
  emptyModelMessage?: string
  needsProviderSetup: boolean
  onConfigureProviders?: () => void
  onPickModel: (modelId: string, providerId?: string) => void
  onClose: () => void
  footer?: ReactNode
}

export function ComposerModelPanel(props: ComposerModelPanelProps): ReactElement {
  const { t, panelRef, style, reasoningEnabled, fastModeState, footer, needsProviderSetup, onConfigureProviders, onClose } = props
  const showReasoning = reasoningEnabled || fastModeState !== 'hidden'
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('composerModelControls')}
      style={style}
      data-composer-model-panel
      className="ds-composer-model-panel fixed z-[1000] flex flex-col overflow-hidden rounded-[14px] border border-ds-border bg-white text-[13px] text-ds-muted shadow-[0_18px_52px_rgba(20,30,50,0.18),0_2px_6px_rgba(20,30,50,0.06)] dark:bg-ds-card"
    >
      {showReasoning ? <ComposerReasoningSection {...props} /> : null}
      <ComposerModelList {...props} />
      {footer ? <div className="shrink-0 border-t border-ds-border-muted">{footer}</div>
        : onConfigureProviders && !needsProviderSetup && !props.emptyModelMessage ? (
          <button
            type="button"
            onClick={() => {
              onClose()
              onConfigureProviders()
            }}
            className="flex h-9 w-full shrink-0 items-center gap-2 border-t border-ds-border-muted px-4 text-[12.5px] font-medium text-ds-muted outline-none transition hover:bg-ds-hover hover:text-ds-ink focus-visible:bg-ds-hover"
          >
            <Settings2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
            {t('composerConfigureProviders')}
          </button>
        ) : null}
    </div>
  )
}

function ComposerReasoningSection({
  t, locked, reasoningEnabled, reasoningOptions, currentReasoning, onReasoningChange,
  fastModeState, fastModeEnabled, onFastModeToggle
}: ComposerModelPanelProps): ReactElement {
  const levels = useMemo(() => composerReasoningLevels(reasoningOptions), [reasoningOptions])
  const autoSupported = reasoningOptions.some((option) => option.id === 'auto')
  const autoActive = currentReasoning === 'auto'
  const labelFor = (effort: ComposerReasoningEffort): string =>
    t(reasoningOptions.find((option) => option.id === effort)?.labelKey ?? 'composerReasoningMax')
  const focusIndex = Math.max(0, levels.indexOf(currentReasoning))
  const onSegmentsKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (locked) return
    const next = composerReasoningEffortForRailKey(levels, autoActive ? levels[focusIndex]! : currentReasoning, event.key)
    if (!next) return
    event.preventDefault()
    onReasoningChange?.(next)
    const group = event.currentTarget
    window.requestAnimationFrame(() => group.querySelector<HTMLButtonElement>(`[data-reasoning-effort="${next}"]`)?.focus())
  }
  const fastSupported = fastModeState === 'supported'
  const fastActive = fastSupported && fastModeEnabled
  const fastLabel = !fastSupported
    ? t(fastModeState === 'unsupported' ? 'composerFastModeUnsupported' : 'composerFastModeUnverified')
    : t(fastActive ? 'composerFastModeOn' : 'composerFastModeOff')
  const fastDisabled = !fastSupported || locked
  return (
    <div className="shrink-0 border-b border-ds-border-muted px-3.5 pb-3 pt-3" data-composer-reasoning-section>
      {reasoningEnabled ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] font-semibold text-ds-ink">{t('composerReasoning')}</span>
            <span className="text-[11.5px] text-ds-faint" aria-hidden="true">
              {t('composerReasoningFaster')} ↔ {t('composerReasoningSmarter')}
            </span>
          </div>
          {levels.length > 0 ? (
            <div
              role="radiogroup"
              aria-label={t('composerReasoning')}
              aria-disabled={locked || undefined}
              onKeyDown={onSegmentsKeyDown}
              className="ds-composer-reasoning-segments mt-2.5"
            >
              {levels.map((effort, index) => {
                const checked = !autoActive && effort === currentReasoning
                return (
                  <button
                    key={effort}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    tabIndex={index === focusIndex ? 0 : -1}
                    disabled={locked}
                    data-reasoning-effort={effort}
                    onClick={() => {
                      if (!checked) onReasoningChange?.(effort)
                    }}
                    className={`ds-composer-reasoning-segment${checked ? ' is-checked' : ''}${checked && effort === 'max' ? ' is-maximum' : ''}`}
                  >
                    {labelFor(effort)}
                  </button>
                )
              })}
            </div>
          ) : null}
        </>
      ) : null}
      {(reasoningEnabled && autoSupported) || fastModeState !== 'hidden' ? (
        <div className={`flex flex-wrap items-center gap-2${reasoningEnabled ? ' mt-2.5' : ''}`}>
          {reasoningEnabled && autoSupported ? (
            <button
              type="button"
              aria-pressed={autoActive}
              disabled={locked}
              data-reasoning-effort="auto"
              onClick={() => {
                if (!autoActive) onReasoningChange?.('auto')
                else {
                  const next = composerReasoningLevelAfterAuto(levels)
                  if (next) onReasoningChange?.(next)
                }
              }}
              className={`ds-composer-panel-toggle${autoActive ? ' is-on' : ''}`}
            >
              <Sparkles className="h-3 w-3 shrink-0" strokeWidth={2} />
              {labelFor('auto')}
            </button>
          ) : null}
          {fastModeState !== 'hidden' ? (
            <button
              type="button"
              aria-pressed={fastActive}
              aria-disabled={fastDisabled}
              aria-label={fastLabel}
              title={fastSupported ? `${fastLabel} — ${t('composerFastModeHint')}` : fastLabel}
              onClick={() => {
                if (!fastDisabled) onFastModeToggle?.()
              }}
              className={`ds-composer-panel-toggle is-fast${fastActive ? ' is-on' : ''}${fastDisabled ? ' is-unavailable' : ''}`}
            >
              <Zap className={`h-3 w-3 shrink-0${fastActive ? ' fill-current' : ''}`} strokeWidth={2} />
              {t('composerFastModeLabel')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ComposerModelList({
  t, groups, selectedProviderId, currentModel, emptyModelMessage, needsProviderSetup,
  onConfigureProviders, onPickModel, onClose, currentReasoning, reasoningOptions
}: ComposerModelPanelProps): ReactElement {
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState(() => initialExpandedModelGroups(groups, selectedProviderId))
  const listRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const totalModels = groups.reduce((sum, group) => sum + group.modelIds.length, 0)
  const devinOnly = groups.length === 1 && groups[0]!.nativeHarnessId === 'devin'
  const showFilter = !devinOnly && totalModels > COMPOSER_MODEL_FILTER_THRESHOLD
  const query = filter.trim()
  const visibleGroups = groups.map((group) => ({
    group,
    modelIds: query && group.nativeHarnessId !== 'devin' ? filterComposerModelIds(group.modelIds, query, group.modelInfo) : group.modelIds
  })).filter((entry) => entry.modelIds.length > 0)
  const collapsible = groups.length > 1 && !query

  useEffect(() => {
    if (showFilter) searchRef.current?.focus({ preventScroll: true })
    const selected = listRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
    if (typeof selected?.scrollIntoView === 'function') selected.scrollIntoView({ block: 'nearest' })
    // Only on open: later selections close the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-model-nav]:not(:disabled)') ?? [])
    if (items.length === 0) return
    event.preventDefault()
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown'
      ? items[index < 0 ? 0 : Math.min(items.length - 1, index + 1)]
      : items[index <= 0 ? 0 : index - 1]
    next?.focus()
  }

  if (emptyModelMessage || needsProviderSetup) {
    return (
      <div className="min-h-0 flex-1 px-3.5 py-3">
        <p role="status" className="text-[12.5px] leading-5 text-ds-muted" data-model-catalog-empty={emptyModelMessage ? '' : undefined}>
          {emptyModelMessage ?? t('composerNoProviders')}
        </p>
        {needsProviderSetup && onConfigureProviders ? (
          <button
            type="button"
            onClick={() => {
              onClose()
              onConfigureProviders()
            }}
            className="mt-2.5 flex w-full items-center justify-center rounded-lg border border-ds-border bg-ds-subtle px-3 py-2 text-[12.5px] font-semibold text-ds-ink transition hover:bg-ds-hover"
          >
            {t('composerConfigureProviders')}
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-2">
      {showFilter ? (
        <label className="mx-2.5 mb-1.5 flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-ds-subtle px-2.5 text-ds-faint focus-within:ring-2 focus-within:ring-accent-tint/20">
          <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <input
            ref={searchRef}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return
              event.preventDefault()
              listRef.current?.querySelector<HTMLElement>('[data-model-nav]:not(:disabled)')?.focus()
            }}
            aria-label={t('composerModelSearchPlaceholder')}
            placeholder={t('composerModelSearchPlaceholder')}
            className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] font-medium text-ds-ink outline-none placeholder:text-ds-faint focus-visible:!outline-none focus-visible:!ring-0"
          />
        </label>
      ) : null}
      <div
        ref={listRef}
        role="menu"
        aria-label={t('composerModel')}
        onKeyDown={onListKeyDown}
        className={`min-h-0 flex-1 overscroll-contain px-1.5 pb-1.5 ${devinOnly ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}
      >
        {visibleGroups.length === 0 ? (
          <p className="px-2.5 py-2 text-[12.5px] font-medium text-ds-faint">{t('composerNoMatchingModels')}</p>
        ) : visibleGroups.map(({ group, modelIds }) => {
          const open = !collapsible || expanded.has(group.providerId)
          const icon = <ComposerModelSourceIcon presetId={group.presetSource} providerId={group.providerId} className="h-3.5 w-3.5 shrink-0" />
          return (
            <div key={group.providerId} role="group" aria-label={group.label} data-model-provider={group.providerId}>
              {groups.length > 1 || group.providerId !== UNGROUPED_MODEL_PROVIDER_ID ? (
                <button
                  type="button"
                  data-model-nav
                  aria-expanded={collapsible ? open : undefined}
                  disabled={!collapsible}
                  onClick={() => setExpanded((current) => {
                    const next = new Set(current)
                    if (next.has(group.providerId)) next.delete(group.providerId)
                    else next.add(group.providerId)
                    return next
                  })}
                  className="flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-[11.5px] font-semibold text-ds-faint outline-none transition enabled:hover:bg-ds-hover enabled:hover:text-ds-muted focus-visible:bg-ds-hover disabled:cursor-default"
                >
                  {icon}
                  <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                  {collapsible ? (
                    <>
                      <span className="font-normal tabular-nums">{group.modelIds.length}</span>
                      <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform${open ? ' rotate-90' : ''}`} strokeWidth={1.9} />
                    </>
                  ) : null}
                </button>
              ) : null}
              {!open ? null : group.nativeHarnessId === 'devin' ? (
                <DevinModelList
                  key={group.providerId}
                  group={group}
                  currentModel={currentModel}
                  currentReasoning={currentReasoning}
                  reasoningOptions={reasoningOptions}
                  maxHeight={380}
                  t={t}
                  onPick={(id) => onPickModel(id, group.providerId)}
                />
              ) : modelIds.map((id) => {
                const profile = modelProfileForModel(group, id)
                const selected = composerModelMenuItemSelected({ groupProviderId: group.providerId, selectedProviderId, currentModel, modelId: id })
                const title = group.modelInfo?.[id]?.displayName ?? id
                return (
                  <button
                    key={`${group.providerId}:${id}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    data-model-nav
                    title={title === id ? id : `${title} (${id})`}
                    onClick={() => onPickModel(id, group.providerId === UNGROUPED_MODEL_PROVIDER_ID ? undefined : group.providerId)}
                    className={`flex min-h-[34px] w-full items-center gap-2 rounded-lg px-2.5 text-left outline-none transition focus-visible:bg-ds-hover ${
                      selected ? 'bg-accent-soft text-ds-ink' : 'text-ds-ink hover:bg-ds-hover'
                    }`}
                  >
                    <span className={`min-w-0 flex-1 truncate text-[13px]${selected ? ' font-semibold' : ''}`}>{title}</span>
                    {!profile ? null : modelSupportsImageInput(profile)
                      ? <ModelCapabilityBadge kind="vision" label={t('composerModelVision')} />
                      : <ModelCapabilityBadge kind="text" label={t('composerModelTextOnly')} />}
                    <span className="flex w-4 shrink-0 justify-center">
                      {selected ? <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.4} /> : null}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
