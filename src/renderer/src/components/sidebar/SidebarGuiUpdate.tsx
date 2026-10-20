import type { ReactElement, RefObject } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpCircle,
  ExternalLink,
  Loader2,
  RotateCw,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '../../lib/format-bytes'
import { useGuiUpdateAction, type GuiUpdateAction, type GuiUpdatePhase } from './use-gui-update-action'
import './sidebar-gui-update.css'

/** The settings row keeps its left padding and 16px gear (the rest of its 20px icon box may clip). */
const SETTINGS_ICON_MIN_WIDTH = 31
/** A labeled chip is the label plus this much (gap and side padding) wider than the 28px icon-only one. */
const CHIP_LABEL_EXTRA_WIDTH = 6

const CHIP_LABEL_KEYS: Record<Exclude<GuiUpdatePhase, 'downloading'>, string> = {
  available: 'sidebarUpdateChip',
  downloaded: 'sidebarUpdateChipRestart',
  installing: 'sidebarUpdateChipInstalling',
  manual: 'sidebarUpdateChipManual',
  error: 'sidebarUpdateRetry'
}

/** Pulse once per version per app session, not on every remount of a footer. */
let pulsedVersion = ''

/**
 * Drops the chip label when the footer bar cannot fit it beside the settings
 * gear. The label stays in the DOM (visually hidden) so its width is known.
 */
