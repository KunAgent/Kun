import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Code2, History, Loader2, Palette, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { AgentIcon } from '../agent-icon'
import { bodyZoom } from '../../lib/body-zoom'
import { harnessConnectionPresentation } from '../../lib/harness-connection-presentation'
import { harnessRowUnavailableDetail, harnessRowAvailable } from '../../store/harness-store'
import {
  calculateTaskSurfaceMenuPlacement,
  type ComposerTaskSurface,
  type TaskSurfaceMenuPlacement
} from './FloatingComposerTaskSurfacePicker'

export type ComposerAgentModeControls = {
  contextKey?: string
  harnessId: string
  harnessLabel: string
  rows: AdeHarnessRow[]
  loading: boolean
  needsConfirm: (harnessId: string) => boolean
  onSelect: (harnessId: string, surface: ComposerTaskSurface) => void
  onOpen: () => void
  onManage: (harnessId?: string, configureProvider?: boolean) => void
  onContinueLocalSession?: () => void
}

type Selection = { harnessId: string; label: string; surface: ComposerTaskSurface }
const MENU_WIDTH = 288

/** Agent identity and Kun's next-turn surface share the original Code/Design entry. */
export function FloatingComposerAgentModePicker({
  controls, surface, disabled = false
}: {
  controls: ComposerAgentModeControls
  surface: ComposerTaskSurface
  disabled?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<Selection | null>(null)
  const [placement, setPlacement] = useState<TaskSurfaceMenuPlacement>({
    left: 0, top: 0, width: MENU_WIDTH, placement: 'top'
  })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<'first' | 'last' | 'selected' | null>(null)
  const menuId = useId()
  const kunRow = controls.rows.find((row) => row.definition.id === 'kun')
  const externalRows = controls.rows.filter((row) => row.definition.id !== 'kun' && harnessRowAvailable(row))
  const kun = controls.harnessId === 'kun'
  const surfaceLabel = t(surface === 'design' ? 'taskTypeDesign' : 'taskTypeCode')
  const triggerLabel = kun ? `Kun · ${surfaceLabel}` : controls.harnessLabel

  const close = useCallback((): void => {
    setOpen(false)
    setPending(null)
    pendingFocus.current = null
  }, [])
  const updatePosition = useCallback((): void => {
    const anchorRect = triggerRef.current?.getBoundingClientRect()
    if (!anchorRect) return
    const zoom = bodyZoom()
    setPlacement(calculateTaskSurfaceMenuPlacement({
      anchorRect,
      menuWidth: Math.min(MENU_WIDTH, window.innerWidth / zoom - 24),
      menuHeight: menuRef.current?.offsetHeight || 360,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      coordinateScale: zoom
    }))
  }, [])
  const menuButtons = (): HTMLButtonElement[] => Array.from(
    menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
  )
  const selectionAvailable = (selection: Selection): boolean => {
    const row = controls.rows.find((entry) => entry.definition.id === selection.harnessId)
    return row ? harnessConnectionPresentation(row).code === null : selection.harnessId === 'kun'
  }

  useEffect(() => { close() }, [close, controls.contextKey, controls.harnessId, disabled])
  useEffect(() => {
    if (!open) return
    updatePosition()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition)
    if (menuRef.current) resize?.observe(menuRef.current)
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return
      close()
    }
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
      triggerRef.current?.focus()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onEscape)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      resize?.disconnect()
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onEscape)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [close, open, updatePosition])
  useEffect(() => {
    if (!open) return
    updatePosition()
    const buttons = menuButtons()
    if (pending) buttons[0]?.focus()
    else if (pendingFocus.current) {
      const focus = pendingFocus.current === 'last' ? buttons.at(-1)
        : pendingFocus.current === 'selected'
          ? buttons.find((button) => button.getAttribute('aria-checked') === 'true') ?? buttons[0]
          : buttons[0]
      focus?.focus()
    }
    pendingFocus.current = null
  }, [open, pending, updatePosition])

  const openAndFocus = (target: 'first' | 'last' | 'selected'): void => {
    if (disabled) return
    if (open) {
      const buttons = menuButtons()
      const selected = target === 'last' ? buttons.at(-1)
        : target === 'selected' ? buttons.find((button) => button.getAttribute('aria-checked') === 'true') ?? buttons[0]
          : buttons[0]
      selected?.focus()
      return
    }
    pendingFocus.current = target
    setOpen(true)
    controls.onOpen()
  }
  const select = (selection: Selection): void => {
    if (disabled || !selectionAvailable(selection)) return
    if (selection.harnessId !== controls.harnessId && controls.needsConfirm(selection.harnessId)) {
      setPending(selection)
      return
    }
    controls.onSelect(selection.harnessId, selection.surface)
    close()
    triggerRef.current?.focus()
  }
  const manage = (id?: string, provider?: boolean): void => {
    close()
    controls.onManage(id, provider)
  }
  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Tab') { close(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = menuButtons()
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }
  const kunUnavailable = kunRow ? harnessConnectionPresentation(kunRow).code : null
  const kunModes: ComposerTaskSurface[] = ['code', 'design']
  const menu = open && !disabled ? (
    <div ref={menuRef} id={menuId} role="menu" aria-label={t('composerAgentMode.title')}
      data-agent-mode-menu data-task-surface-menu data-placement={placement.placement}
      onKeyDown={handleMenuKeyDown}
      style={{ left: placement.left, top: placement.top, width: placement.width, maxHeight: `calc(100vh - 24px)` }}
      className="ds-composer-task-surface-menu ds-no-drag fixed z-50 overflow-y-auto rounded-xl border border-ds-border-muted bg-white p-1.5 text-[13px] text-ds-ink shadow-[0_18px_52px_rgba(15,23,42,0.18)] dark:bg-ds-card">
      {pending ? (
        <div className="px-2.5 py-2" data-agent-mode-confirm data-harness-switch-confirm>
          <p className="break-words text-[12px] text-ds-ink">{t('adeHarnessPicker.switchConfirmTitle', { name: pending.label })}</p>
          <p className="mt-1 text-[11px] leading-4 text-ds-muted">{t('adeHarnessPicker.switchConfirmBody')}</p>
          {!selectionAvailable(pending) ? <p role="status" className="mt-2 text-[11px] text-ds-muted">{t('adeHarnessUnavailable.unavailable')}</p> : null}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" role="menuitem" onClick={() => {
              pendingFocus.current = 'selected'
              setPending(null)
            }} data-agent-mode-confirm-cancel className="rounded-lg px-2.5 py-1 text-[12px] text-ds-muted hover:bg-ds-hover">{t('cancel')}</button>
            <button type="button" role="menuitem" disabled={!selectionAvailable(pending)} onClick={() => {
              if (disabled || !selectionAvailable(pending)) return
              controls.onSelect(pending.harnessId, pending.surface)
              close()
              triggerRef.current?.focus()
            }} data-agent-mode-confirm-yes data-harness-switch-confirm-yes
              className="rounded-lg bg-accent px-2.5 py-1 text-[12px] text-white disabled:cursor-not-allowed disabled:opacity-55">{t('adeHarnessPicker.switchConfirmYes')}</button>
          </div>
        </div>
      ) : (
        <>
          <div role="group" aria-label="Kun" data-agent-mode-group="kun">
            <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] font-semibold text-ds-faint">
              <AgentIcon harnessId="kun" size={16} /><span>Kun</span>
            </div>
            {kunModes.map((mode) => {
              const label = t(mode === 'code' ? 'taskTypeCode' : 'taskTypeDesign')
              const selected = kun && surface === mode
              const Icon = mode === 'code' ? Code2 : Palette
              return (
                <button key={mode} type="button" role="menuitemradio" aria-checked={selected} tabIndex={-1}
                  disabled={Boolean(kunUnavailable)} data-agent-mode-option={`kun-${mode}`} data-harness-id="kun"
                  data-task-surface-option={mode} data-task-surface={mode}
                  onClick={() => select({ harnessId: 'kun', surface: mode, label: `Kun · ${label}` })}
                  className={`flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-55 ${selected ? 'bg-accent/10' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'}`}>
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                  {selected ? <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden /> : null}
                </button>
              )
            })}
          </div>
          <div role="group" aria-label={t('composerAgentMode.externalAgents')} data-agent-mode-group="external" className="mt-1 border-t border-ds-border-muted pt-1">
            <div className="flex items-center justify-between px-2.5 py-2 text-[11px] font-semibold text-ds-faint">
              <span>{t('composerAgentMode.externalAgents')}</span>
              {controls.loading ? <Loader2 className="h-3 w-3 animate-spin" aria-label={t('adeHarnessUnavailable.detecting')} /> : null}
            </div>
            {externalRows.map((row) => {
              const id = row.definition.id
              const { code, labelKey, nextStepKey, configureProvider } = harnessConnectionPresentation(row)
              const reason = [labelKey ? t(labelKey) : '', nextStepKey ? t(nextStepKey) : ''].filter(Boolean).join(' · ')
              const selected = id === controls.harnessId
              return (
                <div key={id} className={`flex items-center gap-1 rounded-lg ${selected ? 'bg-accent/10' : ''}`}>
                  <button type="button" role="menuitemradio" aria-checked={selected} tabIndex={-1} disabled={Boolean(code)}
                    data-agent-mode-option={id} data-harness-id={id}
                    title={[reason || row.definition.displayName, harnessRowUnavailableDetail(row)].filter(Boolean).join(' · ')}
                    onClick={() => select({ harnessId: id, surface: 'code', label: row.definition.displayName })}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition hover:bg-ds-hover focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-55">
                    <AgentIcon harnessId={id} size={16} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{row.definition.displayName}</span>
                      {reason ? <span className="block text-[11px] leading-4 text-ds-faint">{reason}</span> : null}
                    </span>
                    {selected ? <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden /> : null}
                    {code === 'detecting' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ds-faint" aria-hidden /> : null}
                  </button>
                  {(code && code !== 'detecting') || configureProvider ? (
                    <button type="button" role="menuitem" tabIndex={-1} data-agent-mode-repair={id} data-harness-repair={id}
                      onClick={() => manage(id, configureProvider)}
                      aria-label={configureProvider ? t('adeAgentAction.configureProvider') : t('composerAgentMode.configureAgent', { name: row.definition.displayName })}
                      className="mr-1 shrink-0 rounded-md p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30">
                      <Settings2 className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
          <div className="mt-1 border-t border-ds-border-muted pt-1">
            {controls.onContinueLocalSession ? (
              <button type="button" role="menuitem" tabIndex={-1} data-continue-local-session onClick={() => { close(); controls.onContinueLocalSession?.() }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-ds-muted hover:bg-ds-hover">
                <History className="h-3.5 w-3.5" aria-hidden />{t('adeHarnessPicker.continueLocalSession')}
              </button>
            ) : null}
            <button type="button" role="menuitem" tabIndex={-1} data-agent-mode-manage data-harness-manage onClick={() => manage()}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-ds-muted hover:bg-ds-hover">
              <Settings2 className="h-3.5 w-3.5" aria-hidden />{t('adeHarnessOpenSettings')}
            </button>
          </div>
          <p className="px-2.5 pb-1 pt-2 text-[11px] leading-4 text-ds-faint">{t('adeHarnessPicker.nextTurnHint')}</p>
        </>
      )}
    </div>
  ) : null
  return (
    <>
      <div className="ds-composer-task-surface-control ds-no-drag shrink-0">
        <button ref={triggerRef} type="button" disabled={disabled} aria-haspopup="menu" aria-controls={menuId}
          aria-expanded={open} aria-label={`${t('composerAgentMode.title')}: ${triggerLabel}`} title={triggerLabel}
          data-agent-mode-trigger data-task-surface-trigger data-task-surface={kun ? surface : 'code'} data-composer-agent={controls.harnessId}
          onClick={() => open ? close() : openAndFocus('selected')}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            event.preventDefault()
            openAndFocus(event.key === 'ArrowDown' ? 'first' : 'last')
          }}
          className="inline-flex h-8 max-w-[180px] items-center gap-1.5 rounded-full border border-ds-border-muted bg-ds-card px-2.5 text-[13px] font-medium text-ds-ink transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-55">
          <AgentIcon harnessId={controls.harnessId} size={14} className="shrink-0" />
          <span className="ds-composer-task-surface-label min-w-0 truncate">{triggerLabel}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ds-faint transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : null}
    </>
  )
}
