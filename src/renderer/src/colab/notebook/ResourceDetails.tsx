import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  COLAB_ACCELERATOR_SPECS,
  type ColabAccelerator,
  type ColabResourceSample
} from '@shared/colab/colab-types'
import {
  buildMetricSeries,
  buildResourceWindow,
  isResourceSampleStale,
  latestFiniteSample,
  percentValue,
  positiveNumber,
  ratioPercent,
  resourceGapThresholdMs
} from './resource-trend'
import {
  ResourceTrendChart,
  type ResourceChartSeries
} from './ResourceTrendChart'

const NO_VALUE = '—'

export type ResourceDetailsSession = {
  id: string
  accelerator: ColabAccelerator
  vramGb: number | null
  ramGb: number
  diskUsedPct?: number | null
  resourceHistory?: readonly ColabResourceSample[]
}

export type ResourceDetailsProps = {
  session: ResourceDetailsSession
  intervalMs: number
  windowMs: number
  /** Fixed clock for tests/replays; live views tick on their own. */
  nowMs?: number
}

type MemoryPair = {
  used: number
  total: number | null
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatGiB(value: number | null | undefined): string {
  const finite = finiteNumber(value)
  if (finite === null) return NO_VALUE
  return Number.isInteger(finite) ? finite.toFixed(0) : finite.toFixed(1)
}

function formatAge(ageMs: number, t: TFunction<'common'>): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000))
  if (seconds < 5) return t('colabNb.resourceNow')
  if (seconds < 60) return t('colabNb.resourceSecondsAgo', { seconds })
  return t('colabNb.resourceMinutesAgo', {
    minutes: Math.max(1, Math.round(seconds / 60))
  })
}

function latestMemoryPair(
  samples: readonly ColabResourceSample[],
  usedKey: 'vramUsedGiB' | 'ramUsedGiB',
  totalKey: 'vramTotalGiB' | 'ramTotalGiB'
): MemoryPair | null {
  const sample = samples[samples.length - 1]
  const used = finiteNumber(sample?.[usedKey])
  const total = positiveNumber(sample?.[totalKey])
  return used !== null && used >= 0 ? { used, total } : null
}

