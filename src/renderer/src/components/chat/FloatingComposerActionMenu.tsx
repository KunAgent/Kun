import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  CircleSlash,
  FileText,
  Folder,
  ImagePlus,
  ListTodo,
  Loader2,
  Paperclip,
  Settings2,
  Share2,
  Target,
  UserRound
} from 'lucide-react'
import { LucideIconByName } from '../lucide-icon-by-name'
import { currentComposerBodyZoom } from './floating-composer-popover-placement'
import type { FloatingComposerRenderContext } from './floating-composer-view-context'

const ACTION_MENU_WIDTH = 224
const ACTION_MENU_MAX_HEIGHT = 440
const ACTION_MENU_ESTIMATED_HEIGHT = 320
const ACTION_MENU_MARGIN = 12
const ACTION_MENU_GAP = 8
const PERSONA_MENU_ESTIMATED_HEIGHT = 240
const PERSONA_MENU_MAX_HEIGHT = 360

export type ComposerActionMenuPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function calculateActionMenuPlacement({
  buttonRect,
  shellRect,
  menuHeight,
  viewportWidth,
  preferredWidth = ACTION_MENU_WIDTH,
  maximumHeight = ACTION_MENU_MAX_HEIGHT,
  margin = ACTION_MENU_MARGIN,
  gap = ACTION_MENU_GAP,
  coordinateScale = 1
}: {
  buttonRect: Pick<DOMRect, 'left' | 'right'>
  shellRect: Pick<DOMRect, 'top'>
  menuHeight: number
  viewportHeight?: number
  viewportWidth: number
  preferredWidth?: number
  maximumHeight?: number
  margin?: number
  gap?: number
  coordinateScale?: number
}): ComposerActionMenuPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const viewportWidthNormalized = viewportWidth / scale
  const button = {
    left: buttonRect.left / scale,
    right: buttonRect.right / scale
  }
  const anchorTop = shellRect.top / scale
  const width = Math.min(preferredWidth, Math.max(1, viewportWidthNormalized - margin * 2))
  const left = clamp(
    button.left,
    margin,
    Math.max(margin, viewportWidthNormalized - margin - width)
  )
  const availableHeight = Math.max(0, anchorTop - margin - gap)
  const maxHeight = Math.min(maximumHeight, availableHeight)
  const visibleHeight = Math.min(Math.max(0, menuHeight), maxHeight)
  const top = anchorTop - gap - visibleHeight

  return { left, top, width, maxHeight }
}

export function calculatePersonaMenuPlacement({
  triggerRect,
  parentMenuRect,
  shellRect,
  menuHeight,
  viewportWidth,
  preferredWidth = ACTION_MENU_WIDTH,
  maximumHeight = PERSONA_MENU_MAX_HEIGHT,
  margin = ACTION_MENU_MARGIN,
  gap = ACTION_MENU_GAP,
  coordinateScale = 1
}: {
  triggerRect: Pick<DOMRect, 'top'>
  parentMenuRect: Pick<DOMRect, 'left' | 'right'>
  shellRect: Pick<DOMRect, 'top'>
  menuHeight: number
  viewportWidth: number
  preferredWidth?: number
  maximumHeight?: number
  margin?: number
  gap?: number
  coordinateScale?: number
}): ComposerActionMenuPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const viewportWidthNormalized = viewportWidth / scale
  const parentMenu = {
    left: parentMenuRect.left / scale,
    right: parentMenuRect.right / scale
  }
  const width = Math.min(preferredWidth, Math.max(1, viewportWidthNormalized - margin * 2))
  const rightSideLeft = parentMenu.right + gap
  const leftSideLeft = parentMenu.left - gap - width
  const left = rightSideLeft + width <= viewportWidthNormalized - margin
    ? rightSideLeft
    : leftSideLeft >= margin
      ? leftSideLeft
      : clamp(parentMenu.left, margin, Math.max(margin, viewportWidthNormalized - margin - width))
  const anchorTop = shellRect.top / scale
  const availableHeight = Math.max(0, anchorTop - margin - gap)
  const maxHeight = Math.min(maximumHeight, availableHeight)
  const visibleHeight = Math.min(Math.max(0, menuHeight), maxHeight)
  const latestTop = Math.max(margin, anchorTop - gap - visibleHeight)
  const top = clamp(triggerRect.top / scale, margin, latestTop)

  return { left, top, width, maxHeight }
}

