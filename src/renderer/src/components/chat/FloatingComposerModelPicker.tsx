import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Gauge,
  Image as ImageIcon,
  Search,
  Type as TypeIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  MODEL_REASONING_EFFORTS,
  isComposerChatModelId,
  modelProfileSupportsTextChat,
  modelSupportsImageInput,
  type ModelReasoningEffort,
  type ModelProviderModelProfileV1
} from '@shared/app-settings'
import { DEFAULT_COMPOSER_MODEL_IDS } from '@shared/default-composer-models'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'

export type ComposerReasoningEffort = ModelReasoningEffort

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
  onComposerModelChange: (modelId: string, providerId?: string) => void
  onComposerReasoningEffortChange?: (effort: ComposerReasoningEffort) => void
  onConfigureProviders?: () => void
}

const REASONING_OPTIONS: Array<{ id: ComposerReasoningEffort; labelKey: string }> = [
  { id: 'auto', labelKey: 'composerReasoningAuto' },
  { id: 'off', labelKey: 'composerReasoningOff' },
  { id: 'low', labelKey: 'composerReasoningLow' },
  { id: 'medium', labelKey: 'composerReasoningMedium' },
  { id: 'high', labelKey: 'composerReasoningHigh' },
  { id: 'max', labelKey: 'composerReasoningMax' }
]
const LEGACY_REASONING_EFFORTS: ComposerReasoningEffort[] = ['off', 'low', 'medium', 'high', 'max']

type FloatingMenuPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

type FloatingSubmenuPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

type FloatingReasoningPopoverPlacement = {
  left: number
  top: number
  width: number
}

type FloatingMenuAnchorRect = Pick<DOMRect, 'bottom' | 'right' | 'top'>
type FloatingSubmenuAnchorRect = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>
type FloatingReasoningPopoverAnchorRect = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>

type ComposerModelMenuGroup = {
  providerId: string
  label: string
  modelIds: string[]
  modelProfiles?: Record<string, ModelProviderModelProfileV1>
}