function useChipLabelFits(chipRef: RefObject<HTMLButtonElement | null>, label: string): boolean {
  const [fits, setFits] = useState(true)
  useLayoutEffect(() => {
    const chip = chipRef.current
    const bar = chip?.parentElement
    const slot = bar?.querySelector<HTMLElement>(':scope > [data-footer-settings-slot]')
    if (!chip || !bar || !slot || typeof ResizeObserver !== 'function') return
    const measure = (): void => {
      const labelWidth = chip.querySelector<HTMLElement>('[data-update-chip-label]')?.offsetWidth ?? 0
      const compact = chip.dataset.compact === 'true'
      const extra = compact ? labelWidth + CHIP_LABEL_EXTRA_WIDTH : 0
      setFits(slot.clientWidth - SETTINGS_ICON_MIN_WIDTH - extra >= 0)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    observer.observe(slot)
    return () => observer.disconnect()
  }, [chipRef, label])
  return fits
}

function ProgressRing({ percent }: { percent: number }): ReactElement {
  const circumference = 2 * Math.PI * 5.5
  return (
    <svg className="ds-sidebar-update-ring" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" className="ds-sidebar-update-ring-track" />
      <circle
        cx="7"
        cy="7"
        r="5.5"
        className="ds-sidebar-update-ring-value"
        strokeDasharray={`${(percent / 100) * circumference} ${circumference}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}

function ChipIcon({ phase, percent }: { phase: GuiUpdatePhase; percent: number }): ReactElement {
  if (phase === 'downloading') return <ProgressRing percent={percent} />
  if (phase === 'installing') return <Loader2 className="ds-sidebar-update-chip-icon animate-spin" strokeWidth={2.2} aria-hidden="true" />
  if (phase === 'downloaded') return <RotateCw className="ds-sidebar-update-chip-icon" strokeWidth={2} aria-hidden="true" />
  if (phase === 'manual') return <ExternalLink className="ds-sidebar-update-chip-icon" strokeWidth={2.2} aria-hidden="true" />
  if (phase === 'error') return <AlertCircle className="ds-sidebar-update-chip-icon" strokeWidth={2} aria-hidden="true" />
  return <ArrowUpCircle className="ds-sidebar-update-chip-icon" strokeWidth={2} aria-hidden="true" />
}

function CardIcon({ phase }: { phase: GuiUpdatePhase }): ReactElement {
  if (phase === 'downloading') return <ArrowDownToLine className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden="true" />
  if (phase === 'installing') return <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
  if (phase === 'downloaded') return <RotateCw className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
  if (phase === 'manual') return <ExternalLink className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden="true" />
  if (phase === 'error') return <AlertCircle className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden="true" />
  return <ArrowUp className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden="true" />
}

function UpdateCard({ action, titleId, cardRef, onClose }: {
  action: GuiUpdateAction
  titleId: string
  cardRef: RefObject<HTMLDivElement | null>
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation(['common', 'settings'])
  const { info, phase, busy, progress, percent } = action
  const current = t('sidebarUpdateCurrent', { version: info.currentVersion })
  const channel = t(info.channel === 'frontier' ? 'settings:guiUpdateChannelFrontier' : 'settings:guiUpdateChannelStable')
  const title = {
    available: t('sidebarUpdateTitleAvailable', { version: info.latestVersion }),
    manual: t('sidebarUpdateTitleAvailable', { version: info.latestVersion }),
    downloading: t('sidebarUpdateTitleDownloading', { version: info.latestVersion }),
    downloaded: t('sidebarUpdateTitleDownloaded', { version: info.latestVersion }),
    installing: t('settings:guiUpdateInstalling'),
    error: t('sidebarUpdateTitleFailed')
  }[phase]
  const subtitle = phase === 'downloading'
    ? t('sidebarUpdateDownloadingHint')
    : phase === 'manual'
      ? `${current} · ${t('sidebarUpdateManualHint')}`
      : phase === 'error'
        ? `${info.currentVersion} → ${info.latestVersion}`
        : `${current} · ${channel}`
  const body = phase === 'available'
    ? t('sidebarUpdateBodyAvailable')
    : phase === 'downloaded'
      ? t('settings:guiUpdateDownloadedDesc')
      : phase === 'manual'
        ? t('sidebarUpdateBodyManual')
        : ''
  const primaryLabel = {
    available: t('sidebarUpdateDownloadAndRestart'),
    downloaded: t('sidebarUpdateRestartNow'),
    manual: t('settings:guiUpdateOpenRelease'),
    error: t('sidebarUpdateRetry')
  }[phase as 'available' | 'downloaded' | 'manual' | 'error'] as string | undefined
  const showNotes = (phase === 'available' || phase === 'error') && Boolean(info.releaseUrl)
  const secondaryLabel = phase === 'downloading'
    ? t('sidebarUpdateHide')
    : phase === 'downloaded'
      ? t('sidebarUpdateLater')
      : ''

  const runPrimary = (): void => {
    if (phase === 'manual') onClose()
    void action.apply()
  }

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-labelledby={titleId}
      className="ds-sidebar-update-card"
      data-phase={phase}
    >
      <div className="ds-sidebar-update-card-head">
        <span className="ds-sidebar-update-card-icon" aria-hidden="true"><CardIcon phase={phase} /></span>
        <div className="min-w-0 flex-1">
          <div id={titleId} className="ds-sidebar-update-card-title">{title}</div>
          <div className="ds-sidebar-update-card-subtitle">{subtitle}</div>
        </div>
        <button type="button" className="ds-sidebar-update-card-close" onClick={onClose} aria-label={t('close')}>
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      {phase === 'downloading' ? (
        <div className="ds-sidebar-update-progress">
          <div
            className="ds-sidebar-update-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={title}
          >
            <div className="ds-sidebar-update-progress-value" style={{ width: `${percent}%` }} />
          </div>
          <div className="ds-sidebar-update-progress-meta">
            <span>{progress ? `${formatBytes(progress.transferred)} / ${formatBytes(progress.total)}` : `${percent}%`}</span>
            {progress && progress.bytesPerSecond > 0 ? <span>{formatBytes(progress.bytesPerSecond)}/s</span> : null}
          </div>
        </div>
      ) : null}
      {phase === 'error' ? <div role="alert" className="ds-sidebar-update-card-error">{action.error}</div> : null}
      {body ? <p className="ds-sidebar-update-card-body">{body}</p> : null}

      {showNotes || secondaryLabel || primaryLabel ? (
        <div className="ds-sidebar-update-card-actions">
          {showNotes ? (
            <button type="button" className="ds-sidebar-update-button" onClick={action.openReleasePage}>
              {t('sidebarUpdateReleaseNotes')}
              <ExternalLink className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
          {secondaryLabel ? (
            <button type="button" className="ds-sidebar-update-button" onClick={onClose}>{secondaryLabel}</button>
          ) : null}
          <span className="flex-1" />
          {primaryLabel ? (
            <button
              type="button"
              className="ds-sidebar-update-button"
              data-primary="true"
              disabled={busy}
              onClick={runPrimary}
            >
              {primaryLabel}
              {phase === 'manual' ? <ExternalLink className="h-3 w-3" strokeWidth={2} aria-hidden="true" /> : null}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * GUI update entry in the sidebar footer, beside Settings. It appears only
 * while an update is known; the chip opens a card above the footer bar with
 * the version, progress or error and the action, so nothing restarts on a
 * stray click. Render it as a direct child of the footer bar.
 */
export function SidebarGuiUpdate(): ReactElement | null {
  const action = useGuiUpdateAction()
  if (!action) return null
  return <SidebarGuiUpdateChip action={action} />
}

function SidebarGuiUpdateChip({ action }: { action: GuiUpdateAction }): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [pulse, setPulse] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const { info, phase, percent } = action
  const label = phase === 'downloading' ? `${percent}%` : t(CHIP_LABEL_KEYS[phase])
  const labelFits = useChipLabelFits(chipRef, label)
  const chipTitle = phase === 'error' && action.error
    ? action.error
    : t('sidebarUpdateTitleAvailable', { version: info.latestVersion })

  useEffect(() => {
    if (phase !== 'available' || pulsedVersion === info.latestVersion) return
    pulsedVersion = info.latestVersion
    setPulse(true)
  }, [info.latestVersion, phase])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target && (cardRef.current?.contains(target) || chipRef.current?.contains(target))) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      chipRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const close = (): void => {
    setOpen(false)
    if (phase === 'error') action.dismissError()
  }

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        data-cursor-spotlight-target
        className="ds-sidebar-update-chip"
        data-phase={phase}
        data-compact={labelFits ? undefined : 'true'}
        data-pulse={pulse ? 'true' : undefined}
        onAnimationEnd={() => setPulse(false)}
        onClick={() => setOpen((value) => !value)}
        title={open ? undefined : chipTitle}
        aria-label={`${label} · ${chipTitle}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <ChipIcon phase={phase} percent={percent} />
        <span className="ds-sidebar-update-chip-label" data-update-chip-label>{label}</span>
      </button>
      {open ? <UpdateCard action={action} titleId={titleId} cardRef={cardRef} onClose={close} /> : null}
    </>
  )
}