const rowClass = 'ds-no-drag flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted'

export function FloatingComposerActionMenu({
  context
}: {
  context: FloatingComposerRenderContext
}): ReactElement | null {
  const {
    attachmentUploadBusy, attachmentUploadEnabled, canCompose, canOpenGoalPanel,
    canPickAttachment, canPickDesignReference, canPickFileReference, canPickLocalFileReference,
    canToggleAutoPlanBuildMode, canToggleGraphMode, canTogglePlanMode, codeAgentPresets, composerMenuButtonRef,
    composerMenuOpen, composerMenuPanelRef, composerPersonaId, composerShellRef,
    fileReferenceEnabled, graphEnabled, handleAttachmentMenuClick, handleDesignReferenceMenuClick,
    handleFileReferenceMenuClick, handleGoalMenuClick, handleGraphToolbarClick,
    handleLocalFileReferenceMenuClick, handleAutoPlanBuildToolbarClick, handlePlanToolbarClick, mode, onComposerPersonaChange,
    onPickAttachments, openSettings, orchestration, resolvedCodeAgentPresets,
    setComposerMenuOpen, showAutoPlanBuildMenuOption, showGoalMenuOption, showGraphMenuOption, showPlanMenuOption, t
  } = context
  const [personaOpen, setPersonaOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const [personaStyle, setPersonaStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const initialFocusAppliedRef = useRef(false)
  const mainMenuRef = useRef<HTMLDivElement | null>(null)
  const personaMenuRef = useRef<HTMLDivElement | null>(null)
  const personaTriggerRef = useRef<HTMLButtonElement | null>(null)

  const updatePosition = useCallback((): void => {
    const buttonRect = composerMenuButtonRef.current?.getBoundingClientRect()
    const composerRect = composerShellRef.current?.getBoundingClientRect()
    if (!buttonRect || !composerRect) return
    const placement = calculateActionMenuPlacement({
      buttonRect,
      shellRect: composerRect,
      menuHeight: mainMenuRef.current?.offsetHeight ?? ACTION_MENU_ESTIMATED_HEIGHT,
      viewportWidth: window.innerWidth,
      coordinateScale: currentComposerBodyZoom()
    })
    setStyle({
      ...placement,
      visibility: placement.maxHeight > 0 ? 'visible' : 'hidden'
    })
    if (!personaOpen) return
    const triggerRect = personaTriggerRef.current?.getBoundingClientRect()
    const parentMenuRect = mainMenuRef.current?.getBoundingClientRect()
    if (!triggerRect || !parentMenuRect) return
    const personaPlacement = calculatePersonaMenuPlacement({
      triggerRect,
      parentMenuRect,
      shellRect: composerRect,
      menuHeight: personaMenuRef.current?.offsetHeight ?? PERSONA_MENU_ESTIMATED_HEIGHT,
      viewportWidth: window.innerWidth,
      coordinateScale: currentComposerBodyZoom()
    })
    setPersonaStyle({
      ...personaPlacement,
      visibility: personaPlacement.maxHeight > 0 ? 'visible' : 'hidden'
    })
  }, [composerMenuButtonRef, composerShellRef, personaOpen])

  useEffect(() => {
    if (!canCompose) setPersonaOpen(false)
  }, [canCompose])

  const focusTrigger = useCallback((): void => {
    window.requestAnimationFrame(() => composerMenuButtonRef.current?.focus())
  }, [composerMenuButtonRef])

  const focusMenuItem = useCallback((action: 'first' | 'last' | 'next' | 'previous'): void => {
    const panel = composerMenuPanelRef.current as HTMLDivElement | null
    if (!panel) return
    const items = Array.from(panel.querySelectorAll(
      '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])'
    )) as HTMLElement[]
    if (items.length === 0) return
    const activeIndex = items.findIndex((item) => item === document.activeElement)
    const targetIndex = action === 'first'
      ? 0
      : action === 'last'
        ? items.length - 1
        : action === 'next'
          ? activeIndex < 0 ? 0 : (activeIndex + 1) % items.length
          : activeIndex < 0 ? items.length - 1 : (activeIndex - 1 + items.length) % items.length
    items[targetIndex]?.focus()
  }, [composerMenuPanelRef])

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setComposerMenuOpen(false)
      focusTrigger()
      return
    }
    const action = event.key === 'ArrowDown'
      ? 'next'
      : event.key === 'ArrowUp'
        ? 'previous'
        : event.key === 'Home'
          ? 'first'
          : event.key === 'End'
            ? 'last'
            : null
    if (!action) return
    event.preventDefault()
    focusMenuItem(action)
  }

  useEffect(() => {
    if (!composerMenuOpen) {
      initialFocusAppliedRef.current = false
      setPersonaOpen(false)
      return
    }
    updatePosition()
    const frame = window.requestAnimationFrame(() => {
      updatePosition()
      if (!initialFocusAppliedRef.current) {
        initialFocusAppliedRef.current = true
        focusMenuItem('first')
      }
    })
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [composerMenuOpen, focusMenuItem, personaOpen, updatePosition])

  if (!composerMenuOpen || typeof document === 'undefined') return null

  const activePersona = resolvedCodeAgentPresets.find(
    (preset: { id: string }) => preset.id === (composerPersonaId ?? '')
  )
  const personaAvailable = Boolean(codeAgentPresets && onComposerPersonaChange)
  const close = (restoreFocus = false): void => {
    setComposerMenuOpen(false)
    if (restoreFocus) focusTrigger()
  }
  const selectPersona = (presetId: string): void => {
    if (!canCompose) return
    onComposerPersonaChange?.(presetId)
    close(true)
  }

  const menu = (
    <div
      ref={mainMenuRef}
      id="floating-composer-action-menu"
      role="menu"
      aria-label={t('composerMenuTitle')}
      style={style}
      onKeyDown={handleMenuKeyDown}
      className="ds-composer-action-menu fixed z-50 box-border overflow-y-auto rounded-[18px] border border-ds-border bg-white py-1.5 text-[13px] text-ds-muted shadow-[0_18px_52px_rgba(15,23,42,0.18)] dark:bg-ds-card"
    >
      {fileReferenceEnabled ? (
        <>
          <button role="menuitem" tabIndex={-1} type="button" disabled={!canPickLocalFileReference} onClick={handleLocalFileReferenceMenuClick} className={rowClass}>
            <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate">{t('composerAddLocalFiles')}</span>
          </button>
          <button role="menuitem" tabIndex={-1} type="button" disabled={!canPickFileReference} onClick={handleFileReferenceMenuClick} className={rowClass}>
            <Paperclip className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate">{t('composerBrowseWorkspaceFiles')}</span>
          </button>
          <button role="menuitem" tabIndex={-1} type="button" disabled={!canPickDesignReference} onClick={handleDesignReferenceMenuClick} className={rowClass}>
            <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate">{t('composerBrowseDesignDocs')}</span>
          </button>
        </>
      ) : null}
      {attachmentUploadEnabled ? (
        <>
          {fileReferenceEnabled ? <div className="my-1 h-px bg-ds-border-muted/70" /> : null}
          <button role="menuitem" tabIndex={-1} type="button" disabled={!canPickAttachment || !onPickAttachments} onClick={handleAttachmentMenuClick} className={rowClass}>
            {attachmentUploadBusy
              ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.9} />
              : <ImagePlus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />}
            <span className="min-w-0 flex-1 truncate">{t('composerAddImage')}</span>
          </button>
        </>
      ) : null}
      {(fileReferenceEnabled || attachmentUploadEnabled) && (showPlanMenuOption || showAutoPlanBuildMenuOption || showGraphMenuOption || showGoalMenuOption || personaAvailable)
        ? <div className="my-1 h-px bg-ds-border-muted/70" />
        : null}
      {showPlanMenuOption ? (
        <button role="menuitem" tabIndex={-1} type="button" data-composer-plan-menu-item disabled={!canTogglePlanMode} onClick={handlePlanToolbarClick} className={rowClass}>
          <ListTodo className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          <span className="min-w-0 flex-1 truncate">{t('composerMenuPlanMode')}</span>
          <MenuSwitch checked={mode === 'plan'} />
        </button>
      ) : null}
      {showAutoPlanBuildMenuOption ? (
        <button role="menuitem" tabIndex={-1} type="button" data-composer-auto-plan-build-menu-item disabled={!canToggleAutoPlanBuildMode} onClick={handleAutoPlanBuildToolbarClick} className={rowClass}>
          <Bot className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          <span className="min-w-0 flex-1 truncate">{t('composerMenuAutoPlanBuild')}</span>
          <MenuSwitch checked={mode === 'auto'} />
        </button>
      ) : null}
      {showGraphMenuOption ? (
        <button
          role="menuitem"
          tabIndex={-1}
          type="button"
          data-composer-graph-menu-item
          disabled={!canToggleGraphMode}
          onClick={handleGraphToolbarClick}
          aria-label={context.busy
            ? t('graphModeNextTurnGraph', { defaultValue: 'Next turn: Graph' })
            : t('graphModeGraph', { defaultValue: 'Graph' })}
          title={context.busy
            ? t('graphModeNextTurnHint', {
                defaultValue: 'Controls the next turn and cannot change the turn already running'
              })
            : !graphEnabled
              ? t('graphModeDisabledHint', {
                  defaultValue: 'Enable experimental Graph Mode in Settings → Agents'
                })
              : t('graphModeGraphHint', {
                  defaultValue: 'Graph: plan, delegate, supervise, review, and synthesize'
                })}
          className={rowClass}
        >
          <Share2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          <span className="min-w-0 flex-1 truncate">
            {context.busy
              ? t('graphModeNextTurnGraph', { defaultValue: 'Next turn: Graph' })
              : t('graphModeGraph', { defaultValue: 'Graph' })}
          </span>
          <MenuSwitch checked={mode === 'agent' && orchestration === 'graph'} />
        </button>
      ) : null}
      {showGoalMenuOption ? (
        <button role="menuitem" tabIndex={-1} type="button" data-composer-goal-menu-item disabled={!canOpenGoalPanel} onClick={handleGoalMenuClick} className={rowClass}>
          <Target className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          <span className="min-w-0 flex-1 truncate">{t('composerMenuPursueGoal')}</span>
          <MenuSwitch checked={Boolean(context.goalMenuChecked)} />
        </button>
      ) : null}
      {personaAvailable ? (
        <>
          {(showPlanMenuOption || showAutoPlanBuildMenuOption || showGraphMenuOption || showGoalMenuOption) ? <div className="my-1 h-px bg-ds-border-muted/70" /> : null}
          <button
            ref={personaTriggerRef}
            role="menuitem"
            tabIndex={-1}
            type="button"
            data-composer-persona-menu-item
            disabled={!canCompose}
            aria-expanded={personaOpen}
            aria-haspopup="menu"
            aria-controls="floating-composer-persona-menu"
            onClick={() => {
              if (canCompose) setPersonaOpen((open) => !open)
            }}
            className={rowClass}
          >
            <UserRound className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span className="min-w-0 flex-1 truncate">{t('codeAgentPersonaLabel')}</span>
            <span className="max-w-24 truncate text-[12px] text-ds-faint">
              {activePersona?.name ?? t('codeAgentPersonaNone')}
            </span>
            {personaOpen
              ? <ChevronUp className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              : <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />}
          </button>
        </>
      ) : null}
    </div>
  )
  const personaMenu = personaAvailable && personaOpen ? (
    <div
      ref={personaMenuRef}
      id="floating-composer-persona-menu"
      role="menu"
      aria-label={t('codeAgentPersonaLabel')}
      style={personaStyle}
      data-composer-persona-panel
      onKeyDown={handleMenuKeyDown}
      className="ds-composer-persona-menu fixed z-50 box-border overflow-y-auto rounded-[18px] border border-ds-border bg-white py-1.5 text-[13px] text-ds-muted shadow-[0_18px_52px_rgba(15,23,42,0.18)] dark:bg-ds-card"
    >
      <PersonaOption disabled={!canCompose} selected={!composerPersonaId} icon="" label={t('codeAgentPersonaNone')} onClick={() => selectPersona('')} />
      {resolvedCodeAgentPresets.map((preset: { id: string; icon: string; name: string; persona: string }) => (
        <PersonaOption
          key={preset.id}
          selected={preset.id === composerPersonaId}
          disabled={!canCompose}
          icon={preset.icon}
          label={preset.name}
          description={preset.persona}
          onClick={() => selectPersona(preset.id === composerPersonaId ? '' : preset.id)}
        />
      ))}
      {resolvedCodeAgentPresets.length === 0 ? (
        <p className="px-3 py-1.5 text-[12px] text-ds-faint">{t('codeAgentPersonaEmptyHint')}</p>
      ) : null}
      <button
        role="menuitem"
        tabIndex={-1}
        type="button"
        onClick={() => {
          close(false)
          openSettings('laboratory')
        }}
        className={rowClass}
      >
        <Settings2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate">{t('codeAgentPersonaManage')}</span>
      </button>
    </div>
  ) : null
  const menus = (
    <div ref={composerMenuPanelRef} className="contents">
      {menu}
      {personaMenu}
    </div>
  )
  const portalHost = typeof Element !== 'undefined' && document.body instanceof Element
    ? document.body
    : null
  return portalHost ? createPortal(menus, portalHost) : menus
}