const FLOATING_MENU_MARGIN = 12
const FLOATING_MENU_GAP = 7
const FLOATING_MENU_WIDTH = 208
const FLOATING_MENU_MIN_WIDTH = 176
const FLOATING_MENU_MIN_HEIGHT = 112
const FLOATING_MENU_MAX_HEIGHT = 336
const FLOATING_SUBMENU_GAP = 6
const FLOATING_SUBMENU_WIDTH = 232
const FLOATING_SUBMENU_MIN_HEIGHT = 80
const FLOATING_SUBMENU_MAX_HEIGHT = 320
const FLOATING_REASONING_POPOVER_WIDTH = 286
const FLOATING_REASONING_POPOVER_ESTIMATED_HEIGHT = 110
const FLOATING_REASONING_POPOVER_GAP = 12
const REASONING_RAIL_THUMB_RADIUS = 18
const UNGROUPED_MODEL_PROVIDER_ID = '__composer_models__'
const REASONING_RAIL_ORDER: ComposerReasoningEffort[] = ['off', 'low', 'medium', 'high', 'max', 'auto']
const REASONING_PARTICLES = [
  { x: '6%', y: '61%', size: '5px', delay: '-2.1s', duration: '3.7s', driftX: '7px', driftY: '-7px' },
  { x: '11%', y: '29%', size: '3px', delay: '-0.4s', duration: '2.9s', driftX: '-5px', driftY: '6px' },
  { x: '17%', y: '67%', size: '2px', delay: '-1.6s', duration: '4.4s', driftX: '6px', driftY: '-5px' },
  { x: '23%', y: '37%', size: '4px', delay: '-3.1s', duration: '3.2s', driftX: '-7px', driftY: '-4px' },
  { x: '29%', y: '72%', size: '3px', delay: '-0.9s', duration: '4.1s', driftX: '5px', driftY: '-8px' },
  { x: '35%', y: '24%', size: '6px', delay: '-2.8s', duration: '3.8s', driftX: '-4px', driftY: '7px' },
  { x: '41%', y: '55%', size: '2px', delay: '-1.2s', duration: '2.7s', driftX: '8px', driftY: '-4px' },
  { x: '47%', y: '31%', size: '4px', delay: '-3.7s', duration: '4.6s', driftX: '-6px', driftY: '5px' },
  { x: '53%', y: '69%', size: '3px', delay: '-0.2s', duration: '3.4s', driftX: '5px', driftY: '-7px' },
  { x: '59%', y: '43%', size: '5px', delay: '-2.4s', duration: '4.2s', driftX: '-8px', driftY: '-5px' },
  { x: '65%', y: '24%', size: '2px', delay: '-1.4s', duration: '3.1s', driftX: '6px', driftY: '8px' },
  { x: '71%', y: '66%', size: '4px', delay: '-3.4s', duration: '3.9s', driftX: '-5px', driftY: '-7px' },
  { x: '77%', y: '36%', size: '3px', delay: '-0.7s', duration: '2.8s', driftX: '7px', driftY: '5px' },
  { x: '83%', y: '71%', size: '5px', delay: '-2.6s', duration: '4.5s', driftX: '-6px', driftY: '-8px' },
  { x: '89%', y: '27%', size: '3px', delay: '-1.8s', duration: '3.5s', driftX: '5px', driftY: '7px' },
  { x: '95%', y: '56%', size: '4px', delay: '-3.9s', duration: '4s', driftX: '-7px', driftY: '-5px' }
] as const
const DEFAULT_COMPOSER_MODEL_KEYS = new Set(
  DEFAULT_COMPOSER_MODEL_IDS.map((id) => normalizeModelCapabilityKey(id))
)

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
  onComposerModelChange,
  onComposerReasoningEffortChange,
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
  const selectedProviderGroup = providerMenuGroups.find((group) =>
    group.providerId === composerProviderId.trim() &&
    group.modelIds.some((id) => modelIdsMatch(id, currentModel))
  ) ?? null
  const selectedProviderId = selectedProviderGroup?.providerId ?? providerMenuGroups.find((group) =>
    group.modelIds.some((id) => modelIdsMatch(id, currentModel))
  )?.providerId ?? null
  const currentModelProfile = modelProfileForSelection(providerMenuGroups, currentModel, selectedProviderId)
  const needsProviderSetup = shouldShowProviderSetupPrompt(providerMenuGroups)
  const reasoningOptions = reasoningOptionsForModel(currentModelProfile)
  const reasoningEnabled =
    !needsProviderSetup && Boolean(onComposerReasoningEffortChange) && reasoningOptions.length > 0
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
  const reasoningParticleCount = reasoningHasEnergyMotion
    ? Math.round(REASONING_PARTICLES.length * reasoningRailPosition)
    : 0
  const reasoningThumbCenter = composerReasoningRailThumbCenter(reasoningRailPosition)
  const canOpenModelControls = canChangeModel || (needsProviderSetup && Boolean(onConfigureProviders))
  const modelLabel = needsProviderSetup
    ? t('composerNoProvidersShort')
    : fullModelLabel(composerModel, t('autoLabel'))
  const controlsTitle = reasoningEnabled
    ? `${modelLabel} / ${currentReasoningLabel}`
    : modelLabel
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
    ? 'max-w-[min(284px,45vw)]'
    : compact
      ? 'max-w-[184px]'
      : 'max-w-[min(260px,42vw)]'

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
    const particleCount = Math.max(0, Math.min(REASONING_PARTICLES.length, reasoningParticleCount))
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
          <span>{t('composerReasoningSmarter')}</span>
        </div>
        <div
          className={`ds-composer-reasoning-rail${canChangeModel ? '' : ' is-disabled'}`}
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
                {REASONING_PARTICLES.slice(0, particleCount).map((particle, index) => (
                  <i
                    key={index}
                    className="ds-composer-reasoning-particle"
                    style={{
                      left: particle.x,
                      top: particle.y,
                      width: particle.size,
                      height: particle.size,
                      animationDelay: particle.delay,
                      animationDuration: particle.duration,
                      '--ds-reasoning-particle-x': particle.driftX,
                      '--ds-reasoning-particle-y': particle.driftY
                    } as CSSProperties}
                  />
                ))}
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
              className="ds-composer-reasoning-thumb"
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

  const renderMenu = (className: string): ReactElement | null => {
    if (!menuOpen || !canOpenModelControls) return null
    const menu = (
      <>
        <div
          ref={menuRef}
          role="menu"
          style={menuStyle}
          className={className}
        >
          {controlVariant === 'combined' && reasoningEnabled && !needsProviderSetup ? (
            <>
              <SubmenuRow
                refNode={(node) => {
                  reasoningRowRef.current = node
                }}
                active={reasoningPanelOpen}
                selected={false}
                icon={<Brain className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />}
                title={t('composerReasoning')}
                subtitle={currentReasoningLabel}
                onClick={() => {
                  setActiveProviderId(null)
                  setReasoningPanelOpen((open) => !open)
                }}
                onMouseEnter={() => {
                  setActiveProviderId(null)
                  setReasoningPanelOpen(true)
                }}
              />
              <MenuSeparator />
            </>
          ) : null}

          <MenuSectionTitle icon={<Gauge className="h-3.5 w-3.5" strokeWidth={1.9} />}>
            {t('composerModel')}
          </MenuSectionTitle>
          <div className="pr-0.5">
            {needsProviderSetup ? (
              <div className="px-2.5 py-2">
                <p className="text-[12.5px] leading-5 text-ds-muted">
                  {t('composerNoProviders')}
                </p>
                {onConfigureProviders ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      onConfigureProviders()
                    }}
                    className="mt-2 flex w-full items-center justify-center rounded-lg border border-ds-border bg-ds-surface-subtle px-3 py-2 text-[12.5px] font-semibold text-ds-ink transition hover:bg-ds-hover"
                  >
                    {t('composerConfigureProviders')}
                  </button>
                ) : null}
              </div>
            ) : (
              providerMenuGroups.map((group) => {
                const selectedModel = composerModelMenuItemSelected({
                  groupProviderId: group.providerId,
                  selectedProviderId,
                  currentModel,
                  modelId: currentModel
                })
                  ? currentModel
                  : ''
                return (
                  <ProviderRow
                    key={group.providerId}
                    refNode={(node) => {
                      if (node) providerRowRefs.current.set(group.providerId, node)
                      else providerRowRefs.current.delete(group.providerId)
                    }}
                    active={activeProviderId === group.providerId}
                    selected={selectedProviderId === group.providerId}
                    title={group.label}
                    subtitle={selectedModel}
                    onClick={() => {
                      setReasoningPanelOpen(false)
                      setActiveProviderId(group.providerId)
                    }}
                    onMouseEnter={() => {
                      setReasoningPanelOpen(false)
                      setActiveProviderId(group.providerId)
                    }}
                  />
                )
              })
            )}
          </div>
        </div>
        {controlVariant === 'combined' && reasoningPanelOpen && reasoningEnabled ? (
          <div
            ref={submenuRef}
            role="menu"
            aria-label={t('composerReasoning')}
            style={submenuStyle}
            className="fixed z-[1001] overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[13px] text-ds-muted shadow-[0_18px_48px_rgba(20,47,95,0.16)] dark:bg-ds-card"
          >
            <div className="px-2.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ds-faint">
              {t('composerReasoning')}
            </div>
            <div className="flex flex-col gap-1">
              {reasoningOptions.map((option) => (
                <PickerRow
                  key={option.id}
                  selected={currentReasoning === option.id}
                  title={t(option.labelKey)}
                  onClick={() => {
                    onComposerReasoningEffortChange?.(option.id)
                    setMenuOpen(false)
                  }}
                />
              ))}
            </div>
          </div>
        ) : activeProviderGroup ? (
          <div
            ref={submenuRef}
            role="menu"
            aria-label={activeProviderGroup.label}
            style={submenuStyle}
            className="fixed z-[1001] overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[13px] text-ds-muted shadow-[0_18px_48px_rgba(20,47,95,0.16)] dark:bg-ds-card"
          >
            <div className="px-2.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ds-faint">
              {t('composerModel')}
            </div>
            <label className="mb-1.5 flex h-8 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-surface-subtle px-2 text-ds-faint">
              <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              <input
                type="search"
                value={modelFilter}
                onChange={(event) => setModelFilter(event.target.value)}
                placeholder={t('composerModelSearchPlaceholder')}
                className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] font-medium text-ds-ink outline-none placeholder:text-ds-faint"
              />
            </label>
            {activeProviderModelIds.length > 0 ? (
              activeProviderModelIds.map((id) => {
                const targetProfile = modelProfileForModel(activeProviderGroup, id)
                const selected = composerModelMenuItemSelected({
                  groupProviderId: activeProviderGroup.providerId,
                  selectedProviderId,
                  currentModel,
                  modelId: id
                })
                return (
                  <PickerRow
                    key={`${activeProviderGroup.providerId}:${id}`}
                    selected={selected}
                    title={id}
                    rightSlot={
                      modelSupportsImageInput(targetProfile)
                        ? <ModelCapabilityBadge kind="vision" label={t('composerModelVision')} />
                        : <ModelCapabilityBadge kind="text" label={t('composerModelTextOnly')} />
                    }
                    onClick={() => {
                      const nextReasoning = normalizeComposerReasoningEffort(
                        composerReasoningEffort,
                        targetProfile
                      )
                      onComposerModelChange(
                        id,
                        activeProviderGroup.providerId === UNGROUPED_MODEL_PROVIDER_ID
                          ? undefined
                          : activeProviderGroup.providerId
                      )
                      if (nextReasoning !== currentReasoning) {
                        onComposerReasoningEffortChange?.(nextReasoning)
                      }
                      setReasoningPopoverOpen(false)
                      setMenuOpen(false)
                    }}
                  />
                )
              })
            ) : (
              <div className="px-2.5 py-2 text-[12.5px] font-medium text-ds-faint">
                {t('composerNoMatchingModels')}
              </div>
            )}
          </div>
        ) : null}
      </>
    )

    if (typeof document === 'undefined') return menu
    return createPortal(menu, document.body)
  }

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
          aria-label={t('composerModel')}
          title={modelLabel}
        >
          <span className="min-w-0 truncate">{modelLabel}</span>
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
          aria-label={t('composerModelControls')}
          className={`flex h-9 min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden rounded-full py-2 pl-3 pr-1 text-[13px] font-medium outline-none transition ${
            canOpenModelControls
              ? 'text-current focus-visible:ring-2 focus-visible:ring-accent/25'
              : 'cursor-not-allowed text-ds-faint'
          }`}
        >
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
        aria-label={t('composerModelControls')}
        title={controlsTitle}
      >
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

