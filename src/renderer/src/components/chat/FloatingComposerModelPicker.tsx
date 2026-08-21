import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Brain, ChevronDown, Gauge, Search, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { modelSupportsImageInput } from '@shared/app-settings'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { composerSupportsCodexFastMode } from './composer-fast-mode'
import { renderComposerModelMenu } from './floating-composer-model-menu'
import {
  FLOATING_REASONING_POPOVER_ESTIMATED_HEIGHT, FLOATING_REASONING_POPOVER_WIDTH,
  FLOATING_MENU_MAX_HEIGHT, FLOATING_MENU_WIDTH, FLOATING_SUBMENU_MAX_HEIGHT,
  FLOATING_SUBMENU_WIDTH, REASONING_OPTIONS, UNGROUPED_MODEL_PROVIDER_ID,
  buildComposerModelMenuGroups, buildComposerModelOptions, calculateFloatingMenuPlacement,
  calculateFloatingReasoningPopoverPlacement, calculateFloatingSubmenuPlacement,
  composerModelMenuItemSelected, composerReasoningEffortForRailKey,
  composerReasoningEffortForRailPosition, composerReasoningEffortHasEnergyMotion,
  composerReasoningRailPointerPosition, composerReasoningRailPosition,
  composerReasoningRailThumbCenter, currentBodyZoom, estimatedModelSubmenuHeight,
  estimatedReasoningSubmenuHeight, filterComposerModelIds, fullModelLabel,
  modelProfileForModel, modelProfileForSelection, modelIdsMatch,
  normalizeComposerReasoningEffort, normalizeComposerReasoningEffortValue,
  orderComposerReasoningRailEfforts, reasoningLabelKey, reasoningOptionsForModel,
  shouldShowProviderSetupPrompt,
  type ComposerModelMenuGroup,
  type ComposerReasoningEffort,
  type FloatingMenuPlacement,
  type FloatingReasoningPopoverPlacement,
  type FloatingSubmenuPlacement
} from './floating-composer-model-picker-logic'
import { MenuSectionTitle, MenuSeparator, ModelCapabilityBadge, PickerRow, ProviderRow, SubmenuRow } from './floating-composer-model-picker-rows'
import { ProviderIcon } from '../provider-icon'

export type { ComposerReasoningEffort } from './floating-composer-model-picker-logic'
export {
  buildComposerModelMenuGroups,
  buildComposerModelOptions,
  calculateFloatingMenuPlacement,
  calculateFloatingReasoningPopoverPlacement,
  calculateFloatingSubmenuPlacement,
  composerMenuSupportsModel,
  composerModelMenuItemSelected,
  composerReasoningEffortForRailKey,
  composerReasoningEffortForRailPosition,
  composerReasoningEffortHasEnergyMotion,
  composerReasoningEffortRequestValue,
  composerReasoningRailPointerPosition,
  composerReasoningRailPosition,
  filterComposerModelIds,
  normalizeComposerReasoningEffort,
  orderComposerReasoningRailEfforts
} from './floating-composer-model-picker-logic'

