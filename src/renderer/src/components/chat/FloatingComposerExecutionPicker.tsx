import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import {
  Bot,
  Check,
  ChevronDown,
  Hand,
  LockKeyholeOpen
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  KunToolPermissionMode,
  SandboxMode
} from '@shared/app-settings'
import {
  kunToolPermissionModeFromSettings,
  kunToolPermissionModeSettings
} from '@shared/app-settings'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'

export type ComposerExecutionSettings = {
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  approvalReviewer: ApprovalReviewer
}

type Props = {
  value: ComposerExecutionSettings
  applying?: boolean
  disabled?: boolean
  onChange: (patch: Partial<ComposerExecutionSettings>) => void
  onOpenPermissionSettings?: () => void
}

type ApprovalOption = {
  value: KunToolPermissionMode
  labelKey: string
  descriptionKey: string
  Icon: typeof Hand
}

type ExecutionMenuAnchorRect = Pick<DOMRect, 'bottom' | 'left' | 'top' | 'width'>

type ExecutionMenuPlacement = {
  left: number
  top: number
  width: number
}

const EXECUTION_MENU_MARGIN = 12
const EXECUTION_MENU_GAP = 8
const EXECUTION_MENU_WIDTH = 344
const EXECUTION_MENU_ESTIMATED_HEIGHT = 252

const APPROVAL_OPTIONS: ApprovalOption[] = [
  {
    value: 'ask-for-approval',
    labelKey: 'toolPermissionAskForApprovalShort',
    descriptionKey: 'toolPermissionAskForApprovalDesc',
    Icon: Hand
  },
  {
    value: 'approve-for-me',
    labelKey: 'toolPermissionApproveForMeShort',
    descriptionKey: 'toolPermissionApproveForMeDesc',
    Icon: Bot
  },
  {
    value: 'full-access',
    labelKey: 'toolPermissionFullAccessShort',
    descriptionKey: 'toolPermissionFullAccessDesc',
    Icon: LockKeyholeOpen
  }
]

function permissionOption(mode: KunToolPermissionMode): ApprovalOption {
  return APPROVAL_OPTIONS.find((option) => option.value === mode) ?? APPROVAL_OPTIONS[0]
}

function permissionLabelKey(mode: KunToolPermissionMode): string {
  return permissionOption(mode).labelKey
}

function permissionDescriptionKey(mode: KunToolPermissionMode): string {
  return permissionOption(mode).descriptionKey
}