export function buildComposerModelMenuGroups({
  composerModelGroups,
  modelOptions,
  ungroupedLabel
}: {
  composerModelGroups: readonly ModelProviderModelGroup[]
  modelOptions: readonly string[]
  ungroupedLabel: string
}): ComposerModelMenuGroup[] {
  const configuredModelKeys = new Set<string>()
  const groups = composerModelGroups
    .map((group) => {
      const seenInProvider = new Set<string>()
      const ids = group.modelIds
        .map((id) => id.trim())
        .filter((id) => {
          const key = normalizeModelCapabilityKey(id)
          if (!key || seenInProvider.has(key)) return false
          if (!composerMenuSupportsModel(group, id)) return false
          markModelSeen(seenInProvider, group, id)
          markModelSeen(configuredModelKeys, group, id)
          return true
        })
      return {
        ...group,
        label: group.label.trim() || group.providerId,
        modelIds: ids,
        modelProfiles: group.modelProfiles
      }
    })
    .filter((group) => group.modelIds.length > 0)

  const ungrouped: string[] = []
  const seenUngrouped = new Set<string>()
  for (const rawId of modelOptions) {
    const id = rawId.trim()
    const key = normalizeModelCapabilityKey(id)
    if (!key || configuredModelKeys.has(key) || seenUngrouped.has(key) || !isComposerChatModelId(id)) continue
    seenUngrouped.add(key)
    ungrouped.push(id)
  }

  if (ungrouped.length > 0) {
    groups.push({
      providerId: UNGROUPED_MODEL_PROVIDER_ID,
      label: ungroupedLabel,
      modelIds: ungrouped,
      modelProfiles: {}
    })
  }
  return groups
}