function statusChipClass(status: 'live' | 'stale' | 'waiting'): string {
  if (status === 'live') {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }
  if (status === 'stale') {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  return 'border-ds-border bg-ds-hover text-ds-muted'
}

function statusDotClass(status: 'live' | 'stale' | 'waiting'): string {
  if (status === 'live') return 'bg-emerald-500'
  if (status === 'stale') return 'bg-amber-500'
  return 'animate-pulse bg-ds-faint'
}

function ResourceDetailsBody({
  session,
  intervalMs,
  windowMs,
  nowMs
}: ResourceDetailsProps): ReactElement {
  const { t } = useTranslation('common')
  const [clockMs, setClockMs] = useState(() => nowMs ?? Date.now())

  useEffect(() => {
    if (nowMs !== undefined) return
    setClockMs(Date.now())
    const timer = setInterval(() => setClockMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [nowMs])

  const effectiveNow = nowMs ?? clockMs
  const spec = COLAB_ACCELERATOR_SPECS[session.accelerator]
  const hasGpu = spec?.kind === 'gpu'
  const resourceWindow = buildResourceWindow(
    session.resourceHistory,
    effectiveNow,
    windowMs
  )
  const samples = resourceWindow.samples
  const gapMs = resourceGapThresholdMs(intervalMs)
  const gpu = buildMetricSeries(samples, (sample) => percentValue(sample.gpuPct), gapMs)
  const vram = buildMetricSeries(
    samples,
    (sample) =>
      ratioPercent(
        sample.vramUsedGiB,
        sample.vramTotalGiB
      ),
    gapMs
  )
  const ram = buildMetricSeries(
    samples,
    (sample) =>
      ratioPercent(
        sample.ramUsedGiB,
        sample.ramTotalGiB
      ),
    gapMs
  )

  const newest = latestFiniteSample(session.resourceHistory ?? [])
  const latestAge = newest ? Math.max(0, effectiveNow - newest.at) : null
  const stale = isResourceSampleStale(newest?.at, effectiveNow, intervalMs)
  const status: 'live' | 'stale' | 'waiting' =
    !newest ? 'waiting' : stale ? 'stale' : 'live'
  const windowMinutes = Math.max(1, Math.round(windowMs / 60_000))
  const intervalSeconds = Math.max(1, Math.round(intervalMs / 1000))
  const emptyMessage =
    samples.length === 0
      ? newest
        ? t('colabNb.resourceNoSamples')
        : t('colabNb.resourceWaitingSamples')
      : t('colabNb.resourceNoSamples')

  const showVram =
    hasGpu && (positiveNumber(session.vramGb) !== null || vram.summary.count > 0)
  const vramPair = showVram
    ? latestMemoryPair(samples, 'vramUsedGiB', 'vramTotalGiB')
    : null
  const ramPair = latestMemoryPair(samples, 'ramUsedGiB', 'ramTotalGiB')
  const memoryHeadline =
    (hasGpu && showVram ? finiteNumber(vramPair?.used) : null) ??
    finiteNumber(ramPair?.used)

  const gpuSeries: ResourceChartSeries[] = hasGpu
    ? [
        {
          id: 'gpu',
          label: 'GPU',
          color: 'var(--ds-accent)',
          metric: gpu,
          fill: true,
          formatValue: (value) => `${Math.round(value)}%`
        }
      ]
    : []

  const memorySeries: ResourceChartSeries[] = []
  if (showVram) {
    memorySeries.push({
      id: 'vram',
      label: t('colabNb.resourceVram'),
      color: '#8b5cf6',
      metric: vram,
      formatValue: (value, sampleIndex) => {
        const sample = samples[sampleIndex]
        const total =
          positiveNumber(sample?.vramTotalGiB)
        return `${formatGiB(sample?.vramUsedGiB)} / ${formatGiB(total)} GiB · ${Math.round(value)}%`
      }
    })
  }
  memorySeries.push({
    id: 'ram',
    label: t('colabNb.resourceRam'),
    color: '#10b981',
    metric: ram,
    formatValue: (value, sampleIndex) => {
      const sample = samples[sampleIndex]
      const total =
        positiveNumber(sample?.ramTotalGiB)
      return `${formatGiB(sample?.ramUsedGiB)} / ${formatGiB(total)} GiB · ${Math.round(value)}%`
    }
  })

  const diskPct = finiteNumber(session.diskUsedPct)
  const statusTitle =
    status === 'stale' && latestAge !== null
      ? t('colabNb.resourceLastSample', { age: formatAge(latestAge, t) })
      : undefined

  return (
    <div data-resource-details data-resource-session-id={session.id} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10.5px] text-ds-faint">
          {t('colabNb.resourceWindowSummary', { minutes: windowMinutes })}
        </span>
        <span
          data-resource-status={status}
          title={statusTitle}
          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-[2px] text-[10px] font-semibold ${statusChipClass(status)}`}
        >
          <span aria-hidden="true" className={`h-[5px] w-[5px] rounded-full ${statusDotClass(status)}`} />
          {t(
            status === 'live'
              ? 'colabNb.resourceStatusLive'
              : status === 'stale'
                ? 'colabNb.resourceStatusStale'
                : 'colabNb.resourceStatusWaiting'
          )}
        </span>
      </div>

      {hasGpu ? (
        <section data-resource-gpu className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-medium text-ds-muted">
              {t('colabNb.resourceGpuTitle')}
            </span>
            <output
              data-resource-gpu-value
              className="font-mono text-[21px] font-semibold leading-none tracking-[-0.02em] text-ds-ink tabular-nums"
            >
              {gpu.summary.latest === null ? NO_VALUE : Math.round(gpu.summary.latest)}
              {gpu.summary.latest === null ? null : (
                <small className="ml-0.5 text-[11px] font-semibold text-ds-faint">%</small>
              )}
            </output>
          </div>
          <ResourceTrendChart
            chartId="gpu"
            ariaLabel={t('colabNb.resourceChartAriaGpu', { minutes: windowMinutes })}
            samples={samples}
            startMs={resourceWindow.startMs}
            endMs={resourceWindow.endMs}
            nowMs={effectiveNow}
            series={gpuSeries}
            emptyMessage={emptyMessage}
            threshold={{ value: 90, label: t('colabNb.resourceThreshold') }}
            height={112}
          />
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ds-muted">
            <span data-resource-gpu-avg>
              {t('colabNb.resourceAvg')}{' '}
              <b className="font-semibold text-ds-ink">
                {gpu.summary.mean === null ? NO_VALUE : `${Math.round(gpu.summary.mean)}%`}
              </b>
            </span>
            <span data-resource-gpu-peak>
              {t('colabNb.resourcePeak')}{' '}
              <b className="font-semibold text-ds-ink">
                {gpu.summary.peak === null ? NO_VALUE : `${Math.round(gpu.summary.peak)}%`}
              </b>
            </span>
            <span data-resource-gpu-points>
              {t('colabNb.resourcePointsWindow', {
                points: samples.length,
                minutes: windowMinutes
              })}
            </span>
          </div>
        </section>
      ) : (
        <p data-resource-gpu-unavailable className="text-[11.5px] text-ds-faint">
          {t('colabNb.resourceGpuUnavailable')}
        </p>
      )}

      <section
        data-resource-memory
        className="min-w-0 border-t border-ds-border-muted/70 pt-2.5"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-medium text-ds-muted">
            {t(showVram ? 'colabNb.resourceMemTitle' : 'colabNb.resourceRam')}
          </span>
          <output
            data-resource-memory-value
            className="font-mono text-[21px] font-semibold leading-none tracking-[-0.02em] text-ds-ink tabular-nums"
          >
            {memoryHeadline === null ? NO_VALUE : formatGiB(memoryHeadline)}
            {memoryHeadline === null ? null : (
              <small className="ml-0.5 text-[11px] font-semibold text-ds-faint">GiB</small>
            )}
          </output>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ds-muted">
          {showVram ? (
            <span data-resource-legend-vram>
              <i
                aria-hidden="true"
                className="mr-1 inline-block h-[2px] w-3 rounded-sm align-[3px]"
                style={{ backgroundColor: '#8b5cf6' }}
              />
              {t('colabNb.resourceVram')}{' '}
              <b className="font-semibold text-ds-ink">
                {vramPair
                  ? t('colabNb.resourceMemoryLegend', {
                      used: formatGiB(vramPair.used),
                      total: formatGiB(vramPair.total)
                    })
                  : NO_VALUE}
              </b>
            </span>
          ) : null}
          <span data-resource-legend-ram>
            <i
              aria-hidden="true"
              className="mr-1 inline-block h-[2px] w-3 rounded-sm align-[3px]"
              style={{ backgroundColor: '#10b981' }}
            />
            {t('colabNb.resourceRam')}{' '}
            <b className="font-semibold text-ds-ink">
              {ramPair
                ? t('colabNb.resourceMemoryLegend', {
                    used: formatGiB(ramPair.used),
                    total: formatGiB(ramPair.total)
                  })
                : NO_VALUE}
            </b>
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-ds-faint">
          {t('colabNb.resourceMemAxisHint')}
        </p>
        <ResourceTrendChart
          chartId="memory"
          ariaLabel={t(
            showVram ? 'colabNb.resourceChartAriaMem' : 'colabNb.resourceChartAriaRam',
            { minutes: windowMinutes }
          )}
          samples={samples}
          startMs={resourceWindow.startMs}
          endMs={resourceWindow.endMs}
          nowMs={effectiveNow}
          series={memorySeries}
          emptyMessage={emptyMessage}
          height={106}
        />
      </section>

      <div
        data-resource-disk
        className="border-t border-ds-border-muted/70 pt-2.5 text-[12px]"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-ds-muted">
            {t('colabNb.diskLabel')}
            <span className="ml-1 font-mono text-[10px] text-ds-faint">/content</span>
          </span>
          <span className="font-mono text-ds-ink tabular-nums">
            {diskPct === null ? NO_VALUE : `${Math.round(diskPct)}%`}
          </span>
        </div>
        <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-ds-hover">
          <span
            className="block h-full rounded-full bg-accent"
            style={{ width: `${Math.min(100, Math.max(0, diskPct ?? 0))}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-t border-ds-border-muted/70 pt-2 text-[10.5px] text-ds-faint">
        <span>
          {t('colabNb.resourceSamplingFooter', {
            seconds: intervalSeconds,
            minutes: windowMinutes
          })}
        </span>
        {latestAge !== null ? (
          <span data-resource-last-sample>
            {t('colabNb.resourceLastSample', { age: formatAge(latestAge, t) })}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Keyed by session so hover/focus state and the window clock never survive a
 * runtime switch and show the previous session's samples.
 */
export function ResourceDetails(props: ResourceDetailsProps): ReactElement {
  return <ResourceDetailsBody key={props.session.id} {...props} />
}