export function FloatingComposerExecutionPicker({
  value,
  applying = false,
  disabled = false,
  onChange,
  onOpenPermissionSettings
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [openMenu, setOpenMenu] = useState<'approval' | 'sandbox' | null>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement | null>(null)
  const approvalButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const permissionMode = kunToolPermissionModeFromSettings(value)
  const currentPermissionOption = permissionOption(permissionMode)
  const fullAccess = permissionMode === 'full-access'
  const PermissionIcon = currentPermissionOption.Icon
  const title = `${t('composerPermissionShort')}: ${t(permissionLabelKey(permissionMode))}. ${t(permissionDescriptionKey(permissionMode))}`

  const updateMenuPosition = useCallback((menu: 'approval' | 'sandbox' = openMenu ?? 'approval'): void => {
    const button = approvalButtonRef.current
    const rect = button?.getBoundingClientRect()
    if (!rect) return
    const menuWidth = executionMenuWidth(menu)
    const estimatedMenuHeight = executionMenuEstimatedHeight(menu)
    const menuHeight = menuRef.current?.offsetHeight ?? estimatedMenuHeight
    setMenuStyle(calculateExecutionMenuPlacement({
      anchorRect: rect,
      menuWidth,
      menuHeight,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      coordinateScale: currentBodyZoom()
    }))
  }, [openMenu])

  useEffect(() => {
    if (!openMenu) return
    updateMenuPosition(openMenu)
    const frame = window.requestAnimationFrame(() => updateMenuPosition(openMenu))
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      if (target instanceof Node && menuRef.current?.contains(target)) return
      setOpenMenu(null)
    }
    const onUpdatePosition = (): void => updateMenuPosition(openMenu)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onUpdatePosition)
    window.addEventListener('scroll', onUpdatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onUpdatePosition)
      window.removeEventListener('scroll', onUpdatePosition, true)
    }
  }, [openMenu, updateMenuPosition])

  const update = (patch: Partial<ComposerExecutionSettings>): void => {
    onChange(patch)
    setOpenMenu(null)
  }

  const toggleMenu = (menu: 'approval' | 'sandbox'): void => {
    updateMenuPosition(menu)
    setOpenMenu((current) => (current === menu ? null : menu))
  }

  const menu =
    openMenu && typeof document !== 'undefined' ? (
      <div
        ref={menuRef}
        role="menu"
        aria-label={t('composerPermissionMenuTitle')}
        style={menuStyle}
        className="ds-composer-permission-menu fixed z-50 max-w-[calc(100vw-24px)] overflow-hidden rounded-[18px] border border-ds-border-muted bg-white px-2 py-2 text-[13px] text-ds-ink shadow-[0_18px_48px_rgba(20,47,95,0.14)] dark:bg-ds-card"
      >
        <FloatingComposerPermissionMenuContent
          permissionMode={permissionMode}
          onSelect={(option, event) => applyTrustedComposerExecutionChange(
            event,
            kunToolPermissionModeSettings(option),
            update
          )}
          onOpenPermissionSettings={onOpenPermissionSettings
            ? () => {
                setOpenMenu(null)
                onOpenPermissionSettings()
              }
            : undefined}
        />
      </div>
    ) : null

  return (
    <>
      <div
        ref={rootRef}
        className="ds-composer-permission-control ds-no-drag relative inline-flex shrink-0 items-center gap-1"
        title={title}
      >
        <button
          ref={approvalButtonRef}
          type="button"
          data-permission-mode={permissionMode}
          disabled={disabled || applying}
          onClick={(event) => runTrustedUserActivation(
            event,
            () => toggleMenu('approval')
          )}
          className={`ds-composer-permission-button inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-55 ${
            fullAccess
              ? 'text-orange-600 hover:text-orange-700 focus-visible:outline-orange-500 dark:text-orange-300 dark:hover:text-orange-200 dark:focus-visible:outline-orange-300'
              : 'text-ds-muted hover:text-ds-ink focus-visible:outline-ds-accent'
          }`}
          title={`${t(permissionLabelKey(permissionMode))}. ${t(permissionDescriptionKey(permissionMode))}`}
          aria-expanded={openMenu === 'approval'}
          aria-haspopup="menu"
          aria-label={t('composerPermissionShort')}
        >
          <PermissionIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          {applying ? (
            <span className="ds-composer-permission-label max-w-[120px] truncate">
              {t('composerExecutionApplying')}
            </span>
          ) : (
            <span className="ds-composer-permission-label max-w-[112px] truncate">
              {t(permissionLabelKey(permissionMode))}
            </span>
          )}
          <ChevronDown
            className="ds-composer-permission-chevron h-3.5 w-3.5 shrink-0"
            strokeWidth={1.8}
          />
        </button>
      </div>
      {menu ? createPortal(menu, document.body) : null}
    </>
  )
}

export function applyTrustedComposerExecutionChange(
  event: { isTrusted: boolean },
  patch: Partial<ComposerExecutionSettings>,
  onChange: (patch: Partial<ComposerExecutionSettings>) => void
): boolean {
  return runTrustedUserActivation(event, () => onChange(patch))
}

export function FloatingComposerPermissionMenuContent({
  permissionMode,
  onSelect,
  onOpenPermissionSettings
}: {
  permissionMode: KunToolPermissionMode
  onSelect: (mode: KunToolPermissionMode, event: MouseEvent<HTMLButtonElement>) => void
  onOpenPermissionSettings?: () => void
}): ReactElement {
  const { t } = useTranslation('common')

  return (
    <>
      <div
        role="presentation"
        className="ds-composer-permission-menu-header flex items-center justify-between gap-4 px-2.5 pb-1.5 pt-1"
      >
        <span className="truncate text-[12.5px] font-medium text-ds-muted">
          {t('composerPermissionMenuTitle')}
        </span>
        {onOpenPermissionSettings ? (
          <button
            type="button"
            role="menuitem"
            onClick={onOpenPermissionSettings}
            className="shrink-0 rounded-md px-1 py-0.5 text-[12px] font-medium text-ds-muted underline decoration-ds-muted/45 underline-offset-4 transition-colors hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent/40"
          >
            {t('composerPermissionLearnMore')}
          </button>
        ) : null}
      </div>
      <div role="presentation" className="ds-composer-permission-options">
        {APPROVAL_OPTIONS.map((option) => (
          <ExecutionRow
            key={option.value}
            mode={option.value}
            selected={permissionMode === option.value}
            label={t(option.labelKey)}
            description={t(option.descriptionKey)}
            Icon={option.Icon}
            onClick={(event) => onSelect(option.value, event)}
          />
        ))}
      </div>
    </>
  )
}