export function buildComposerModelOptions(composerPickList: readonly string[]): string[] {
  const ordered = new Set<string>()
  for (const id of composerPickList) {
    const normalized = id.trim()
    if (normalized) ordered.add(normalized)
  }
  return [...ordered]
}

export function filterComposerModelIds(
  modelIds: readonly string[],
  query: string
): string[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return [...modelIds]
  return modelIds.filter((id) => id.toLowerCase().includes(normalizedQuery))
}

function shouldShowProviderSetupPrompt(groups: readonly ComposerModelMenuGroup[]): boolean {
  const hasConfiguredProviderModels = groups.some((group) =>
    group.providerId !== UNGROUPED_MODEL_PROVIDER_ID
  )
  if (hasConfiguredProviderModels) return false
  const ungroupedModels = groups.flatMap((group) =>
    group.providerId === UNGROUPED_MODEL_PROVIDER_ID ? group.modelIds : []
  )
  return ungroupedModels.every((id) =>
    DEFAULT_COMPOSER_MODEL_KEYS.has(normalizeModelCapabilityKey(id))
  )
}

export function normalizeComposerReasoningEffort(
  value: string | undefined,
  profile?: Pick<ModelProviderModelProfileV1, 'reasoning'>
): ComposerReasoningEffort {
  const normalized = normalizeComposerReasoningEffortValue(value)
  if (!profile?.reasoning) {
    return normalized && LEGACY_REASONING_EFFORTS.includes(normalized) ? normalized : 'max'
  }
  const supported = profile.reasoning.supportedEfforts
  if (normalized && supported.includes(normalized)) return normalized
  return profile.reasoning.defaultEffort
}

