import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactElement, type WheelEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { HarnessCell } from './trajectory-harness-model'
import {
  deriveHarnessTimeline,
  type HarnessTimelineMode,
  type HarnessTimelineRange
} from './trajectory-harness-timeline'
import styles from './TrajectoryTimeline.module.css'

type SpanStyle = CSSProperties & {
  '--span-left': string
  '--span-width': string
  '--span-lane': number
  '--ttft-width'?: string
}

type Gesture = {
  pointerId: number
  button: number
  startX: number
  lastX: number
  viewport: HarnessTimelineRange
  selectionStart: number
}

export function TrajectoryTimeline({
  cells,
  mode,
  range,
  selectedId,
  hasEarlierRecords,
  onRangeChange,
  onRecordSelect,
  onLoadEarlier
}: {
  cells: readonly HarnessCell[]
  mode: HarnessTimelineMode
  range: HarnessTimelineRange | null
  selectedId: string | null
  hasEarlierRecords: boolean
  onRangeChange: (range: HarnessTimelineRange | null) => void
  onRecordSelect: (id: string) => void
  onLoadEarlier: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const model = useMemo(() => deriveHarnessTimeline(cells, mode), [cells, mode])
  const trackRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const tooltipTimer = useRef<number | null>(null)
  const edgePanTimer = useRef<{ direction: -1 | 1; id: number } | null>(null)
  const rangeChange = useRef(onRangeChange)
  const [viewport, setViewport] = useState<HarnessTimelineRange>({ start: 0, end: 1 })
  const [tooltip, setTooltip] = useState<{ cell: HarnessCell; x: number } | null>(null)

  useEffect(() => { rangeChange.current = onRangeChange }, [onRangeChange])
  useEffect(() => { setViewport({ start: 0, end: 1 }); rangeChange.current(null) }, [mode])
  useEffect(() => () => {
    if (tooltipTimer.current !== null) clearTimeout(tooltipTimer.current)
    if (edgePanTimer.current !== null) clearInterval(edgePanTimer.current.id)
  }, [])

  const stopEdgePan = (): void => {
    if (edgePanTimer.current === null) return
    clearInterval(edgePanTimer.current.id)
    edgePanTimer.current = null
  }
  const startEdgePan = (direction: -1 | 1): void => {
    if (edgePanTimer.current?.direction === direction) return
    stopEdgePan()
    const id = window.setInterval(() => {
      setViewport((value) => clampViewport({
        start: value.start + direction * 0.008,
        end: value.end + direction * 0.008
      }))
    }, 16)
    edgePanTimer.current = { direction, id }
  }

  const fractionAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return viewport.start
    return viewport.start + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * (viewport.end - viewport.start)
  }
  const domainAt = (clientX: number): number => {
    if (!model) return 0
    const fraction = fractionAt(clientX)
    return model.start + fraction * (model.end - model.start)
  }
  const begin = (event: PointerEvent<HTMLDivElement>): void => {
    if (!model || (event.button !== 0 && event.button !== 2)) return
    gesture.current = {
      pointerId: event.pointerId,
      button: event.button,
      startX: event.clientX,
      lastX: event.clientX,
      viewport,
      selectionStart: domainAt(event.clientX)
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (event.button === 0) onRangeChange({ start: domainAt(event.clientX), end: domainAt(event.clientX) })
    event.preventDefault()
  }
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const active = gesture.current
    if (!model || !active || active.pointerId !== event.pointerId) return
    if (active.button === 2) {
      stopEdgePan()
      const rect = event.currentTarget.getBoundingClientRect()
      const delta = rect.width ? (active.lastX - event.clientX) / rect.width * (viewport.end - viewport.start) : 0
      active.lastX = event.clientX
      setViewport((current) => clampViewport({ start: current.start + delta, end: current.end + delta }))
      return
    }
    const current = domainAt(event.clientX)
    onRangeChange({ start: Math.min(active.selectionStart, current), end: Math.max(active.selectionStart, current) })
    const rect = event.currentTarget.getBoundingClientRect()
    const edge = rect.width * 0.08
    if (event.clientX < rect.left + edge) startEdgePan(-1)
    else if (event.clientX > rect.right - edge) startEdgePan(1)
    else stopEdgePan()
  }
  const end = (event: PointerEvent<HTMLDivElement>): void => {
    if (gesture.current?.pointerId !== event.pointerId) return
    stopEdgePan()
    gesture.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const zoom = (event: WheelEvent<HTMLDivElement>): void => {
    if (!model || cells.length < 4) return
    event.preventDefault()
    const anchor = fractionAt(event.clientX)
    const factor = event.deltaY > 0 ? 1.18 : 0.82
    setViewport((current) => {
      const width = Math.min(1, Math.max(0.04, (current.end - current.start) * factor))
      const ratio = (anchor - current.start) / Math.max(0.0001, current.end - current.start)
      return clampViewport({ start: anchor - width * ratio, end: anchor + width * (1 - ratio) })
    })
  }
  const keyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      onRangeChange(null)
      event.preventDefault()
      return
    }
    if (event.key === 'Home') {
      setViewport({ start: 0, end: 1 })
      event.preventDefault()
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      setViewport((current) => clampViewport({
        start: current.start + direction * (current.end - current.start) * 0.08,
        end: current.end + direction * (current.end - current.start) * 0.08
      }))
      event.preventDefault()
      return
    }
    if (event.key === '+' || event.key === '=' || event.key === '-') {
      const factor = event.key === '-' ? 1.18 : 0.82
      setViewport((current) => zoomViewport(current, (current.start + current.end) / 2, factor))
      event.preventDefault()
    }
  }

  const visible = model?.spans.map((span) => {
    const full = Math.max(1, model.end - model.start)
    const rawLeft = (span.start - model.start) / full
    const rawRight = (span.end - model.start) / full
    const viewWidth = viewport.end - viewport.start
    const left = (rawLeft - viewport.start) / viewWidth
    const right = (rawRight - viewport.start) / viewWidth
    return { span, left, width: right - left }
  }).filter((entry) => entry.left + entry.width >= 0 && entry.left <= 1) ?? []

  return (
    <div className={styles.root} role="region" aria-label={t('trajectoryTimelineAria')} data-testid="trajectory-timeline">
      <div className={styles.plot}>
        <div className={styles.labels}><span>{t('trajectoryLaneInput')}</span><span>{t('trajectoryLaneModel')}</span><span>{t('trajectoryLaneTool')}</span></div>
        <div
          ref={trackRef}
          className={styles.track}
          data-trajectory-timeline-track=""
          tabIndex={0}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onWheel={zoom}
          onKeyDown={keyboard}
          onContextMenu={(event) => { event.preventDefault(); onRangeChange(null) }}
        >
          {hasEarlierRecords ? <button type="button" className={styles.earlierHistory} onClick={onLoadEarlier} aria-label={t('trajectoryLoadOlder')}>‹</button> : null}
          {!model ? <div className={styles.empty}>{t('trajectoryNoTiming')}</div> : (
            <>
              <div className={styles.boundaries}>
                {model.boundaries.map((boundary) => {
                  const fraction = (boundary.time - model.start) / Math.max(1, model.end - model.start)
                  const left = (fraction - viewport.start) / (viewport.end - viewport.start)
                  return left >= 0 && left <= 1 ? <span key={boundary.turn} className={styles.boundary} style={{ left: `${left * 100}%` }} /> : null
                })}
              </div>
              <div className={styles.lanes}>
                {visible.map(({ span, left, width }) => {
                  const cell = cells[span.index]
                  if (!cell) return null
                  const style: SpanStyle = {
                    '--span-left': `${left * 100}%`,
                    '--span-width': `${Math.max(0.002, width) * 100}%`,
                    '--span-lane': span.lane,
                    ...(span.ttftFraction ? { '--ttft-width': `${span.ttftFraction * 100}%` } : {})
                  }
                  return (
                    <button
                      key={span.id}
                      type="button"
                      className={styles.span}
                      data-trajectory-timeline-span=""
                      data-kind={span.kind}
                      data-error={span.error || undefined}
                      data-selected={selectedId === span.id || undefined}
                      style={style}
                      onClick={(event) => { event.stopPropagation(); onRangeChange(null); onRecordSelect(span.id) }}
                      onMouseEnter={(event) => {
                        if (tooltipTimer.current !== null) clearTimeout(tooltipTimer.current)
                        const x = event.currentTarget.getBoundingClientRect().left
                        tooltipTimer.current = window.setTimeout(() => setTooltip({ cell, x }), 500)
                      }}
                      onMouseLeave={() => { if (tooltipTimer.current !== null) clearTimeout(tooltipTimer.current); setTooltip(null) }}
                      aria-label={`${cell.kind} ${cell.text}`}
                    />
                  )
                })}
              </div>
              {range && model ? <div className={styles.selection} data-trajectory-timeline-selection="" style={selectionStyle(range, model, viewport)} /> : null}
              {tooltip ? <div className={styles.tooltip} style={{ left: Math.max(4, tooltip.x) }}>{tooltipText(tooltip.cell)}</div> : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function clampViewport(value: HarnessTimelineRange): HarnessTimelineRange {
  const width = value.end - value.start
  if (value.start < 0) return { start: 0, end: width }
  if (value.end > 1) return { start: 1 - width, end: 1 }
  return value
}

function zoomViewport(viewport: HarnessTimelineRange, anchor: number, factor: number): HarnessTimelineRange {
  const width = Math.min(1, Math.max(0.04, (viewport.end - viewport.start) * factor))
  const ratio = (anchor - viewport.start) / Math.max(0.0001, viewport.end - viewport.start)
  return clampViewport({ start: anchor - width * ratio, end: anchor + width * (1 - ratio) })
}

function selectionStyle(range: HarnessTimelineRange, model: NonNullable<ReturnType<typeof deriveHarnessTimeline>>, viewport: HarnessTimelineRange): CSSProperties {
  const full = Math.max(1, model.end - model.start)
  const left = ((range.start - model.start) / full - viewport.start) / (viewport.end - viewport.start)
  const right = ((range.end - model.start) / full - viewport.start) / (viewport.end - viewport.start)
  return { left: `${Math.max(0, left) * 100}%`, width: `${Math.max(0.2, (Math.min(1, right) - Math.max(0, left)) * 100)}%` }
}

function tooltipText(cell: HarnessCell): string {
  const duration = cell.durationMs === null ? '—' : `${Math.round(cell.durationMs)}ms`
  const ttft = cell.request?.request.usage?.requestTtftMs
  return `${cell.kind.toUpperCase()} · ${duration}${ttft === undefined ? '' : ` · TTFT ${Math.round(ttft)}ms`}`
}
