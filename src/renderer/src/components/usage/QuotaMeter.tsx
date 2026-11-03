import type { ReactElement } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { ProviderQuotaMetric } from '@shared/provider-quota'
import {
  formatPercent,
  quotaCountText,
  quotaFillPercent,
  quotaPace,
  quotaResetParts,
  quotaSeverity,
  quotaUsedPercent,
  quotaWindowName,
  type QuotaDisplayMode
} from './quota-view-model'

type MeterProps = {
  metric: ProviderQuotaMetric
  mode: QuotaDisplayMode
  now: number
  locale?: string
  onToggleMode: () => void
}

export function quotaWindowLabel(metric: ProviderQuotaMetric, t: TFunction, short = false): string {
  const name = quotaWindowName(metric)
  if (!name.span) return name.raw ?? metric.label
  const span = t(
    name.span.unit === 'hours'
      ? short ? 'usagePanelWindowHoursShort' : 'usagePanelWindowHours'
      : short ? 'usagePanelWindowDaysShort' : 'usagePanelWindowDays',
    { count: name.span.count }
  )
  return name.scope ? `${name.scope} · ${span}` : span
}

/** "Used 42%" or "Left 58%", with the vendor's own count before it. */
export function quotaValueText(
  metric: ProviderQuotaMetric,
  mode: QuotaDisplayMode,
  t: TFunction,
  locale?: string
): { count?: string; share: string } {
  const used = quotaUsedPercent(metric) ?? 0
  const share = t(mode === 'left' ? 'usagePanelLeftPercent' : 'usagePanelUsedPercent', {
    percent: formatPercent(quotaFillPercent(used, mode))
  })
  const count = quotaCountText(metric, mode, locale)
  return count ? { count, share } : { share }
}

export function quotaResetText(
  metric: ProviderQuotaMetric,
  now: number,
  t: TFunction,
  locale?: string
): string | undefined {
  if (!metric.resetsAt) return undefined
  const parts = quotaResetParts(metric.resetsAt, now, locale)
  if (!parts) return undefined
  const expiry = metric.id === 'reset-credits'
  if (!parts.relative) return t(expiry ? 'usagePanelExpiresAt' : 'usagePanelResetsAt', { clock: parts.clock })
  return t(expiry ? 'usagePanelExpiresIn' : 'usagePanelResetsIn', {
    clock: parts.clock,
    relative: parts.relative
  })
}

/** "Opus · 7-day": the span kept whole when the name wraps. */
function labelParts(label: string): ReactElement {
  const cut = label.lastIndexOf(' · ')
  if (cut < 0) return <>{label}</>
  return <>{label.slice(0, cut + 3)}<span className="kq-nowrap">{label.slice(cut + 3)}</span></>
}

function modeToggleTitle(mode: QuotaDisplayMode, t: TFunction): string {
  return t(mode === 'left' ? 'usagePanelShowUsedHint' : 'usagePanelShowLeftHint')
}

/** One window as a labelled bar: its name, its figure, its reset. */
export function QuotaBarMeter({ metric, mode, now, locale, onToggleMode }: MeterProps): ReactElement {
  const { t } = useTranslation('common')
  const used = quotaUsedPercent(metric) ?? 0
  const fill = quotaFillPercent(used, mode)
  const pace = quotaPace(metric, now)
  const paceAt = pace ? quotaFillPercent(pace.expectedUsedPercent, mode) : undefined
  const label = quotaWindowLabel(metric, t)
  const value = quotaValueText(metric, mode, t, locale)
  const reset = quotaResetText(metric, now, t, locale)
  const valueText = value.count ? `${value.count} · ${value.share}` : value.share
  return (
    <div
      className="kq-meter"
      data-quota-metric={metric.id}
      data-severity={quotaSeverity(used)}
      title={metric.label === label ? undefined : metric.label}
    >
      <div className="kq-meter-head">
        <span className="kq-meter-name">{labelParts(label)}</span>
        <button
          type="button"
          className="kq-meter-value"
          onClick={onToggleMode}
          title={`${valueText}\n${modeToggleTitle(mode, t)}`}
        >
          {value.share}
        </button>
      </div>
      <div
        className="kq-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill)}
        aria-valuetext={valueText}
      >
        <span className="kq-fill" style={{ width: `${fill}%` }} />
        {paceAt !== undefined ? (
          <span
            className="kq-pace"
            style={{ left: `${paceAt}%` }}
            title={t('usagePanelPaceTitle', { percent: formatPercent(pace!.expectedUsedPercent) })}
            data-quota-pace
          />
        ) : null}
      </div>
      {value.count ? <p className="kq-meter-count">{value.count}</p> : null}
      {reset || pace?.ahead ? (
        <p className="kq-reset">
          {reset ? <span>{reset}</span> : null}
          {pace?.ahead ? (
            <span
              className="kq-pace-note"
              title={t('usagePanelPaceTitle', { percent: formatPercent(pace.expectedUsedPercent) })}
            >
              {t('usagePanelPaceAhead')}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

const RING_RADIUS = 21
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

/** One window as a ring with its share inside: the tray's compact meter. */
export function QuotaRingMeter({ metric, mode, now, locale, onToggleMode }: MeterProps): ReactElement {
  const { t } = useTranslation('common')
  const used = quotaUsedPercent(metric) ?? 0
  const fill = quotaFillPercent(used, mode)
  const label = quotaWindowLabel(metric, t)
  const short = quotaWindowLabel(metric, t, true)
  const value = quotaValueText(metric, mode, t, locale)
  const reset = quotaResetText(metric, now, t, locale)
  const title = [`${label} · ${value.count ? `${value.count} · ` : ''}${value.share}`, reset, modeToggleTitle(mode, t)]
    .filter(Boolean)
    .join('\n')
  return (
    <button
      type="button"
      className="kq-ring"
      data-quota-metric={metric.id}
      data-severity={quotaSeverity(used)}
      onClick={onToggleMode}
      title={title}
      aria-label={title}
    >
      <svg viewBox="0 0 50 50" aria-hidden="true">
        <circle className="kq-ring-track" cx="25" cy="25" r={RING_RADIUS} />
        <circle
          className="kq-ring-fill"
          cx="25"
          cy="25"
          r={RING_RADIUS}
          strokeDasharray={`${(fill / 100) * RING_LENGTH} ${RING_LENGTH}`}
        />
      </svg>
      <span className="kq-ring-value">{formatPercent(fill)}</span>
      {short.includes(' · ') ? (
        <span className="kq-ring-name is-stacked">
          <span>{short.slice(0, short.lastIndexOf(' · '))}</span>
          <span>{short.slice(short.lastIndexOf(' · ') + 3)}</span>
        </span>
      ) : (
        <span className="kq-ring-name">{short}</span>
      )}
    </button>
  )
}