function MenuSwitch({ checked }: { checked: boolean }): ReactElement {
  return (
    <span role="switch" aria-checked={checked} className={`relative h-5 w-9 shrink-0 rounded-full ring-1 transition ${checked ? 'bg-accent ring-accent/35' : 'bg-ds-border-muted ring-ds-border-muted'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ring-1 ring-black/5 transition ${checked ? 'translate-x-[17px]' : 'translate-x-0.5'} shadow-[0_1px_4px_rgba(20,47,95,0.28)]`} />
    </span>
  )
}

function PersonaOption({
  selected,
  disabled = false,
  icon,
  label,
  description,
  onClick
}: {
  selected: boolean
  disabled?: boolean
  icon: string
  label: string
  description?: string
  onClick: () => void
}): ReactElement {
  return (
    <button role="menuitemradio" tabIndex={-1} aria-checked={selected} disabled={disabled} type="button" onClick={onClick} className={`${rowClass} rounded-lg`}>
      {icon
        ? <LucideIconByName name={icon} className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        : <CircleSlash className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />}
      <span className="min-w-0 flex-1 truncate text-ds-ink">{label}</span>
      {description ? <PersonaHelpTip text={description} /> : null}
      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.2} /> : null}
    </button>
  )
}

const HELP_TIP_WIDTH = 264
const HELP_TIP_GAP = 8
const HELP_TIP_MARGIN = 12

