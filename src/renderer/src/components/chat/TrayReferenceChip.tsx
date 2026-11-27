import { useEffect, useId, useState, type ReactElement } from 'react'
import { ListTodo, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TrayReferenceDisplay } from '../../lib/tray-reference-attachment'
import { WorkerSeatGlyph } from '../workers/worker-seat'
import { TrayAvatar, TrayDot, TrayStatusPill } from './composer-tray/tray-primitives'

/**
 * Inline composer context chip for a referenced Worker or Todo item.
 * Hovering or focusing the chip reveals a lightweight preview card with its
 * full title, status pill, and latest note / blocker reason.
 */
export function TrayReferenceChip({
  id,
  reference,
  onRemove
}: {
  id: string
  reference: TrayReferenceDisplay
  onRemove?: (id: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [previewOpen, setPreviewOpen] = useState(false)
  const tooltipId = useId()
  const isWorker = reference.targetKind === 'worker'

  useEffect(() => {
    if (!previewOpen || typeof document === 'undefined') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPreviewOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [previewOpen])

  const secondaryMeta = isWorker
    ? reference.note
    : [
        reference.stepIndex != null && reference.totalSteps != null
          ? t('composerTray.referenceTodoBadge', { index: reference.stepIndex, total: reference.totalSteps })
          : null,
        reference.ownerLabel,
        reference.sourceLabel
      ].filter(Boolean).join(' · ')

  return (
    <div
      className="ds-no-drag relative inline-flex max-w-full items-center"
      data-tray-reference-chip={reference.targetKind}
      data-tray-reference-id={reference.targetId}
      onMouseEnter={() => setPreviewOpen(true)}
      onMouseLeave={() => setPreviewOpen(false)}
    >
      <div className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft/65 pl-1.5 pr-1 text-[12px] font-medium text-ds-ink shadow-xs transition-colors hover:border-accent/45">
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
          aria-describedby={previewOpen ? tooltipId : undefined}
          onFocus={() => setPreviewOpen(true)}
          onBlur={() => setPreviewOpen(false)}
          onClick={() => setPreviewOpen((current) => !current)}
        >
          {isWorker && typeof reference.seat === 'number' ? (
            <TrayAvatar
              round
              color={reference.color}
              icon={<WorkerSeatGlyph seat={reference.seat} size={10} />}
            />
          ) : (
            <span className="inline-flex h-[18px] shrink-0 items-center justify-center rounded-full bg-accent/15 px-1.5 font-mono text-[11px] font-semibold text-accent">
              {reference.badge}
            </span>
          )}
          <span className="max-w-48 truncate text-ds-ink">{reference.title}</span>
          <TrayDot tone={reference.tone} />
        </button>
        {onRemove ? (
          <button
            type="button"
            onClick={() => onRemove(id)}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            aria-label={t('composerRemoveContext')}
            title={t('composerRemoveContext')}
          >
            <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {previewOpen ? (
        <div
          id={tooltipId}
          role="tooltip"
          data-tray-reference-preview
          className="pointer-events-none absolute bottom-full left-0 z-40 mb-2 w-max max-w-[22rem] rounded-xl border border-ds-border bg-ds-card px-3 py-2.5 text-left shadow-[0_10px_28px_rgba(15,23,42,0.14)]"
        >
          <div className="flex min-w-0 items-center gap-2">
            {isWorker && typeof reference.seat === 'number' ? (
              <TrayAvatar
                round
                color={reference.color}
                icon={<WorkerSeatGlyph seat={reference.seat} size={10} />}
              />
            ) : (
              <ListTodo className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ds-ink">
              {isWorker ? reference.title : `${reference.badge} ${reference.title}`}
            </span>
            {reference.statusLabel ? (
              <TrayStatusPill tone={reference.tone}>{reference.statusLabel}</TrayStatusPill>
            ) : null}
          </div>
          {reference.note && !isWorker ? (
            <p className="m-0 mt-1.5 line-clamp-2 text-[12px] leading-[17px] text-ds-muted [overflow-wrap:anywhere]">
              {reference.note}
            </p>
          ) : null}
          {secondaryMeta ? (
            <p className="m-0 mt-1 line-clamp-2 text-[11.5px] leading-4 text-ds-faint [overflow-wrap:anywhere]">
              {secondaryMeta}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