function normalizeComposerReasoningEffortValue(
  value: string | undefined
): ComposerReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase()
  return MODEL_REASONING_EFFORTS.includes(normalized as ComposerReasoningEffort)
    ? normalized as ComposerReasoningEffort
    : undefined
}

export function composerReasoningEffortRequestValue(
  value: ComposerReasoningEffort
): string | undefined {
  return value
}

export function composerReasoningEffortHasEnergyMotion(
  effort: ComposerReasoningEffort
): boolean {
  return effort === 'high' || effort === 'max' || effort === 'auto'
}

export function orderComposerReasoningRailEfforts(
  efforts: readonly ComposerReasoningEffort[]
): ComposerReasoningEffort[] {
  const supported = new Set(efforts)
  return REASONING_RAIL_ORDER.filter((effort) => supported.has(effort))
}

export function composerReasoningRailPosition(
  efforts: readonly ComposerReasoningEffort[],
  current: ComposerReasoningEffort
): number {
  if (efforts.length === 0) return 0
  if (efforts.length === 1) return efforts[0] === 'auto' ? 1 : 0
  const index = Math.max(0, efforts.indexOf(current))
  return index / (efforts.length - 1)
}

export function composerReasoningEffortForRailPosition(
  efforts: readonly ComposerReasoningEffort[],
  position: number
): ComposerReasoningEffort | undefined {
  if (efforts.length === 0) return undefined
  const normalized = Math.min(1, Math.max(0, Number.isFinite(position) ? position : 0))
  const index = efforts.length === 1 ? 0 : Math.round(normalized * (efforts.length - 1))
  return efforts[index]
}

export function composerReasoningRailPointerPosition(
  clientX: number,
  railLeft: number,
  railWidth: number
): number {
  const usableWidth = railWidth - REASONING_RAIL_THUMB_RADIUS * 2
  if (!Number.isFinite(clientX) || !Number.isFinite(railLeft) || usableWidth <= 0) return 0
  return Math.min(1, Math.max(
    0,
    (clientX - railLeft - REASONING_RAIL_THUMB_RADIUS) / usableWidth
  ))
}

export function composerReasoningEffortForRailKey(
  efforts: readonly ComposerReasoningEffort[],
  current: ComposerReasoningEffort,
  key: string
): ComposerReasoningEffort | undefined {
  if (efforts.length === 0) return undefined
  const currentIndex = Math.max(0, efforts.indexOf(current))
  const lastIndex = efforts.length - 1
  if (key === 'ArrowLeft') return efforts[Math.max(0, currentIndex - 1)]
  if (key === 'ArrowRight') return efforts[Math.min(lastIndex, currentIndex + 1)]
  if (key === 'Home') return efforts[0]
  if (key === 'End') return efforts[lastIndex]
  return undefined
}

function composerReasoningRailThumbCenter(position: number): string {
  const normalized = Math.min(1, Math.max(0, Number.isFinite(position) ? position : 0))
  const pixelOffset = REASONING_RAIL_THUMB_RADIUS * (1 - normalized * 2)
  return `calc(${normalized * 100}% + ${pixelOffset}px)`
}