function PersonaHelpTip({ text }: { text: string }): ReactElement {
  const tooltipId = useId()
  const [tipStyle, setTipStyle] = useState<CSSProperties | null>(null)
  const anchorRef = useRef<HTMLSpanElement | null>(null)

  const show = (): void => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    const scale = currentComposerBodyZoom()
    const viewportWidth = window.innerWidth / scale
    const viewportHeight = window.innerHeight / scale
    const anchor = {
      left: rect.left / scale,
      right: rect.right / scale,
      top: rect.top / scale
    }
    const fitsRight = anchor.right + HELP_TIP_GAP + HELP_TIP_WIDTH <= viewportWidth - HELP_TIP_MARGIN
    const left = fitsRight
      ? anchor.right + HELP_TIP_GAP
      : Math.max(HELP_TIP_MARGIN, anchor.left - HELP_TIP_GAP - HELP_TIP_WIDTH)
    const top = Math.min(
      Math.max(HELP_TIP_MARGIN, anchor.top - 8),
      Math.max(HELP_TIP_MARGIN, viewportHeight - HELP_TIP_MARGIN - 120)
    )
    setTipStyle({ left, top, width: HELP_TIP_WIDTH })
  }

  const tip = tipStyle ? (
    <div
      id={tooltipId}
      role="tooltip"
      style={tipStyle}
      className="pointer-events-none fixed z-[60] rounded-xl border border-ds-border-muted bg-white px-3 py-2.5 text-[12px] leading-[1.5] text-ds-muted shadow-[0_12px_32px_rgba(20,47,95,0.16)] dark:bg-ds-card"
    >
      {text}
    </div>
  ) : null
  const portalHost = typeof Element !== 'undefined' && document.body instanceof Element
    ? document.body
    : null

  return (
    <>
      <span
        ref={anchorRef}
        aria-describedby={tipStyle ? tooltipId : undefined}
        onPointerEnter={show}
        onPointerLeave={() => setTipStyle(null)}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-ds-faint transition-colors hover:text-ds-ink"
      >
        <CircleHelp className="h-3.5 w-3.5" strokeWidth={1.8} />
      </span>
      {tip ? (portalHost ? createPortal(tip, portalHost) : tip) : null}
    </>
  )
}
