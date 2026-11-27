import {
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { ColabResourceSample } from '@shared/colab/colab-types'
import {
  buildTimeTicks,
  pickNearestSampleIndex,
  xForTime,
  yForPercent,
  type ResourceMetricSeries
} from './resource-trend'

const VIEW_WIDTH = 348
const MARGIN = { left: 30, right: 10, top: 8, bottom: 18 }
const PLOT_WIDTH = VIEW_WIDTH - MARGIN.left - MARGIN.right

export type ResourceChartSeries = {
  id: string
  label: string
  color: string
  metric: ResourceMetricSeries
  fill?: boolean
  formatValue: (value: number, sampleIndex: number) => string
}

export type ResourceTrendChartProps = {
  chartId: string
  ariaLabel: string
  samples: readonly ColabResourceSample[]
  startMs: number
  endMs: number
  nowMs: number
  series: ResourceChartSeries[]
  emptyMessage: string
  threshold?: { value: number; label: string }
  height?: number
  yMax?: number
}

function formatAge(ageMs: number, t: TFunction<'common'>): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000))
  if (seconds < 5) return t('colabNb.resourceNow')
  if (seconds < 60) return t('colabNb.resourceSecondsAgo', { seconds })
  return t('colabNb.resourceMinutesAgo', {
    minutes: Math.max(1, Math.round(seconds / 60))
  })
}

function axisTimeLabel(offsetMs: number, t: TFunction<'common'>): string {
  if (offsetMs === 0) return t('colabNb.resourceNow')
  const minuteMs = 60_000
  if (Math.abs(offsetMs) % minuteMs === 0) {
    return t('colabNb.resourceAxisMinutesAgo', {
      minutes: Math.round(Math.abs(offsetMs) / minuteMs)
    })
  }
  const totalSeconds = Math.round(Math.abs(offsetMs) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `-${minutes}:${String(seconds).padStart(2, '0')}`
}

function linePath(
  points: Array<{ at: number; value: number }>,
  x: (at: number) => number,
  y: (value: number) => number
): string {
  return points
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L'
      return `${command}${x(point.at).toFixed(1)} ${y(point.value).toFixed(1)}`
    })
    .join(' ')
}

function lastValidIndex(series: ResourceChartSeries[]): number {
  const length = series[0]?.metric.values.length ?? 0
  for (let index = length - 1; index >= 0; index -= 1) {
    if (series.some((item) => item.metric.values[index] !== null)) return index
  }
  return length > 0 ? length - 1 : -1
}