export function calculateFloatingMenuPlacement({
  anchorRect,
  menuHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: FloatingMenuAnchorRect
  menuHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): FloatingMenuPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedAnchorRect = {
    bottom: anchorRect.bottom / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const viewportMaxWidth = Math.max(
    FLOATING_MENU_MIN_WIDTH,
    normalizedViewportWidth - FLOATING_MENU_MARGIN * 2
  )
  const width = Math.min(FLOATING_MENU_WIDTH, viewportMaxWidth)
  const left = clamp(
    normalizedAnchorRect.right - width,
    FLOATING_MENU_MARGIN,
    normalizedViewportWidth - FLOATING_MENU_MARGIN - width
  )
  const contentHeight = Math.max(menuHeight, FLOATING_MENU_MIN_HEIGHT)
  const spaceAbove = Math.max(0, normalizedAnchorRect.top - FLOATING_MENU_MARGIN - FLOATING_MENU_GAP)
  const spaceBelow = Math.max(
    0,
    normalizedViewportHeight - normalizedAnchorRect.bottom - FLOATING_MENU_MARGIN - FLOATING_MENU_GAP
  )
  const targetHeight = Math.min(contentHeight, FLOATING_MENU_MAX_HEIGHT)
  const openAbove = spaceAbove >= targetHeight || spaceAbove >= spaceBelow
  const availableHeight = Math.max(openAbove ? spaceAbove : spaceBelow, FLOATING_MENU_MIN_HEIGHT)
  const maxHeight = Math.min(FLOATING_MENU_MAX_HEIGHT, availableHeight)
  const visibleHeight = Math.min(contentHeight, maxHeight)
  const preferredTop = openAbove
    ? normalizedAnchorRect.top - FLOATING_MENU_GAP - visibleHeight
    : normalizedAnchorRect.bottom + FLOATING_MENU_GAP
  const top = clamp(
    preferredTop,
    FLOATING_MENU_MARGIN,
    Math.max(FLOATING_MENU_MARGIN, normalizedViewportHeight - FLOATING_MENU_MARGIN - visibleHeight)
  )

  return { left, top, width, maxHeight }
}

export function calculateFloatingReasoningPopoverPlacement({
  anchorRect,
  popoverHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: FloatingReasoningPopoverAnchorRect
  popoverHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): FloatingReasoningPopoverPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedAnchorRect = {
    bottom: anchorRect.bottom / scale,
    left: anchorRect.left / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const width = Math.min(
    FLOATING_REASONING_POPOVER_WIDTH,
    Math.max(FLOATING_MENU_MIN_WIDTH, normalizedViewportWidth - FLOATING_MENU_MARGIN * 2)
  )
  const height = Math.max(0, popoverHeight)
  const spaceAbove = Math.max(
    0,
    normalizedAnchorRect.top - FLOATING_MENU_MARGIN - FLOATING_REASONING_POPOVER_GAP
  )
  const spaceBelow = Math.max(
    0,
    normalizedViewportHeight - normalizedAnchorRect.bottom - FLOATING_MENU_MARGIN - FLOATING_REASONING_POPOVER_GAP
  )
  const openAbove = spaceAbove >= height || spaceAbove >= spaceBelow
  const preferredTop = openAbove
    ? normalizedAnchorRect.top - FLOATING_REASONING_POPOVER_GAP - height
    : normalizedAnchorRect.bottom + FLOATING_REASONING_POPOVER_GAP
  const top = clamp(
    preferredTop,
    FLOATING_MENU_MARGIN,
    Math.max(FLOATING_MENU_MARGIN, normalizedViewportHeight - FLOATING_MENU_MARGIN - height)
  )
  const left = clamp(
    (normalizedAnchorRect.left + normalizedAnchorRect.right - width) / 2,
    FLOATING_MENU_MARGIN,
    normalizedViewportWidth - FLOATING_MENU_MARGIN - width
  )
  return { left, top, width }
}

export function calculateFloatingSubmenuPlacement({
  anchorRect,
  submenuHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: FloatingSubmenuAnchorRect
  submenuHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): FloatingSubmenuPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedAnchorRect = {
    bottom: anchorRect.bottom / scale,
    left: anchorRect.left / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const viewportMaxWidth = Math.max(
    FLOATING_MENU_MIN_WIDTH,
    normalizedViewportWidth - FLOATING_MENU_MARGIN * 2
  )
  const width = Math.min(FLOATING_SUBMENU_WIDTH, viewportMaxWidth)
  const spaceRight = normalizedViewportWidth - normalizedAnchorRect.right - FLOATING_MENU_MARGIN
  const spaceLeft = normalizedAnchorRect.left - FLOATING_MENU_MARGIN
  const openRight = spaceRight >= width + FLOATING_SUBMENU_GAP || spaceRight >= spaceLeft
  const preferredLeft = openRight
    ? normalizedAnchorRect.right + FLOATING_SUBMENU_GAP
    : normalizedAnchorRect.left - width - FLOATING_SUBMENU_GAP
  const left = clamp(
    preferredLeft,
    FLOATING_MENU_MARGIN,
    normalizedViewportWidth - FLOATING_MENU_MARGIN - width
  )
  const contentHeight = Math.max(submenuHeight, FLOATING_SUBMENU_MIN_HEIGHT)
  const maxHeight = Math.min(
    FLOATING_SUBMENU_MAX_HEIGHT,
    Math.max(FLOATING_SUBMENU_MIN_HEIGHT, normalizedViewportHeight - FLOATING_MENU_MARGIN * 2)
  )
  const visibleHeight = Math.min(contentHeight, maxHeight)
  const preferredTop = normalizedAnchorRect.top - 8
  const top = clamp(
    preferredTop,
    FLOATING_MENU_MARGIN,
    Math.max(FLOATING_MENU_MARGIN, normalizedViewportHeight - FLOATING_MENU_MARGIN - visibleHeight)
  )

  return { left, top, width, maxHeight }
}

function currentBodyZoom(): number {
  if (typeof window === 'undefined') return 1
  const zoom = window.getComputedStyle(document.body).zoom
  const parsed = Number.parseFloat(zoom)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function reasoningLabelKey(value: ComposerReasoningEffort): string {
  return REASONING_OPTIONS.find((option) => option.id === value)?.labelKey ?? 'composerReasoningMax'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function fullModelLabel(model: string, autoLabel: string): string {
  const trimmed = model.trim()
  if (!trimmed || trimmed.toLowerCase() === 'auto') return autoLabel
  return trimmed
}

function estimatedModelSubmenuHeight(modelCount: number): number {
  return 34 + Math.max(1, modelCount) * 36 + 12
}

function estimatedReasoningSubmenuHeight(optionCount: number): number {
  return 34 + Math.max(1, optionCount) * 36 + 12
}

function normalizeModelCapabilityKey(modelId: string): string {
  return modelId.trim().toLowerCase()
}

function modelIdsMatch(a: string, b: string): boolean {
  const left = normalizeModelCapabilityKey(a)
  return Boolean(left) && left === normalizeModelCapabilityKey(b)
}

export function composerModelMenuItemSelected(input: {
  groupProviderId: string
  selectedProviderId: string | null
  currentModel: string
  modelId: string
}): boolean {
  return (
    Boolean(input.selectedProviderId) &&
    input.groupProviderId === input.selectedProviderId &&
    modelIdsMatch(input.currentModel, input.modelId)
  )
}

function markModelSeen(
  seen: Set<string>,
  group: Pick<ComposerModelMenuGroup, 'modelProfiles'>,
  modelId: string
): void {
  for (const id of [modelId, ...(modelProfileForModel(group, modelId)?.aliases ?? [])]) {
    const key = normalizeModelCapabilityKey(id)
    if (key) seen.add(key)
  }
}

function modelProfileForModel(
  group: Pick<ComposerModelMenuGroup, 'modelProfiles'> | null | undefined,
  modelId: string
): ModelProviderModelProfileV1 | undefined {
  if (!group) return undefined
  const key = normalizeModelCapabilityKey(modelId)
  if (!key) return undefined
  const profiles = group.modelProfiles ?? {}
  const direct = profiles[key] ?? profiles[modelId.trim()]
  if (direct) return direct
  return Object.values(profiles).find((profile) =>
    profile.aliases?.some((alias) => normalizeModelCapabilityKey(alias) === key)
  )
}

function modelProfileForSelection(
  groups: readonly ComposerModelMenuGroup[],
  modelId: string,
  providerId?: string | null
): ModelProviderModelProfileV1 | undefined {
  const selectedGroup = providerId
    ? groups.find((group) => group.providerId === providerId)
    : null
  if (selectedGroup && selectedGroup.modelIds.some((id) => modelIdsMatch(id, modelId))) {
    const profile = modelProfileForModel(selectedGroup, modelId)
    if (profile) return profile
  }
  for (const group of groups) {
    if (!group.modelIds.some((id) => modelIdsMatch(id, modelId))) continue
    const profile = modelProfileForModel(group, modelId)
    if (profile) return profile
  }
  for (const group of groups) {
    const profile = modelProfileForModel(group, modelId)
    if (profile) return profile
  }
  return undefined
}

function reasoningOptionsForModel(
  profile: Pick<ModelProviderModelProfileV1, 'reasoning'> | undefined
): Array<{ id: ComposerReasoningEffort; labelKey: string }> {
  const supported = profile?.reasoning?.supportedEfforts ?? LEGACY_REASONING_EFFORTS
  return supported
    .map((effort) => REASONING_OPTIONS.find((option) => option.id === effort))
    .filter((option): option is { id: ComposerReasoningEffort; labelKey: string } => Boolean(option))
}

export function composerMenuSupportsModel(
  group: Pick<ComposerModelMenuGroup, 'modelProfiles'>,
  modelId: string
): boolean {
  if (!isComposerChatModelId(modelId)) return false
  return modelProfileSupportsTextChat(modelProfileForModel(group, modelId))
}

function MenuSectionTitle({
  children,
  icon
}: {
  children: string
  icon: ReactElement
}): ReactElement {
  return (
    <div className="flex h-8 items-center gap-2 px-2 text-[12px] font-bold uppercase tracking-[0.08em] text-ds-faint">
      {icon}
      <span>{children}</span>
    </div>
  )
}

function MenuSeparator(): ReactElement {
  return <div className="my-2 h-px bg-ds-border-muted" />
}

function PickerRow({
  selected,
  disabled = false,
  title,
  rightSlot,
  onClick
}: {
  selected: boolean
  disabled?: boolean
  title: string
  rightSlot?: ReactElement | null
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      title={title}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
        disabled
          ? 'cursor-not-allowed text-ds-faint opacity-55'
          : selected
          ? 'bg-ds-hover text-ds-ink'
          : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{title}</span>
      </span>
      {rightSlot}
      {selected ? <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} /> : null}
    </button>
  )
}

function ModelCapabilityBadge({
  kind,
  label
}: {
  kind: 'vision' | 'text'
  label: string
}): ReactElement {
  const tone = kind === 'vision'
    ? 'border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300'
    : 'border-ds-border bg-ds-hover text-ds-muted'
  const Icon = kind === 'vision' ? ImageIcon : TypeIcon
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10.5px] font-semibold leading-none ${tone}`}
      title={label}
    >
      <Icon className="h-3 w-3" strokeWidth={1.9} />
      <span>{label}</span>
    </span>
  )
}

function ProviderRow({
  active,
  selected,
  title,
  subtitle,
  refNode,
  onClick,
  onMouseEnter
}: {
  active: boolean
  selected: boolean
  title: string
  subtitle: string
  refNode: (node: HTMLButtonElement | null) => void
  onClick: () => void
  onMouseEnter: () => void
}): ReactElement {
  return (
    <SubmenuRow
      refNode={refNode}
      active={active}
      selected={selected}
      title={title}
      subtitle={subtitle}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    />
  )
}

function SubmenuRow({
  active,
  selected,
  icon,
  title,
  subtitle,
  refNode,
  onClick,
  onMouseEnter
}: {
  active: boolean
  selected: boolean
  icon?: ReactElement | null
  title: string
  subtitle: string
  refNode: (node: HTMLButtonElement | null) => void
  onClick: () => void
  onMouseEnter: () => void
}): ReactElement {
  return (
    <button
      ref={refNode}
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={active}
      title={subtitle ? `${title} / ${subtitle}` : title}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onMouseEnter}
      onFocus={onMouseEnter}
      onClick={onClick}
      className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
        active
          ? 'bg-ds-hover text-ds-ink'
          : selected
            ? 'text-ds-ink hover:bg-ds-hover'
            : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{title}</span>
        {subtitle ? (
          <span className="block truncate text-[11.5px] font-medium text-ds-faint">{subtitle}</span>
        ) : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
    </button>
  )
}
