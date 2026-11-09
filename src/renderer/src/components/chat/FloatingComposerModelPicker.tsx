import { publishPetModel } from '../../pets/pet-presence-client'
import { AgentModelCatalogFooter } from '../ade/AgentModelCatalogFooter'
import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { ComposerPickerPortalContext } from './composer-picker-portal-context'
import { createPortal } from 'react-dom'
import { AlertCircle, ChevronDown, Cpu, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { composerFastModeState, type ComposerFastModeState } from './composer-fast-mode'
import { ComposerModelPanel } from './floating-composer-model-panel'
import {
  buildComposerModelMenuGroups, buildComposerModelOptions, calculateFloatingMenuPlacement,
  currentBodyZoom, fullModelLabel, modelIdsMatch, normalizeComposerReasoningEffortValue,
  reasoningLabelKey, resolveComposerReasoningSelection, shouldShowProviderSetupPrompt,
  type ComposerModelMenuGroup,
  type ComposerReasoningEffort,
  type FloatingMenuPlacement
} from './floating-composer-model-picker-logic'
import { ComposerModelSourceIcon } from './ComposerModelSourceIcon'
import { providerModelSections, providerSectionModelName } from './composer-provider-model-sections'

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

/** The model and reasoning panel; wide enough for five reasoning segments. */
export const COMPOSER_MODEL_PANEL_WIDTH = 340
export const COMPOSER_MODEL_PANEL_MAX_HEIGHT = 520

type Props = {
  agentHarnessId?: string
  compact: boolean
  /** `combobox` right-aligns the control when it stretches across a narrow toolbar. */
  mode: 'select' | 'combobox'
  composerModel: string
  composerProviderId?: string
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  /**
   * Why the menu has no models. Native Agents distinguish a failed live
   * lookup (`agent-failed`, with `emptyModelReason`) and a profile that is
   * still being checked (`agent-not-ready`) from a working Agent that simply
   * uses its own default model.
   */
  emptyModelState?: 'loading' | 'agent-default' | 'unavailable' | 'agent-failed' | 'agent-not-ready'
  /** Categorical failure code for `agent-failed` (agentUpdate.catalogError.*). */
  emptyModelReason?: string
  canChangeModel: boolean
  /** Transport capability limit, independent of upstream model metadata. */
  allowedReasoningEfforts?: readonly ComposerReasoningEffort[]
  stretch?: boolean
  composerReasoningEffort?: string
  /** Task cards keep model and depth together without changing composer behavior. */
  reasoningScope?: 'task'
  onOpenChange?: (open: boolean) => void
  composerFastMode?: boolean
  showProviderInModelLabel?: boolean
  onComposerModelChange: (modelId: string, providerId?: string) => void
  onComposerReasoningEffortChange?: (effort: ComposerReasoningEffort) => void
  onComposerFastModeChange?: (enabled: boolean) => void
  onConfigureProviders?: () => void
  /** Extra panel footer for Kun routes; external Agents show their catalog footer instead. */
  renderFooter?: (close: () => void) => ReactNode
  /** Panel notice under the model list, kept alongside the footer. */
  renderNotice?: (close: () => void) => ReactNode
}

/**
 * One composer control for the model, reasoning effort and Fast mode. The
 * trigger reads "model · effort"; the panel sets effort on top and lists the
 * models grouped by provider underneath.
 */
export function FloatingComposerModelPicker({
  agentHarnessId,
  compact,
  mode,
  composerModel,
  composerProviderId = '',
  composerPickList,
  composerModelGroups = [],
  emptyModelState,
  emptyModelReason,
  canChangeModel,
  allowedReasoningEfforts,
  stretch = false,
  composerReasoningEffort: configuredReasoningEffort,
  reasoningScope,
  onOpenChange,
  composerFastMode = false,
  showProviderInModelLabel = false,
  onComposerModelChange,
  onComposerReasoningEffortChange,
  onComposerFastModeChange,
  onConfigureProviders,
  renderFooter,
  renderNotice
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const taskScoped = reasoningScope === 'task'
  const composerReasoningEffort = configuredReasoningEffort ?? (taskScoped ? undefined : 'max')
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange
  const portalContainer = useContext(ComposerPickerPortalContext)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<FloatingMenuPlacement | null>(null)
  const modelOptions = useMemo(() => buildComposerModelOptions(composerPickList), [composerPickList])
  const providerMenuGroups = useMemo<ComposerModelMenuGroup[]>(() => buildComposerModelMenuGroups({
    composerModelGroups,
    modelOptions,
    ungroupedLabel: t('composerOtherModels')
  }), [composerModelGroups, modelOptions, t])
  const currentModel = composerModel.trim()
  const selectedProviderId = providerMenuGroups.find((group) =>
    group.providerId === composerProviderId.trim() &&
    group.modelIds.some((id) => modelIdsMatch(id, currentModel))
  )?.providerId ?? providerMenuGroups.find((group) =>
    group.modelIds.some((id) => modelIdsMatch(id, currentModel))
  )?.providerId ?? null
  const selectedProviderGroup = providerMenuGroups.find((group) => group.providerId === selectedProviderId) ?? null
  const emptyModelMessage = emptyModelState && providerMenuGroups.length === 0
    ? emptyModelState === 'agent-failed'
      ? t('agentUpdate.composerFailedHint', { reason: t(`agentUpdate.catalogError.${emptyModelReason ?? 'unavailable'}`, {
        defaultValue: t('agentUpdate.catalogError.unavailable') }) })
      : t(emptyModelState === 'loading' ? 'composerModelsLoading'
        : emptyModelState === 'agent-not-ready' ? 'agentUpdate.composerNotReadyHint'
          : emptyModelState === 'unavailable' ? 'composerModelsUnavailableHint' : 'composerAgentDefaultModelHint') : undefined
  const needsProviderSetup = !emptyModelMessage && shouldShowProviderSetupPrompt(providerMenuGroups)
  const petModel = needsProviderSetup ? '' : currentModel
  const previousPetModel = useRef({ model: petModel, provider: composerProviderId })
  useEffect(() => {
    const previous = previousPetModel.current
    previousPetModel.current = { model: petModel, provider: composerProviderId }
    if (taskScoped || !petModel || (previous.model === petModel && previous.provider === composerProviderId)) return
    const group = composerModelGroups.find((entry) => entry.providerId === composerProviderId)
    publishPetModel(petModel, group?.presetSource || group?.nativeHarnessId || composerProviderId, Boolean(previous.model))
  }, [petModel, composerProviderId, composerModelGroups, taskScoped])
  const reasoningSelection = resolveComposerReasoningSelection({ groups: providerMenuGroups, model: currentModel,
    providerId: selectedProviderId, effort: composerReasoningEffort, allowedEfforts: allowedReasoningEfforts,
    requireReportedLevels: taskScoped })
  const reasoningOptions = reasoningSelection.options
  const reasoningEnabled =
    !needsProviderSetup && !emptyModelMessage && Boolean(onComposerReasoningEffortChange) && reasoningOptions.length > 0
  const fastModeState: ComposerFastModeState = onComposerFastModeChange
    ? composerFastModeState(composerModelGroups, currentModel, composerProviderId)
    : 'hidden'
  const fastModeEnabled = fastModeState === 'supported' && composerFastMode
  const currentReasoning = reasoningSelection.current
  const currentReasoningLabel = taskScoped && composerReasoningEffort === undefined
    ? t('dispatchIntent.reasoningDefault') : t(reasoningLabelKey(currentReasoning))
  const reasoningUnavailable = taskScoped && !needsProviderSetup && !emptyModelMessage && reasoningSelection.availability !== 'supported'
    ? reasoningSelection.availability : undefined
  const reasoningTriggerLabel = reasoningUnavailable === 'unsupported' ? t('dispatchIntent.reasoningUnavailable')
    : reasoningUnavailable === 'unknown' ? t('dispatchIntent.reasoningDefault') : currentReasoningLabel
  const canOpen = canChangeModel || (needsProviderSetup && Boolean(onConfigureProviders))
  const modelLabel = emptyModelMessage
    ? emptyModelState === 'loading' ? t('composerModelsLoading')
      : emptyModelState === 'unavailable' ? t('composerModelsUnavailable')
      : emptyModelState === 'agent-failed' && (!currentModel || currentModel === 'default') ? t('composerModelsUnavailable')
      : currentModel && currentModel !== 'default' ? fullModelLabel(currentModel, t('autoLabel')) : t('composerAgentDefaultModel')
    : needsProviderSetup
    ? t('composerNoProvidersShort')
    : selectedProviderGroup?.modelInfo?.[currentModel]?.displayName ?? fullModelLabel(composerModel, t('autoLabel'))
  // A provider-qualified catalog ("OpenCode Zen/Big Pickle") shows the model's
  // own name on the pill; the full name stays in the title.
  const shortModelLabel = !emptyModelMessage && !needsProviderSetup && selectedProviderGroup &&
    providerModelSections(selectedProviderGroup, selectedProviderGroup.modelIds)
    ? providerSectionModelName(selectedProviderGroup, currentModel) : modelLabel
  // The provider is its own span so a narrow composer can drop it and keep the model.
  const providerLabel = showProviderInModelLabel ? selectedProviderGroup?.label ?? '' : ''
  const controlsTitle = [
    selectedProviderGroup?.label,
    modelLabel,
    reasoningEnabled || reasoningUnavailable ? `${t('composerReasoning')} ${reasoningTriggerLabel}` : '',
    fastModeEnabled ? t('composerFastModeOn') : ''
  ].filter(Boolean).join(' / ')
  // The trigger is a content-sized pill: stretch only lets it shrink in a
  // cramped toolbar, it never grows, so it stays next to the right-side actions.
  const widthClass = stretch
    ? 'min-w-0 shrink max-w-[min(300px,48vw)]'
    : taskScoped ? 'min-w-0 shrink-0 max-w-[min(300px,60vw)]'
      : compact ? 'min-w-0 shrink-0 max-w-[232px]' : 'min-w-0 shrink-0 max-w-[min(300px,46vw)]'

  useEffect(() => {
    if (!reasoningEnabled || (taskScoped && composerReasoningEffort === undefined)) return
    const rawReasoning = normalizeComposerReasoningEffortValue(composerReasoningEffort)
    if (rawReasoning !== currentReasoning) {
      onComposerReasoningEffortChange?.(currentReasoning)
    }
  }, [composerReasoningEffort, currentReasoning, onComposerReasoningEffortChange, reasoningEnabled, taskScoped])

  useEffect(() => { onOpenChangeRef.current?.(open) }, [open])
  useEffect(() => () => { onOpenChangeRef.current?.(false) }, [])

  useEffect(() => {
    if (!canOpen) setOpen(false)
  }, [canOpen])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (pickerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      // Move focus before the panel unmounts so it never falls back to the body.
      triggerRef.current?.focus()
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }
    const updatePlacement = (): void => {
      const trigger = triggerRef.current
      if (!trigger) return
      setPlacement(calculateFloatingMenuPlacement({
        anchorRect: trigger.getBoundingClientRect(),
        menuHeight: panelRef.current?.scrollHeight ?? 0,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        preferredWidth: taskScoped ? 388 : COMPOSER_MODEL_PANEL_WIDTH,
        maximumHeight: COMPOSER_MODEL_PANEL_MAX_HEIGHT,
        coordinateScale: currentBodyZoom()
      }))
    }
    updatePlacement()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePlacement)
    if (panelRef.current) resize?.observe(panelRef.current)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      resize?.disconnect()
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [open, taskScoped])

  useEffect(() => {
    if (!open || !portalContainer) return
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>(
      'input[type="search"], [aria-checked="true"], button:not(:disabled)')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open, portalContainer])

  const panelStyle: CSSProperties = placement
    ? { left: `${placement.left}px`, top: `${placement.top}px`, width: `${placement.width}px`, maxHeight: `${placement.maxHeight}px` }
    : { left: 0, top: 0, width: `${taskScoped ? 388 : COMPOSER_MODEL_PANEL_WIDTH}px`, maxHeight: `${COMPOSER_MODEL_PANEL_MAX_HEIGHT}px`, visibility: 'hidden' }

  const renderPanel = (): ReactElement | null => {
    if (!open || !canOpen) return null
    const customFooter = agentHarnessId && agentHarnessId !== 'kun'
      ? <AgentModelCatalogFooter harnessId={agentHarnessId} selectedModel={composerModel} />
      : renderFooter?.(() => { triggerRef.current?.focus(); setOpen(false) })
    const panel = (
      <ComposerModelPanel
        t={t}
        panelRef={panelRef}
        style={panelStyle}
        locked={!canChangeModel}
        reasoningEnabled={reasoningEnabled}
        reasoningScope={reasoningScope}
        reasoningUnavailable={reasoningUnavailable}
        reasoningInherited={taskScoped && composerReasoningEffort === undefined}
        reasoningOptions={reasoningOptions}
        currentReasoning={currentReasoning}
        onReasoningChange={onComposerReasoningEffortChange}
        fastModeState={fastModeState}
        fastModeEnabled={fastModeEnabled}
        onFastModeToggle={() => onComposerFastModeChange?.(!fastModeEnabled)}
        groups={providerMenuGroups}
        selectedProviderId={selectedProviderId}
        currentModel={currentModel}
        emptyModelMessage={emptyModelMessage}
        needsProviderSetup={needsProviderSetup}
        onConfigureProviders={onConfigureProviders}
        onPickModel={(modelId, providerId) => {
          onComposerModelChange(modelId, providerId)
          if (!taskScoped) {
            if (portalContainer) triggerRef.current?.focus()
            setOpen(false)
          }
        }}
        onClose={() => { triggerRef.current?.focus(); setOpen(false) }}
        notice={renderNotice?.(() => setOpen(false))}
        footer={taskScoped ? <>{customFooter}<div className="flex items-center justify-between gap-3 px-4 py-2 text-[11.5px] text-ds-muted" data-dispatch-model-footer>
          <span>{t('dispatchIntent.reasoningScope')}</span>
          <button type="button" onClick={() => { triggerRef.current?.focus(); setOpen(false) }}
            className="rounded-md bg-ds-hover px-3 py-1 text-[12px] font-medium text-ds-ink hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            {t('dispatchIntent.reasoningDone')}
          </button>
        </div></> : customFooter}
      />
    )
    if (typeof document === 'undefined') return panel
    return createPortal(panel, portalContainer ?? document.body)
  }

  return (
    <div
      ref={pickerRef}
      data-pet-model={taskScoped || needsProviderSetup ? undefined : currentModel}
      data-pet-provider={needsProviderSetup ? undefined : selectedProviderGroup?.presetSource || composerModelGroups.find((group) => group.providerId === selectedProviderId)?.nativeHarnessId || composerProviderId}
      className={`ds-composer-model-picker ds-no-drag relative flex h-9 items-center ${widthClass} ${
        mode === 'combobox' && stretch ? 'justify-end' : ''
      }`}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={!canOpen}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' || open) return
          event.preventDefault()
          setOpen(true)
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${t('composerModelControls')}: ${controlsTitle}`}
        title={controlsTitle}
        data-composer-model-trigger
        data-reasoning-effort={reasoningEnabled ? currentReasoning : undefined}
        className={`ds-composer-model-trigger${open ? ' is-open' : ''}${needsProviderSetup ? ' is-setup' : ''}`}
      >
        {needsProviderSetup ? (
          <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        ) : selectedProviderGroup ? (
          <ComposerModelSourceIcon
            presetId={selectedProviderGroup.presetSource}
            providerId={selectedProviderGroup.providerId}
            agentId={selectedProviderGroup.agentIconId}
            size={16}
            className="ds-composer-model-trigger-source h-4 w-4 shrink-0 text-ds-faint"
          />
        ) : (
          <Cpu className="ds-composer-model-trigger-glyph h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        )}
        {providerLabel ? (
          <span className="ds-composer-model-trigger-provider">{providerLabel}<span aria-hidden="true"> · </span></span>
        ) : null}
        <span className="ds-composer-model-trigger-model">{shortModelLabel}</span>
        {reasoningEnabled || reasoningUnavailable ? (
          <>
            <span className="ds-composer-model-trigger-dot" aria-hidden="true" />
            <span className={`ds-composer-model-trigger-effort${currentReasoning === 'max' ? ' is-maximum' : ''}`}>
              {reasoningTriggerLabel}
            </span>
          </>
        ) : null}
        {fastModeEnabled ? (
          <Zap className="ds-composer-model-trigger-fast h-3.5 w-3.5 shrink-0 fill-current" strokeWidth={2} aria-hidden="true" />
        ) : null}
        <ChevronDown className="ds-composer-model-trigger-chevron h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
      </button>
      {renderPanel()}
    </div>
  )
}