export function ResourceTrendChart({
  chartId,
  ariaLabel,
  samples,
  startMs,
  endMs,
  nowMs,
  series,
  emptyMessage,
  threshold,
  height = 112,
  yMax = 100
}: ResourceTrendChartProps): ReactElement {
  const { t } = useTranslation('common')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)

  const plotHeight = Math.max(1, height - MARGIN.top - MARGIN.bottom)
  const xAt = (at: number): number =>
    xForTime(at, startMs, endMs, MARGIN.left, PLOT_WIDTH)
  const yAt = (value: number): number =>
    yForPercent(value, MARGIN.top, plotHeight, yMax)
  const tickValues = Array.from({ length: 5 }, (_, index) => (yMax / 4) * index)
  const timeTicks = buildTimeTicks(startMs, endMs, 6)
  const hasValue = series.some((item) => item.metric.summary.count > 0)
  const rawActiveIndex = hoverIndex ?? focusIndex
  const activeIndex =
    rawActiveIndex === null
      ? -1
      : Math.min(Math.max(rawActiveIndex, 0), Math.max(0, samples.length - 1))
  const activeSample = activeIndex >= 0 ? samples[activeIndex] : null

  if (!hasValue) {
    return (
      <div
        data-resource-chart={chartId}
        data-resource-empty
        role="status"
        className="mt-1.5 flex items-center justify-center rounded-[8px] border border-dashed border-ds-border-muted px-3 text-center text-[11px] text-ds-faint"
        style={{ height: height - 20 }}
      >
        {emptyMessage}
      </div>
    )
  }

  function setActiveFromPointer(event: PointerEvent<SVGRectElement>): void {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || samples.length === 0) return
    // The hit rect is exactly the plot area, so its own box maps to time.
    const ratio = (event.clientX - rect.left) / rect.width
    const atMs = startMs + Math.min(1, Math.max(0, ratio)) * (endMs - startMs)
    const index = pickNearestSampleIndex(samples, atMs)
    if (index >= 0) setHoverIndex(index)
  }

  function handleKeyDown(event: KeyboardEvent<SVGSVGElement>): void {
    if (samples.length === 0) return
    const current = activeIndex >= 0 ? activeIndex : lastValidIndex(series)
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = Math.max(0, current - 1)
    else if (event.key === 'ArrowRight') next = Math.min(samples.length - 1, current + 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = samples.length - 1
    else if (event.key === 'Escape') {
      setFocusIndex(null)
      setHoverIndex(null)
      return
    }
    if (next === null) return
    event.preventDefault()
    setFocusIndex(next)
    setHoverIndex(null)
  }

  const tooltipTransform =
    activeSample === null
      ? 'translateX(-50%)'
      : xAt(activeSample.at) / VIEW_WIDTH < 0.18
        ? 'translateX(0)'
        : xAt(activeSample.at) / VIEW_WIDTH > 0.82
          ? 'translateX(-100%)'
          : 'translateX(-50%)'

  return (
    <div
      data-resource-chart={chartId}
      className="relative mt-1.5"
      style={{ minHeight: height }}
    >
      <svg
        data-resource-svg={chartId}
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        role="img"
        tabIndex={0}
        aria-label={ariaLabel}
        className="block h-auto w-full cursor-crosshair overflow-visible rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ds-focus"
        onFocus={() => {
          const index = lastValidIndex(series)
          if (index >= 0) setFocusIndex(index)
        }}
        onBlur={() => {
          setFocusIndex(null)
          setHoverIndex(null)
        }}
        onKeyDown={handleKeyDown}
      >
        <defs>
          {series.map((item) =>
            item.fill ? (
              <linearGradient
                key={item.id}
                id={`resource-gradient-${chartId}-${item.id}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={item.color} stopOpacity="0.2" />
                <stop offset="100%" stopColor={item.color} stopOpacity="0" />
              </linearGradient>
            ) : null
          )}
        </defs>

        {tickValues.map((value) => (
          <line
            key={`grid-${value}`}
            x1={MARGIN.left}
            x2={VIEW_WIDTH - MARGIN.right}
            y1={yAt(value)}
            y2={yAt(value)}
            className={value === 0 ? 'stroke-ds-border' : 'stroke-ds-border-muted'}
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        ))}

        {tickValues.map((value) => (
          <text
            key={`y-${value}`}
            data-resource-y-tick={value}
            x={MARGIN.left - 6}
            y={yAt(value) + 3}
            textAnchor="end"
            className="fill-ds-muted text-[9px]"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {Math.round(value)}
          </text>
        ))}

        <line
          x1={MARGIN.left}
          x2={VIEW_WIDTH - MARGIN.right}
          y1={height - MARGIN.bottom}
          y2={height - MARGIN.bottom}
          className="stroke-ds-border"
          strokeWidth={1}
          shapeRendering="crispEdges"
        />

        {timeTicks.map((tick, index) => (
          <text
            key={`x-${tick.offsetMs}`}
            data-resource-x-tick={tick.offsetMs}
            x={MARGIN.left + PLOT_WIDTH * tick.fraction}
            y={height - 3}
            textAnchor={index === 0 ? 'start' : index === timeTicks.length - 1 ? 'end' : 'middle'}
            className="fill-ds-muted text-[9px]"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {axisTimeLabel(tick.offsetMs, t)}
          </text>
        ))}

        {threshold !== undefined && threshold.value >= 0 && threshold.value <= yMax ? (
          <g data-resource-threshold={threshold.value}>
            <line
              x1={MARGIN.left}
              x2={VIEW_WIDTH - MARGIN.right}
              y1={yAt(threshold.value)}
              y2={yAt(threshold.value)}
              stroke="var(--ds-status-warning)"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.65}
            />
            <text
              x={VIEW_WIDTH - MARGIN.right}
              y={yAt(threshold.value) - 4}
              textAnchor="end"
              className="text-[8.5px]"
              style={{ fill: 'var(--ds-status-warning)' }}
            >
              {threshold.label}
            </text>
          </g>
        ) : null}

        {series.map((item) => (
          <g key={item.id} data-resource-series={item.id}>
            {item.fill
              ? item.metric.segments
                  .filter((segment) => segment.length > 1)
                  .map((segment, index) => {
                    const first = segment[0]
                    const last = segment[segment.length - 1]
                    const area = `${linePath(segment, xAt, yAt)} L${xAt(last.at).toFixed(1)} ${yAt(0).toFixed(1)} L${xAt(first.at).toFixed(1)} ${yAt(0).toFixed(1)} Z`
                    return (
                      <path
                        key={`area-${index}`}
                        d={area}
                        fill={`url(#resource-gradient-${chartId}-${item.id})`}
                        stroke="none"
                      />
                    )
                  })
              : null}
            {item.metric.segments
              .filter((segment) => segment.length > 1)
              .map((segment, index) => (
                <path
                  key={`line-${index}`}
                  data-resource-series-line={item.id}
                  d={linePath(segment, xAt, yAt)}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={item.fill ? 1.75 : 1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            {item.metric.segments
              .filter((segment) => segment.length === 1)
              .map((segment, index) => (
                <circle
                  key={`point-${index}`}
                  data-resource-series-point={item.id}
                  cx={xAt(segment[0].at)}
                  cy={yAt(segment[0].value)}
                  r={1.8}
                  fill={item.color}
                />
              ))}
          </g>
        ))}

        {series.map((item) => {
          const points = item.metric.segments.flat()
          const last = points[points.length - 1]
          if (!last) return null
          return (
            <circle
              key={`last-${item.id}`}
              data-resource-series-last={item.id}
              cx={xAt(last.at)}
              cy={yAt(last.value)}
              r={3.2}
              fill="var(--ds-surface-card)"
              stroke={item.color}
              strokeWidth={1.8}
            />
          )
        })}

        {activeSample ? (
          <g data-resource-crosshair opacity={1} pointerEvents="none">
            <line
              x1={xAt(activeSample.at)}
              x2={xAt(activeSample.at)}
              y1={MARGIN.top}
              y2={height - MARGIN.bottom}
              stroke="var(--ds-border-strong)"
              strokeWidth={1}
            />
            {series.map((item) => {
              const value = item.metric.values[activeIndex]
              if (value === null || value === undefined) return null
              return (
                <circle
                  key={`dot-${item.id}`}
                  data-resource-crosshair-dot={item.id}
                  cx={xAt(activeSample.at)}
                  cy={yAt(value)}
                  r={2.6}
                  fill="var(--ds-surface-card)"
                  stroke={item.color}
                  strokeWidth={1.6}
                />
              )
            })}
          </g>
        ) : null}

        <rect
          data-resource-hit-area={chartId}
          x={MARGIN.left}
          y={MARGIN.top}
          width={PLOT_WIDTH}
          height={plotHeight}
          fill="transparent"
          onPointerMove={setActiveFromPointer}
          onPointerLeave={() => setHoverIndex(null)}
        />
      </svg>

      {activeSample ? (
        <div
          data-resource-tooltip={chartId}
          role="tooltip"
          className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-[7px] border border-ds-border bg-ds-card px-2 py-1 text-[10.5px] text-ds-ink shadow-lg"
          style={{
            left: `${(xAt(activeSample.at) / VIEW_WIDTH) * 100}%`,
            transform: tooltipTransform
          }}
        >
          <div className="mb-0.5 text-[9.5px] text-ds-muted">
            {formatAge(Math.max(0, nowMs - activeSample.at), t)}
          </div>
          {series.map((item) => {
            const value = item.metric.values[activeIndex]
            return (
              <div
                key={item.id}
                data-resource-tooltip-series={item.id}
                className="flex items-center gap-1.5 leading-[1.5]"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-[7px] w-[7px] shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-ds-muted">{item.label}</span>
                <b className="font-mono font-semibold tabular-nums">
                  {value === null || value === undefined
                    ? t('colabNb.resourceNoValue')
                    : item.formatValue(value, activeIndex)}
                </b>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
