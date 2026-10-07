import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { DailyUsageBucket } from '../../hooks/use-daily-usage'
import { formatCompactNumber, formatCost } from '../../hooks/use-thread-usage'

export type UsageTrendMetric = 'tokens' | 'cost'

type Props = {
  buckets: DailyUsageBucket[]
  metric: UsageTrendMetric
  /** Cost reads the reference estimate when nothing was billed in the range. */
  costSource: 'recorded' | 'estimate'
  selectedDay: string | null
  onSelectDay: (day: string | null) => void
  locale: string
}

const HEIGHT = 112
const PAD_TOP = 14
const PAD_BOTTOM = 18
const USD_TO_CNY = 7.2

function chinese(locale: string): boolean {
  return /^zh(?:-|$)/i.test(locale.trim())
}

/** A day's cost in the currency the panel shows, recorded or estimated. */
export function bucketCost(bucket: DailyUsageBucket, source: 'recorded' | 'estimate', locale: string): number {
  const usd = source === 'recorded' ? bucket.costUsd : bucket.valueEstimateUsd
  const cny = source === 'recorded' ? bucket.costCny : bucket.valueEstimateCny
  if (chinese(locale)) return cny != null && cny > 0 ? cny : usd * USD_TO_CNY
  return usd > 0 ? usd : (cny ?? 0) / USD_TO_CNY
}

function formatMoney(value: number, locale: string): string {
  return chinese(locale) ? formatCost(null, locale, value, true) : formatCost(value, locale, null, true)
}

export function formatUsageDay(date: string, locale: string): string {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(parsed)
}

/** The plot's width, measured once it exists and again as the panel resizes. */
function useWidth(): [(element: HTMLDivElement | null) => void, number] {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!element) return
    setWidth(element.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [setElement, width]
}

export function UsageTrendChart({
  buckets,
  metric,
  costSource,
  selectedDay,
  onSelectDay,
  locale
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const values = buckets.map((bucket) => metric === 'tokens'
    ? bucket.totalTokens
    : bucketCost(bucket, costSource, locale))
  const max = Math.max(0, ...values)
  const count = buckets.length
  const slot = count > 0 && width > 0 ? width / count : 0
  const barWidth = Math.max(2, Math.min(22, slot * 0.68))
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM
  const y = (value: number): number => PAD_TOP + plotHeight - (max > 0 ? (value / max) * plotHeight : 0)
  const selectedIndex = selectedDay ? buckets.findIndex((bucket) => bucket.date === selectedDay) : -1
  const focusIndex = hover ?? (selectedIndex >= 0 ? selectedIndex : null)
  const focus = focusIndex !== null ? buckets[focusIndex] : undefined
  const formatValue = (value: number): string => metric === 'tokens'
    ? `${formatCompactNumber(value)} tokens`
    : formatMoney(value, locale)

  const indexAt = (event: { clientX: number; currentTarget: HTMLDivElement }): number | null => {
    if (!slot) return null
    const box = event.currentTarget.getBoundingClientRect()
    const index = Math.floor((event.clientX - box.left) / slot)
    return index >= 0 && index < count ? index : null
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!count) return
    if (event.key === 'Escape') {
      onSelectDay(null)
      return
    }
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (!step) return
    event.preventDefault()
    const from = selectedIndex >= 0 ? selectedIndex : count
    const next = Math.min(count - 1, Math.max(0, from + step))
    onSelectDay(buckets[next].date)
  }

  if (max <= 0) {
    return <p className="usage-chart-empty">{t('usagePanelChartEmpty')}</p>
  }

  const labelIndexes = count <= 1 ? [0] : [0, Math.floor((count - 1) / 2), count - 1]
  return (
    <div className="usage-chart">
      <p className="usage-chart-readout" aria-live="polite">
        {focus ? (
          <>
            <strong>{formatUsageDay(focus.date, locale)}</strong>
            <span>{formatValue(values[focusIndex!])}</span>
            {metric === 'tokens' && focus.totalTokens > 0 ? (
              <span className="usage-chart-split">
                {t('usagePanelChartSplit', {
                  input: formatCompactNumber(focus.inputTokens),
                  output: formatCompactNumber(focus.outputTokens)
                })}
              </span>
            ) : null}
          </>
        ) : (
          <span className="usage-chart-hint">{t('usagePanelChartHint')}</span>
        )}
        {focus ? null : <span className="usage-chart-max">{formatValue(max)}</span>}
      </p>
      <div
        ref={ref}
        className="usage-chart-plot"
        role="group"
        tabIndex={0}
        aria-label={t('usagePanelChartLabel')}
        onPointerMove={(event) => setHover(indexAt(event))}
        onPointerLeave={() => setHover(null)}
        onClick={(event) => {
          const index = indexAt(event)
          if (index === null) return
          const day = buckets[index].date
          onSelectDay(day === selectedDay ? null : day)
        }}
        onKeyDown={onKeyDown}
      >
        {width > 0 ? (
          <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
            <line className="usage-chart-grid" x1={0} x2={width} y1={PAD_TOP} y2={PAD_TOP} />
            <line className="usage-chart-grid" x1={0} x2={width} y1={PAD_TOP + plotHeight / 2} y2={PAD_TOP + plotHeight / 2} />
            <line className="usage-chart-base" x1={0} x2={width} y1={PAD_TOP + plotHeight} y2={PAD_TOP + plotHeight} />
            {focusIndex !== null ? (
              <rect className="usage-chart-hot" x={focusIndex * slot} y={PAD_TOP - 6} width={slot} height={plotHeight + 6} rx={3} />
            ) : null}
            {buckets.map((bucket, index) => {
              const value = values[index]
              if (!(value > 0)) return null
              const x = index * slot + (slot - barWidth) / 2
              const top = y(value)
              const dimmed = selectedIndex >= 0 && index !== selectedIndex
              if (metric !== 'tokens') {
                return (
                  <rect key={bucket.date} className="usage-chart-bar is-strong" data-dimmed={dimmed}
                    x={x} y={top} width={barWidth} height={PAD_TOP + plotHeight - top} rx={1.5} />
                )
              }
              const outputTop = y(Math.min(value, bucket.outputTokens))
              const outputHeight = PAD_TOP + plotHeight - outputTop
              return (
                <g key={bucket.date} data-dimmed={dimmed}>
                  <rect className="usage-chart-bar" x={x} y={top} width={barWidth}
                    height={PAD_TOP + plotHeight - top} rx={1.5} />
                  <rect className="usage-chart-bar is-strong" x={x} y={top} width={barWidth}
                    height={Math.max(1.5, outputHeight)} rx={1.5} />
                </g>
              )
            })}
            {labelIndexes.map((index, position) => (
              <text
                key={`${index}-${position}`}
                className="usage-chart-axis"
                x={position === 0 ? 0 : position === labelIndexes.length - 1 ? width : index * slot + slot / 2}
                y={HEIGHT - 4}
                textAnchor={position === 0 ? 'start' : position === labelIndexes.length - 1 ? 'end' : 'middle'}
              >
                {formatUsageDay(buckets[index].date, locale)}
              </text>
            ))}
          </svg>
        ) : null}
      </div>
      {metric === 'tokens' ? (
        <p className="usage-chart-legend">
          <span><i className="is-light" />{t('usagePanelChartInput')}</span>
          <span><i />{t('usagePanelChartOutput')}</span>
        </p>
      ) : null}
    </div>
  )
}