function ExecutionRow({
  mode,
  selected,
  label,
  description,
  Icon,
  onClick
}: {
  mode: KunToolPermissionMode
  selected: boolean
  label: string
  description: string
  Icon: typeof Hand
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitemradio"
      data-permission-mode={mode}
      aria-checked={selected}
      onClick={onClick}
      className={`ds-composer-permission-option group flex min-h-[58px] w-full cursor-pointer items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-accent/35 ${
        selected
          ? 'text-orange-600 hover:bg-orange-50/45 dark:text-orange-300 dark:hover:bg-orange-950/20'
          : 'text-ds-ink hover:bg-ds-hover/60'
      }`}
    >
      <span
        className={`ds-composer-permission-option-icon mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center ${
          selected ? 'text-orange-600 dark:text-orange-300' : 'text-ds-muted'
        }`}
      >
        <Icon className="h-[19px] w-[19px]" strokeWidth={1.8} />
      </span>
      <span className="ds-composer-permission-option-copy min-w-0 flex-1">
        <span className="ds-composer-permission-option-label block truncate text-[13.5px] font-semibold leading-5">
          {label}
        </span>
        <span
          className={`ds-composer-permission-option-description mt-0.5 block text-[12px] leading-[1.45] ${
            selected
              ? 'text-orange-600/80 dark:text-orange-300/80'
              : 'text-ds-muted'
          }`}
        >
          {description}
        </span>
      </span>
      {selected ? (
        <Check
          className="ds-composer-permission-option-check mt-1 h-4 w-4 shrink-0 text-orange-600 dark:text-orange-300"
          strokeWidth={2.2}
        />
      ) : null}
    </button>
  )
}

export function calculateExecutionMenuPlacement({
  anchorRect,
  menuWidth,
  menuHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: ExecutionMenuAnchorRect
  menuWidth: number
  menuHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): ExecutionMenuPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedAnchorRect = {
    bottom: anchorRect.bottom / scale,
    left: anchorRect.left / scale,
    top: anchorRect.top / scale,
    width: anchorRect.width / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const anchorLeft = normalizedAnchorRect.left + (normalizedAnchorRect.width / 2) - (menuWidth / 2)
  const topAbove = normalizedAnchorRect.top - menuHeight - EXECUTION_MENU_GAP
  const top = topAbove >= EXECUTION_MENU_MARGIN
    ? topAbove
    : normalizedAnchorRect.bottom + EXECUTION_MENU_GAP

  return {
    top: executionMenuClamp(
      top,
      EXECUTION_MENU_MARGIN,
      Math.max(EXECUTION_MENU_MARGIN, normalizedViewportHeight - menuHeight - EXECUTION_MENU_MARGIN)
    ),
    left: executionMenuClamp(
      anchorLeft,
      EXECUTION_MENU_MARGIN,
      Math.max(EXECUTION_MENU_MARGIN, normalizedViewportWidth - menuWidth - EXECUTION_MENU_MARGIN)
    ),
    width: menuWidth
  }
}

export function executionMenuWidth(menu: 'approval' | 'sandbox'): number {
  return EXECUTION_MENU_WIDTH
}

export function executionMenuEstimatedHeight(menu: 'approval' | 'sandbox'): number {
  return EXECUTION_MENU_ESTIMATED_HEIGHT
}

function currentBodyZoom(): number {
  if (typeof window === 'undefined') return 1
  const zoom = window.getComputedStyle(document.body).zoom
  const parsed = Number.parseFloat(zoom)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function executionMenuClamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