type Props = {
  compact: boolean
  mode: 'select' | 'combobox'
  composerModel: string
  composerProviderId?: string
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  canChangeModel: boolean
  controlVariant?: 'combined' | 'split'
  stretch?: boolean
  composerReasoningEffort?: string
  composerFastMode?: boolean
  showProviderInModelLabel?: boolean
  onComposerModelChange: (modelId: string, providerId?: string) => void
  onComposerReasoningEffortChange?: (effort: ComposerReasoningEffort) => void
  onComposerFastModeChange?: (enabled: boolean) => void
  onConfigureProviders?: () => void
}
export function FloatingComposerModelPicker({
  compact,
  mode,
  composerModel,
  composerProviderId = '',
  composerPickList,
  composerModelGroups = [],
  canChangeModel,
  controlVariant = 'combined',
  stretch = false,
  composerReasoningEffort = 'max',
  composerFastMode = false,
  showProviderInModelLabel = false,
  onComposerModelChange,
  onComposerReasoningEffortChange,
  onComposerFastModeChange,
  onConfigureProviders
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const pickerRef = useRef<HTMLElement | null>(null)
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const submenuRef = useRef<HTMLDivElement | null>(null)
  const reasoningTriggerRef = useRef<HTMLButtonElement | null>(null)
  const reasoningPopoverRef = useRef<HTMLDivElement | null>(null)
  const reasoningDragPointerRef = useRef<number | null>(null)
  const reasoningRowRef = useRef<HTMLButtonElement | null>(null)
  const providerRowRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [menuOpen, setMenuOpen] = useState(false)
  const [reasoningPanelOpen, setReasoningPanelOpen] = useState(false)
  const [reasoningPopoverOpen, setReasoningPopoverOpen] = useState(false)
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
  const [modelFilter, setModelFilter] = useState('')
  const [menuPlacement, setMenuPlacement] = useState<FloatingMenuPlacement | null>(null)
  const [submenuPlacement, setSubmenuPlacement] = useState<FloatingSubmenuPlacement | null>(null)
  const [reasoningPopoverPlacement, setReasoningPopoverPlacement] = useState<FloatingReasoningPopoverPlacement | null>(null)
  const modelOptions = useMemo(() => buildComposerModelOptions(composerPickList), [composerPickList])
  const providerMenuGroups = useMemo<ComposerModelMenuGroup[]>(() => {
    return buildComposerModelMenuGroups({
      composerModelGroups,
      modelOptions,
      ungroupedLabel: t('composerOtherModels')
    })
  }, [composerModelGroups, modelOptions, t])
  const currentModel = composerModel.trim()
  const selectedProviderId = providerMenuGroups.find((group) =>
    group.providerId === composerProviderId.trim() &&
    group.modelIds.some((id) => modelIdsMatch(id, currentModel))
  )?.providerId ?? providerMenuGroups.find((group) =>
    group.modelIds.some((id) => modelIdsMatch(id, currentModel))
  )?.providerId ?? null
  const selectedProviderGroup = providerMenuGroups.find((group) =>
    group.providerId === selectedProviderId
  ) ?? null
  const selectedProviderIcon = selectedProviderGroup ? (
    <ProviderIcon
      presetId={selectedProviderGroup.presetSource}
      providerId={selectedProviderGroup.providerId}
      className="h-4 w-4 shrink-0 text-ds-faint"
    />
  ) : null
  const currentModelProfile = modelProfileForSelection(providerMenuGroups, currentModel, selectedProviderId)
  const needsProviderSetup = shouldShowProviderSetupPrompt(providerMenuGroups)
  const reasoningOptions = reasoningOptionsForModel(currentModelProfile)
  const reasoningEnabled =
    !needsProviderSetup && Boolean(onComposerReasoningEffortChange) && reasoningOptions.length > 0
  const fastModeAvailable =
    Boolean(onComposerFastModeChange) &&
    composerSupportsCodexFastMode(
      composerModelGroups,
      currentModel,
      composerProviderId
    )
  const currentReasoning = normalizeComposerReasoningEffort(
    composerReasoningEffort,
    currentModelProfile
  )
  const currentReasoningLabel = t(reasoningLabelKey(currentReasoning))
  const reasoningRailEfforts = useMemo(
    () => orderComposerReasoningRailEfforts(reasoningOptions.map((option) => option.id)),
    [reasoningOptions]
  )
  const reasoningRailPosition = composerReasoningRailPosition(reasoningRailEfforts, currentReasoning)
  const reasoningRailIndex = Math.max(0, reasoningRailEfforts.indexOf(currentReasoning))
  const reasoningHasEnergyMotion = composerReasoningEffortHasEnergyMotion(currentReasoning)
  const reasoningAtMaximum = reasoningRailPosition >= 1
  const reasoningThumbCenter = composerReasoningRailThumbCenter(reasoningRailPosition)
  const canOpenModelControls = canChangeModel || (needsProviderSetup && Boolean(onConfigureProviders))
  const modelLabel = needsProviderSetup
    ? t('composerNoProvidersShort')
    : fullModelLabel(composerModel, t('autoLabel'))
  const splitModelLabel =
    showProviderInModelLabel && selectedProviderGroup?.label
      ? `${selectedProviderGroup.label} · ${modelLabel}`
      : modelLabel
  const controlsTitle = [selectedProviderGroup?.label, modelLabel, reasoningEnabled ? currentReasoningLabel : ''].filter(Boolean).join(' / ')
  const activeProviderGroup =
    providerMenuGroups.find((group) => group.providerId === activeProviderId) ?? null
  const activeProviderModelIds = activeProviderGroup
    ? filterComposerModelIds(activeProviderGroup.modelIds, modelFilter)
    : []
  const comboboxWidthClass = stretch
    ? 'min-w-0 flex-1 max-w-[min(284px,45vw)] overflow-hidden'
    : compact
      ? 'w-[184px] max-w-[184px] shrink-0 overflow-hidden'
      : 'w-[248px] max-w-[min(260px,42vw)] shrink-0 overflow-hidden'
  const splitModelWidthClass = stretch
    ? fastModeAvailable
      ? 'max-w-[min(328px,52vw)]'
      : 'max-w-[min(284px,45vw)]'
    : compact
      ? fastModeAvailable ? 'max-w-[224px]' : 'max-w-[184px]'
      : fastModeAvailable ? 'max-w-[min(304px,50vw)]' : 'max-w-[min(260px,42vw)]'

  useEffect(() => {
    if (!reasoningEnabled) return
    const rawReasoning = normalizeComposerReasoningEffortValue(composerReasoningEffort)
    if (rawReasoning !== currentReasoning) {
      onComposerReasoningEffortChange?.(currentReasoning)
    }
  }, [composerReasoningEffort, currentReasoning, onComposerReasoningEffortChange, reasoningEnabled])

  useEffect(() => {
    if (reasoningEnabled) return
    setReasoningPopoverOpen(false)
  }, [reasoningEnabled])

  useEffect(() => {
    if (!menuOpen && !reasoningPopoverOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (pickerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      if (submenuRef.current?.contains(target)) return
      if (reasoningTriggerRef.current?.contains(target)) return
      if (reasoningPopoverRef.current?.contains(target)) return
      setMenuOpen(false)
      setReasoningPopoverOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen, reasoningPopoverOpen])

  useEffect(() => {
    if (!menuOpen) {
      setMenuPlacement(null)
      setSubmenuPlacement(null)
      setReasoningPanelOpen(false)
      setModelFilter('')
      return
    }

    const updatePlacement = (): void => {
      const picker = controlVariant === 'split'
        ? modelTriggerRef.current
        : pickerRef.current
      if (!picker) return

      setMenuPlacement(
        calculateFloatingMenuPlacement({
          anchorRect: picker.getBoundingClientRect(),
          menuHeight: menuRef.current?.offsetHeight ?? 0,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          coordinateScale: currentBodyZoom()
        })
      )
    }

    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [controlVariant, menuOpen])

  useEffect(() => {
    if (!reasoningPopoverOpen || controlVariant !== 'split') {
      setReasoningPopoverPlacement(null)
      return
    }

    const updatePlacement = (): void => {
      const trigger = reasoningTriggerRef.current
      if (!trigger) return
      setReasoningPopoverPlacement(
        calculateFloatingReasoningPopoverPlacement({
          anchorRect: trigger.getBoundingClientRect(),
          popoverHeight: reasoningPopoverRef.current?.offsetHeight ?? FLOATING_REASONING_POPOVER_ESTIMATED_HEIGHT,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          coordinateScale: currentBodyZoom()
        })
      )
    }

    updatePlacement()
    const frame = window.requestAnimationFrame(updatePlacement)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [controlVariant, reasoningPopoverOpen])

  useEffect(() => {
    if (!reasoningPopoverOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setReasoningPopoverOpen(false)
      window.requestAnimationFrame(() => reasoningTriggerRef.current?.focus())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [reasoningPopoverOpen])

  useEffect(() => {
    if (controlVariant === 'split') return
    setReasoningPopoverOpen(false)
  }, [controlVariant])

  useEffect(() => {
    if (!menuOpen) {
      setActiveProviderId(null)
      setReasoningPanelOpen(false)
      return
    }
    if (providerMenuGroups.length === 0) {
      setActiveProviderId(null)
      return
    }
    setActiveProviderId((current) => {
      if (current && providerMenuGroups.some((group) => group.providerId === current)) return current
      return null
    })
  }, [menuOpen, providerMenuGroups])

  useEffect(() => {
    if (!menuOpen || (!reasoningPanelOpen && !activeProviderGroup)) {
      setSubmenuPlacement(null)
      return
    }

    const updatePlacement = (): void => {
      const row = reasoningPanelOpen
        ? reasoningRowRef.current
        : activeProviderGroup
          ? providerRowRefs.current.get(activeProviderGroup.providerId)
          : null
      if (!row) return

      setSubmenuPlacement(
        calculateFloatingSubmenuPlacement({
          anchorRect: row.getBoundingClientRect(),
          submenuHeight:
            submenuRef.current?.offsetHeight
            || (reasoningPanelOpen
              ? estimatedReasoningSubmenuHeight(reasoningOptions.length)
              : estimatedModelSubmenuHeight(activeProviderModelIds.length)),
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          coordinateScale: currentBodyZoom()
        })
      )
    }

    updatePlacement()
    const menu = menuRef.current
    menu?.addEventListener('scroll', updatePlacement, true)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      menu?.removeEventListener('scroll', updatePlacement, true)
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [activeProviderGroup, activeProviderModelIds.length, menuOpen, reasoningOptions.length, reasoningPanelOpen])

  const menuStyle: CSSProperties = menuPlacement
    ? {
        left: `${menuPlacement.left}px`,
        top: `${menuPlacement.top}px`,
        width: `${menuPlacement.width}px`,
        maxHeight: `${menuPlacement.maxHeight}px`
      }
    : {
        left: 0,
        top: 0,
        width: `${FLOATING_MENU_WIDTH}px`,
        maxHeight: `${FLOATING_MENU_MAX_HEIGHT}px`,
        visibility: 'hidden'
      }

  const submenuStyle: CSSProperties = submenuPlacement
    ? {
        left: `${submenuPlacement.left}px`,
        top: `${submenuPlacement.top}px`,
        width: `${submenuPlacement.width}px`,
        maxHeight: `${submenuPlacement.maxHeight}px`
      }
    : {
        left: 0,
        top: 0,
        width: `${FLOATING_SUBMENU_WIDTH}px`,
        maxHeight: `${FLOATING_SUBMENU_MAX_HEIGHT}px`,
        visibility: 'hidden'
      }

  const reasoningPopoverStyle: CSSProperties = reasoningPopoverPlacement
    ? {
        left: `${reasoningPopoverPlacement.left}px`,
        top: `${reasoningPopoverPlacement.top}px`,
        width: `${reasoningPopoverPlacement.width}px`
      }
    : {
        left: 0,
        top: 0,
        width: `${FLOATING_REASONING_POPOVER_WIDTH}px`,
        visibility: 'hidden'
      }

  const selectReasoningAtPosition = (position: number): void => {
    const next = composerReasoningEffortForRailPosition(reasoningRailEfforts, position)
    if (next && next !== currentReasoning) onComposerReasoningEffortChange?.(next)
  }

  const selectReasoningAtPointer = (
    event: ReactPointerEvent<HTMLDivElement>
  ): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    selectReasoningAtPosition(
      composerReasoningRailPointerPosition(event.clientX, rect.left, rect.width)
    )
  }

  const onReasoningRailPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!canChangeModel) return
    reasoningDragPointerRef.current = event.pointerId
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Keep in-rail dragging functional when synthetic input cannot establish capture.
    }
    selectReasoningAtPointer(event)
  }

  const onReasoningRailPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!canChangeModel || reasoningDragPointerRef.current !== event.pointerId) return
    selectReasoningAtPointer(event)
  }

  const onReasoningRailPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (reasoningDragPointerRef.current === event.pointerId) {
      reasoningDragPointerRef.current = null
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onReasoningRailKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!canChangeModel || reasoningRailEfforts.length === 0) return
    const next = composerReasoningEffortForRailKey(
      reasoningRailEfforts,
      currentReasoning,
      event.key
    )
    if (!next) return
    event.preventDefault()
    if (next !== currentReasoning) onComposerReasoningEffortChange?.(next)
  }

  const renderSplitReasoningPopover = (): ReactElement | null => {
    if (!reasoningPopoverOpen || controlVariant !== 'split' || !reasoningEnabled) return null
    const popover = (
      <div
        ref={reasoningPopoverRef}
        role="dialog"
        aria-label={t('composerReasoning')}
        style={reasoningPopoverStyle}
        className="ds-composer-reasoning-popover fixed z-[1001]"
      >
        <div className="ds-composer-reasoning-scale" aria-hidden="true">
          <span>{t('composerReasoningFaster')}</span>
          <span className={reasoningAtMaximum ? 'is-selected' : undefined}>
            {t('composerReasoningSmarter')}
          </span>
        </div>
        <div
          className={
            `ds-composer-reasoning-rail${canChangeModel ? '' : ' is-disabled'}` +
            `${reasoningAtMaximum ? ' is-maximum' : ''}`
          }
          role="slider"
          tabIndex={canChangeModel ? 0 : -1}
          aria-label={t('composerReasoning')}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, reasoningRailEfforts.length - 1)}
          aria-valuenow={reasoningRailIndex}
          aria-valuetext={currentReasoningLabel}
          aria-disabled={!canChangeModel}
          onPointerDown={onReasoningRailPointerDown}
          onPointerMove={onReasoningRailPointerMove}
          onPointerUp={onReasoningRailPointerUp}
          onPointerCancel={onReasoningRailPointerUp}
          onKeyDown={onReasoningRailKeyDown}
        >
          <div className="ds-composer-reasoning-rail-inner">
            <div className="ds-composer-reasoning-rail-track" aria-hidden="true">
              <span
                className={`ds-composer-reasoning-rail-fill${reasoningHasEnergyMotion ? ' is-energized' : ''}`}
                style={{ width: reasoningThumbCenter }}
              >
                <i className="ds-composer-reasoning-streak is-upper" />
                <i className="ds-composer-reasoning-streak is-center" />
                <i className="ds-composer-reasoning-streak is-lower" />
              </span>
              <span className="ds-composer-reasoning-stops">
                {reasoningRailEfforts.map((effort, index) => (
                  <i
                    key={effort}
                    className={index <= reasoningRailIndex ? 'is-filled' : ''}
                    style={{ left: composerReasoningRailThumbCenter(
                      composerReasoningRailPosition(reasoningRailEfforts, effort)
                    ) }}
                  />
                ))}
              </span>
            </div>
            <span
              className={`ds-composer-reasoning-thumb${reasoningAtMaximum ? ' is-maximum' : ''}`}
              style={{ left: reasoningThumbCenter }}
              aria-hidden="true"
            >
              <i key={currentReasoning} className="ds-composer-reasoning-thumb-pulse" />
            </span>
          </div>
        </div>
      </div>
    )
    if (typeof document === 'undefined') return popover
    return createPortal(popover, document.body)
  }

  const renderMenu = (className: string): ReactElement | null =>
    renderComposerModelMenu({
      className, menuOpen, canOpenModelControls, menuRef, menuStyle, controlVariant,
      reasoningEnabled, needsProviderSetup, reasoningRowRef, reasoningPanelOpen,
      setActiveProviderId, setReasoningPanelOpen, t, currentReasoningLabel,
      providerMenuGroups, onConfigureProviders, setMenuOpen, selectedProviderId,
      currentModel, providerRowRefs, activeProviderId, submenuRef, submenuStyle,
      reasoningOptions, currentReasoning, onComposerReasoningEffortChange,
      activeProviderGroup, modelFilter, setModelFilter, activeProviderModelIds,
      onComposerModelChange, setReasoningPopoverOpen
    })

  if (controlVariant === 'split') {
    return (
      <div
        ref={(node) => {
          pickerRef.current = node
        }}
        className={`ds-composer-model-picker ds-no-drag inline-flex h-9 min-w-0 shrink-0 items-center gap-2 text-ds-muted ${splitModelWidthClass}`}
      >
        <button
          ref={modelTriggerRef}
          type="button"
          disabled={!canOpenModelControls}
          onClick={() => {
            setReasoningPopoverOpen(false)
            setMenuOpen((open) => !open)
          }}
          className={`inline-flex h-9 min-w-0 max-w-full items-center gap-1 rounded-lg px-1.5 text-[13.5px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed ${
            canOpenModelControls ? 'hover:text-ds-ink' : 'text-ds-faint'
          }`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`${t('composerModel')}: ${[selectedProviderGroup?.label, modelLabel].filter(Boolean).join(' / ')}`}
          title={splitModelLabel}
        >
          {selectedProviderIcon}
          <span className="min-w-0 truncate">{splitModelLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
        </button>

        {reasoningEnabled ? (
          <button
            ref={reasoningTriggerRef}
            type="button"
            disabled={!canChangeModel}
            onClick={() => {
              setMenuOpen(false)
              setActiveProviderId(null)
              setReasoningPanelOpen(false)
              setReasoningPopoverOpen((open) => !open)
            }}
            className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-1.5 text-[13.5px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed ${
              canChangeModel ? 'text-ds-muted hover:text-ds-ink' : 'text-ds-faint'
            }`}
            aria-expanded={reasoningPopoverOpen}
            aria-haspopup="dialog"
            aria-label={`${t('composerReasoning')}: ${currentReasoningLabel}`}
            title={`${t('composerReasoning')}: ${currentReasoningLabel}`}
          >
            <span>{t('composerReasoning')} · </span>
            <span className="text-accent">{currentReasoningLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
          </button>
        ) : null}

        {fastModeAvailable ? (
          <button
            type="button"
            disabled={!canChangeModel}
            onClick={() => onComposerFastModeChange?.(!composerFastMode)}
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg outline-none transition focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed ${
              composerFastMode
                ? 'bg-amber-400/15 text-amber-600 hover:bg-amber-400/25 dark:text-amber-300'
                : canChangeModel
                  ? 'text-ds-faint hover:bg-ds-hover hover:text-ds-ink'
                  : 'text-ds-faint'
            }`}
            aria-pressed={composerFastMode}
            aria-label={composerFastMode ? t('composerFastModeOn') : t('composerFastModeOff')}
            title={`${composerFastMode ? t('composerFastModeOn') : t('composerFastModeOff')} — ${t('composerFastModeHint')}`}
          >
            <Zap
              className={`h-4 w-4 ${composerFastMode ? 'fill-current' : ''}`}
              strokeWidth={2}
            />
          </button>
        ) : null}

        {renderMenu('fixed z-[1000] overflow-x-hidden overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[13px] text-ds-muted shadow-[0_22px_64px_rgba(20,47,95,0.18)] dark:bg-ds-card')}
        {renderSplitReasoningPopover()}
      </div>
    )
  }

  if (mode === 'combobox') {
    return (
      <div
        ref={(node) => {
          pickerRef.current = node
        }}
        className={`ds-composer-model-picker ds-no-drag relative flex h-9 items-center rounded-full transition ${comboboxWidthClass} ${
          canOpenModelControls ? 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink' : 'text-ds-faint'
        }`}
        title={controlsTitle}
      >
        <span className="sr-only">{t('composerModel')}</span>
        <button
          type="button"
          disabled={!canOpenModelControls}
          onClick={() => setMenuOpen((open) => !open)}
          title={controlsTitle}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`${t('composerModelControls')}: ${controlsTitle}`}
          className={`flex h-9 min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden rounded-full py-2 pl-3 pr-1 text-[13px] font-medium outline-none transition ${
            canOpenModelControls
              ? 'text-current focus-visible:ring-2 focus-visible:ring-accent/25'
              : 'cursor-not-allowed text-ds-faint'
          }`}
        >
          {selectedProviderIcon}
          <span className="min-w-0 truncate text-right">
            {modelLabel}
          </span>
          {reasoningEnabled ? (
            <span className="max-w-[72px] shrink-0 truncate text-[12px] font-semibold text-ds-faint" title={currentReasoningLabel}>
              {currentReasoningLabel}
            </span>
          ) : null}
          <span className="mr-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ds-faint">
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
          </span>
        </button>
        {renderMenu('fixed z-[1000] overflow-x-hidden overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[12.5px] shadow-[0_18px_50px_rgba(20,47,95,0.16)] dark:bg-ds-card')}
      </div>
    )
  }

  return (
    <div
      className={`ds-composer-model-picker ds-no-drag relative h-9 min-w-0 shrink-0 items-center overflow-hidden rounded-full transition ${
        canOpenModelControls ? 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink' : 'text-ds-faint'
      } ${
        compact ? 'max-w-[220px]' : 'max-w-[min(260px,42vw)]'
      }`}
      ref={(node) => {
        pickerRef.current = node
      }}
    >
      <button
        type="button"
        disabled={!canOpenModelControls}
        onClick={() => setMenuOpen((open) => !open)}
        className={`flex h-9 max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-full px-2.5 text-[13.5px] font-semibold transition disabled:cursor-not-allowed ${
          canOpenModelControls ? 'hover:bg-ds-hover' : ''
        }`}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={`${t('composerModelControls')}: ${controlsTitle}`}
        title={controlsTitle}
      >
        {selectedProviderIcon}
        <span className="min-w-0 truncate">{modelLabel}</span>
        {reasoningEnabled ? (
          <span className="max-w-[72px] shrink-0 truncate text-ds-faint" title={t(reasoningLabelKey(currentReasoning))}>
            {t(reasoningLabelKey(currentReasoning))}
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
      </button>

      {menuOpen && canOpenModelControls ? (
        renderMenu('fixed z-[1000] overflow-x-hidden overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[13px] text-ds-muted shadow-[0_22px_64px_rgba(20,47,95,0.18)] dark:bg-ds-card')
      ) : null}
    </div>
  )
}
