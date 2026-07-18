import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  Diamond,
  Plus,
  Sparkles
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { filterEditableShapeIds } from '../../../design/canvas/canvas-editability'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import {
  embeddedArtifactOf,
  isSvgFrame,
  type CanvasShape
} from '../../../design/canvas/canvas-types'
import {
  advanceMotionPlayback,
  evaluateMotionTrack,
  resolveOwningMotionFrameId,
  type CanvasMotionEasing,
  type CanvasMotionKeyframe,
  type CanvasMotionPlaybackMode,
  type CanvasMotionProperty,
  type CanvasMotionTrack
} from '../../../design/motion'
import {
  addPropertyTracks,
  applyMotionPreset,
  configureTimeline,
  removeKeyframe,
  removeTrack,
  upsertKeyframe,
  type CanvasMotionPreset
} from '../../../design/motion/canvas-motion-mutations'
import { useCanvasMotionStore } from '../../../design/motion/canvas-motion-store'
import {
  useSvgAnimationPreviewStore,
  type SvgAnimationPreviewState
} from '../../../design/svg/svg-animation-preview-store'
import { CanvasMotionKeyframeInspector } from './CanvasMotionKeyframeInspector'
import { CanvasMotionSvgPreview } from './CanvasMotionSvgPreview'
import { CanvasMotionTransport } from './CanvasMotionTransport'

const PROPERTY_LABELS: Array<{
  property: CanvasMotionProperty
  labelKey: string
  fallback: string
}> = [
  { property: 'x', labelKey: 'canvasMotionPropertyX', fallback: 'X' },
  { property: 'y', labelKey: 'canvasMotionPropertyY', fallback: 'Y' },
  { property: 'rotation', labelKey: 'canvasMotionPropertyRotate', fallback: 'Rotate' },
  { property: 'scaleX', labelKey: 'canvasMotionPropertyScaleX', fallback: 'Scale X' },
  { property: 'scaleY', labelKey: 'canvasMotionPropertyScaleY', fallback: 'Scale Y' },
  { property: 'opacity', labelKey: 'canvasMotionPropertyOpacity', fallback: 'Opacity' }
]

const PRESETS: Array<{
  preset: CanvasMotionPreset
  labelKey: string
  fallback: string
}> = [
  { preset: 'fade', labelKey: 'canvasMotionPresetFade', fallback: 'Fade' },
  { preset: 'move', labelKey: 'canvasMotionPresetMove', fallback: 'Move' },
  { preset: 'scale', labelKey: 'canvasMotionPresetScale', fallback: 'Scale' },
  { preset: 'rotate', labelKey: 'canvasMotionPresetRotate', fallback: 'Rotate' }
]

const TIMELINE_TICKS = [0, 0.25, 0.5, 0.75, 1] as const

type DragState = {
  trackId: string
  keyframeId: string
  timeMs: number
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => setReduced(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return reduced
}

function trackTime(track: CanvasMotionTrack, keyframe: CanvasMotionKeyframe): number {
  const finalKeyframeTime = track.keyframes[track.keyframes.length - 1]?.timeMs ?? 0
  const localTime = track.durationMs && finalKeyframeTime > 0
    ? (keyframe.timeMs / finalKeyframeTime) * track.durationMs
    : keyframe.timeMs
  return (track.delayMs ?? 0) + localTime
}

function trackLocalTime(track: CanvasMotionTrack, timelineTimeMs: number): number {
  const delayed = Math.max(0, timelineTimeMs - (track.delayMs ?? 0))
  const finalKeyframeTime = track.keyframes[track.keyframes.length - 1]?.timeMs ?? 0
  if (!track.durationMs || finalKeyframeTime <= 0) return delayed
  return Math.max(0, Math.min(finalKeyframeTime, delayed / track.durationMs * finalKeyframeTime))
}

function trackRawValue(track: CanvasMotionTrack, absoluteValue: number, currentBaseValue: number): number {
  if (track.operation === 'offset') return absoluteValue - currentBaseValue
  if (track.operation === 'scale') return currentBaseValue === 0 ? absoluteValue : absoluteValue / currentBaseValue
  return absoluteValue
}

function easingLabel(easing: CanvasMotionEasing): string {
  switch (easing.type) {
    case 'cubic-bezier': return 'Bezier'
    case 'ease-in': return 'Ease in'
    case 'ease-out': return 'Ease out'
    case 'ease-in-out': return 'Ease in out'
    case 'spring': return 'Spring'
    case 'hold': return 'Hold'
    case 'linear': return 'Linear'
  }
}

function shapeLabel(shape: CanvasShape | undefined, fallback: string): string {
  return shape?.name?.trim() || fallback
}

export function CanvasMotionDock(): ReactElement | null {
  const { t } = useTranslation('common')
  const document = useCanvasShapeStore((state) => state.document)
  const selectedIds = useCanvasSelectionStore((state) => state.selectedIds)
  const open = useCanvasMotionStore((state) => state.open)
  const activeFrameId = useCanvasMotionStore((state) => state.activeFrameId)
  const currentTimeMs = useCanvasMotionStore((state) => state.currentTimeMs)
  const playing = useCanvasMotionStore((state) => state.playing)
  const direction = useCanvasMotionStore((state) => state.direction)
  const rate = useCanvasMotionStore((state) => state.rate)
  const autoKey = useCanvasMotionStore((state) => state.autoKey)
  const timelineZoom = useCanvasMotionStore((state) => state.timelineZoom)
  const selectedTrackId = useCanvasMotionStore((state) => state.selectedTrackId)
  const selectedKeyframeId = useCanvasMotionStore((state) => state.selectedKeyframeId)
  const selectedSvgShapeId = useMemo(() => {
    if (selectedIds.size !== 1) return null
    const shapeId = selectedIds.values().next().value as string | undefined
    const shape = shapeId ? document.objects[shapeId] : undefined
    return shapeId && shape && isSvgFrame(shape) ? shapeId : null
  }, [document.objects, selectedIds])
  const liveSvgPreview = useSvgAnimationPreviewStore((state) =>
    open && selectedSvgShapeId ? state.previews[selectedSvgShapeId] : undefined
  )
  const reducedMotion = usePrefersReducedMotion()
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const keyframeDragCleanupRef = useRef<(() => void) | null>(null)
  const frameId = activeFrameId ?? document.rootId
  const timeline = document.motion?.timelines[frameId]
  const durationMs = timeline?.durationMs ?? 2_000
  const selectedShapeIds = useMemo(
    () => filterEditableShapeIds(document, selectedIds).filter(
      (id) => resolveOwningMotionFrameId(document, id) === frameId
    ),
    [document, frameId, selectedIds]
  )
  const selectedTrack = timeline?.tracks.find((track) => track.id === selectedTrackId)
  const selectedKeyframe = selectedTrack?.keyframes.find((keyframe) => keyframe.id === selectedKeyframeId)
  const svgPreview = useMemo<SvgAnimationPreviewState | undefined>(() => {
    if (!selectedSvgShapeId) return undefined
    if (liveSvgPreview) return liveSvgPreview
    const shape = document.objects[selectedSvgShapeId]
    const reference = shape ? embeddedArtifactOf(shape) : null
    return {
      shapeId: selectedSvgShapeId,
      artifactId: reference?.id ?? '',
      title: shapeLabel(shape, selectedSvgShapeId),
      status: 'loading',
      animationCount: 0,
      durationMs: 1_000,
      loopsIndefinitely: false,
      currentTimeMs: 0,
      playing: false,
      rate: 1
    }
  }, [document.objects, liveSvgPreview, selectedSvgShapeId])
  const frameName = frameId === document.rootId
    ? t('canvasMotionCanvasTimeline', 'Canvas timeline')
    : shapeLabel(document.objects[frameId], t('canvasMotionFrameTimeline', 'Frame timeline'))
  const playheadPercent = `${durationMs > 0 ? currentTimeMs / durationMs * 100 : 0}%`
  const lastFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (!playing) {
      lastFrameRef.current = null
      return
    }
    if (reducedMotion || !timeline) {
      useCanvasMotionStore.getState().setPlaying(false)
      return
    }
    let frame = 0
    const tick = (now: number): void => {
      const previous = lastFrameRef.current ?? now
      lastFrameRef.current = now
      const motionState = useCanvasMotionStore.getState()
      const liveTimeline = useCanvasShapeStore.getState().document.motion?.timelines[frameId]
      if (!motionState.playing || !liveTimeline) return
      const next = advanceMotionPlayback(
        motionState.currentTimeMs,
        now - previous,
        liveTimeline.durationMs,
        liveTimeline.playback,
        motionState.direction,
        motionState.rate
      )
      motionState.setCurrentTimeMs(next.timeMs)
      motionState.setDirection(next.direction)
      if (!next.playing) {
        motionState.setPlaying(false)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      lastFrameRef.current = null
    }
  }, [frameId, playing, reducedMotion, timeline])

  useEffect(() => {
    if (currentTimeMs <= durationMs) return
    useCanvasMotionStore.getState().setCurrentTimeMs(durationMs)
  }, [currentTimeMs, durationMs])

  useEffect(() => () => keyframeDragCleanupRef.current?.(), [])

  if (!open) return null

  const commitMotion = (next: NonNullable<typeof document.motion>, label: string): void => {
    useCanvasMotionStore.getState().setPlaying(false)
    useCanvasShapeStore.getState().setMotionDocument(next, label)
  }

  const addTracks = (property: CanvasMotionProperty): void => {
    if (selectedShapeIds.length === 0) return
    const next = addPropertyTracks(document.motion, {
      document,
      frameId,
      targetShapeIds: selectedShapeIds,
      properties: [property],
      durationMs: Math.min(600, durationMs)
    })
    commitMotion(next, `motion-add-${property}`)
    const track = next.timelines[frameId]?.tracks.find(
      (candidate) => candidate.targetShapeId === selectedShapeIds[0] && candidate.property === property
    )
    if (track) useCanvasMotionStore.getState().selectKeyframe(track.id, track.keyframes[0]?.id)
  }

  const applyPreset = (preset: CanvasMotionPreset): void => {
    if (selectedShapeIds.length === 0) return
    const next = applyMotionPreset(document.motion, document, frameId, selectedShapeIds, preset, {
      durationMs: Math.min(600, durationMs),
      staggerMs: selectedShapeIds.length > 1 ? 80 : 0
    })
    commitMotion(next, `motion-preset-${preset}`)
  }

  const configure = (configuration: { durationMs?: number; playback?: CanvasMotionPlaybackMode }): void => {
    const next = configureTimeline(document.motion, frameId, configuration)
    commitMotion(next, 'motion-configure-timeline')
  }

  const updateKeyframe = (
    track: CanvasMotionTrack,
    keyframe: CanvasMotionKeyframe,
    patch: Partial<Pick<CanvasMotionKeyframe, 'timeMs' | 'value' | 'easing'>>
  ): void => {
    const next = upsertKeyframe(document.motion, {
      frameId,
      targetShapeId: track.targetShapeId,
      property: track.property,
      trackId: track.id,
      keyframeId: keyframe.id,
      timeMs: patch.timeMs ?? keyframe.timeMs,
      value: patch.value ?? keyframe.value,
      easing: patch.easing ?? keyframe.easing,
      operation: track.operation,
      baseValue: track.baseValue,
      delayMs: track.delayMs,
      durationMs: track.durationMs
    })
    commitMotion(next, 'motion-update-keyframe')
  }

  const addKeyframeAtPlayhead = (track: CanvasMotionTrack): void => {
    const targetShape = document.objects[track.targetShapeId]
    const currentBaseValue = targetShape
      ? track.property === 'scaleX' || track.property === 'scaleY'
        ? 1
        : targetShape[track.property]
      : track.baseValue
    const absoluteValue = evaluateMotionTrack(track, currentTimeMs, currentBaseValue)
    const next = upsertKeyframe(document.motion, {
      frameId,
      targetShapeId: track.targetShapeId,
      property: track.property,
      trackId: track.id,
      timeMs: trackLocalTime(track, currentTimeMs),
      value: trackRawValue(track, absoluteValue, currentBaseValue),
      easing: { type: 'ease-out' },
      operation: track.operation,
      baseValue: track.baseValue,
      delayMs: track.delayMs,
      durationMs: track.durationMs
    })
    commitMotion(next, 'motion-add-keyframe')
  }

  const removeSelectedKeyframe = (): void => {
    if (!selectedTrack || !selectedKeyframe) return
    const next = removeKeyframe(document.motion, frameId, selectedTrack.id, selectedKeyframe.id)
    commitMotion(next, 'motion-delete-keyframe')
    useCanvasMotionStore.getState().selectKeyframe(selectedTrack.id, null)
  }

  const togglePlayback = (): void => {
    const state = useCanvasMotionStore.getState()
    if (state.playing) {
      state.setPlaying(false)
      return
    }
    if (!timeline || reducedMotion) return
    if (timeline.playback === 'once' && state.direction === 1 && state.currentTimeMs >= timeline.durationMs) {
      state.setCurrentTimeMs(0)
    } else if (timeline.playback === 'once' && state.direction === -1 && state.currentTimeMs <= 0) {
      state.setCurrentTimeMs(timeline.durationMs)
    }
    state.setPlaying(true)
  }

  const beginKeyframeDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    track: CanvasMotionTrack,
    keyframe: CanvasMotionKeyframe
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0) return
    const move = (pointer: PointerEvent): void => {
      const ratio = Math.max(0, Math.min(1, (pointer.clientX - bounds.left) / bounds.width))
      const globalTime = ratio * durationMs
      const localTime = trackLocalTime(track, globalTime)
      const nextDrag = { trackId: track.id, keyframeId: keyframe.id, timeMs: localTime }
      dragRef.current = nextDrag
      setDrag(nextDrag)
      useCanvasMotionStore.getState().setCurrentTimeMs(globalTime)
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      keyframeDragCleanupRef.current = null
    }
    const up = (): void => {
      cleanup()
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (current?.trackId === track.id && current.keyframeId === keyframe.id) {
        updateKeyframe(track, keyframe, { timeMs: current.timeMs })
      }
    }
    const cancel = (): void => {
      cleanup()
      dragRef.current = null
      setDrag(null)
    }
    keyframeDragCleanupRef.current?.()
    keyframeDragCleanupRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    window.addEventListener('pointercancel', cancel, { once: true })
  }

  return (
    <section
      aria-label={t('canvasMotionDock', 'Motion dock')}
      data-motion-timeline
      className="ds-no-drag pointer-events-auto absolute inset-x-3 bottom-3 z-50 flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-ds-border bg-white/94 text-ds-ink shadow-[0_18px_52px_rgba(15,23,42,0.18)] backdrop-blur-2xl dark:bg-ds-card/94"
      style={{ height: 'var(--canvas-motion-dock-height)' }}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement
        const editing = target.matches('input, textarea, select, button, [contenteditable="true"]')
        if (event.key === ' ' && !editing) {
          event.preventDefault()
          event.stopPropagation()
          togglePlayback()
        }
        if (!editing && (event.key === 'Delete' || event.key === 'Backspace') && selectedKeyframe) {
          event.preventDefault()
          event.stopPropagation()
          removeSelectedKeyframe()
        }
        if (!editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault()
          event.stopPropagation()
          if (event.shiftKey) useCanvasShapeStore.getState().redo()
          else useCanvasShapeStore.getState().undo()
        }
        if (!editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      tabIndex={-1}
    >
      <CanvasMotionTransport
        frameName={frameName}
        playing={playing}
        reducedMotion={reducedMotion}
        hasTimeline={Boolean(timeline)}
        currentTimeMs={currentTimeMs}
        durationMs={durationMs}
        playback={timeline?.playback ?? 'once'}
        rate={rate}
        timelineZoom={timelineZoom}
        autoKey={autoKey}
        onTogglePlayback={togglePlayback}
        onConfigure={configure}
      />

      <div className="flex h-11 shrink-0 items-stretch border-b border-ds-border-muted bg-ds-hover/[0.14]">
        <div className="flex w-[184px] shrink-0 flex-col justify-center border-r border-ds-border-muted px-2.5">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 rounded-[5px] bg-accent-soft px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.05em] text-accent">
              {t('canvasMotionContainer', 'Container Motion')}
            </span>
            <span className="min-w-0 flex-1 truncate text-[9.5px] font-medium text-ds-ink" title={frameName}>
              {frameName}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[8.5px] text-ds-faint">
            {t('canvasMotionContainerHint', 'Animate the selected layer as one canvas object')}
          </div>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex h-full min-w-max items-center gap-2.5 px-3">
            <div className="flex items-center gap-1">
              <span className="mr-0.5 inline-flex items-center gap-1 text-[8.5px] font-semibold uppercase tracking-[0.06em] text-ds-faint">
                <Sparkles className="h-2.5 w-2.5" />
                {t('canvasMotionPresets', 'Presets')}
              </span>
              {PRESETS.map(({ preset, labelKey, fallback }) => (
                <button
                  key={preset}
                  type="button"
                  disabled={selectedShapeIds.length === 0}
                  onClick={() => applyPreset(preset)}
                  className="h-6 rounded-[7px] bg-accent-soft px-2 text-[9.5px] font-medium text-accent hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {t(labelKey, fallback)}
                </button>
              ))}
            </div>
            <span className="h-5 w-px bg-ds-border-muted" />
            <div className="flex items-center gap-0.5">
              <span className="mr-0.5 text-[8.5px] font-semibold uppercase tracking-[0.06em] text-ds-faint">
                {t('canvasMotionAddProperty', 'Add property')}
              </span>
              {PROPERTY_LABELS.map(({ property, labelKey, fallback }) => (
                <button
                  key={property}
                  type="button"
                  disabled={selectedShapeIds.length === 0}
                  onClick={() => addTracks(property)}
                  className="inline-flex h-6 items-center gap-1 rounded-[7px] px-1.5 text-[9px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-35"
                >
                  <Plus className="h-2.5 w-2.5" />
                  {t(labelKey, fallback)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          <div
            data-motion-track-grid
            style={{ minWidth: `${Math.max(100, timelineZoom * 100)}%` }}
          >
            <div className="sticky top-0 z-10 grid h-7 grid-cols-[184px_minmax(420px,1fr)] border-b border-ds-border-muted bg-white/96 dark:bg-ds-card/96">
              <div className="sticky left-0 z-[2] flex items-center justify-between border-r border-ds-border-muted bg-white/96 px-2.5 dark:bg-ds-card/96">
                <span className="text-[8.5px] font-semibold uppercase tracking-[0.06em] text-ds-faint">
                  {t('canvasMotionTracks', 'Tracks')}
                </span>
                <span className="text-[8.5px] tabular-nums text-ds-faint">
                  {timeline?.tracks.length ?? 0}
                </span>
              </div>
              <div className="relative h-full">
                {TIMELINE_TICKS.map((ratio) => (
                  <span
                    key={ratio}
                    className="absolute bottom-1 text-[8.5px] tabular-nums text-ds-faint"
                    style={{ left: `${ratio * 100}%`, transform: ratio === 1 ? 'translateX(-100%)' : undefined }}
                  >
                    {Math.round(durationMs * ratio)}
                  </span>
                ))}
                <span
                  className="pointer-events-none absolute inset-y-0 w-px bg-accent"
                  style={{ left: playheadPercent }}
                />
              </div>
            </div>
            {svgPreview ? (
              <CanvasMotionSvgPreview preview={svgPreview} reducedMotion={reducedMotion} />
            ) : null}
            {timeline?.tracks.length ? timeline.tracks.map((track, trackIndex) => {
              const selected = selectedTrackId === track.id
              const startsLayer = trackIndex === 0 || timeline.tracks[trackIndex - 1]?.targetShapeId !== track.targetShapeId
              const property = PROPERTY_LABELS.find((item) => item.property === track.property)
              const propertyLabel = t(property?.labelKey ?? track.property, property?.fallback ?? track.property)
              return (
                <div key={track.id}>
                  {startsLayer ? (
                    <div className="grid h-6 grid-cols-[184px_minmax(420px,1fr)] border-b border-ds-border-muted/70 bg-ds-hover/20">
                      <div className="sticky left-0 z-[2] flex min-w-0 items-center gap-1.5 border-r border-ds-border-muted bg-ds-hover/70 px-2.5">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
                        <span className="truncate text-[9px] font-semibold text-ds-muted">
                          {shapeLabel(document.objects[track.targetShapeId], track.targetShapeId)}
                        </span>
                      </div>
                      <div className="flex items-center px-3 text-[8.5px] uppercase tracking-[0.06em] text-ds-faint">
                        {t('canvasMotionContainer', 'Container Motion')}
                      </div>
                    </div>
                  ) : null}
                  <div
                    className={`group grid h-8 grid-cols-[184px_minmax(420px,1fr)] border-b border-ds-border-muted/70 ${selected ? 'bg-accent-soft/45' : 'hover:bg-ds-hover/30'}`}
                    onClick={() => useCanvasMotionStore.getState().selectKeyframe(track.id, null)}
                  >
                    <button
                      type="button"
                      className="sticky left-0 z-[2] flex h-full min-w-0 items-center gap-1.5 border-r border-ds-border-muted bg-inherit px-3 text-left"
                      title={`${shapeLabel(document.objects[track.targetShapeId], track.targetShapeId)} · ${track.property}`}
                    >
                      <Diamond className="h-2.5 w-2.5 shrink-0 text-accent" fill="currentColor" />
                      <span className="min-w-0 flex-1 truncate text-[10px] text-ds-muted">
                        {propertyLabel}
                      </span>
                    </button>
                    <div className="relative h-full min-w-[420px]">
                      {TIMELINE_TICKS.map((ratio) => (
                        <span
                          key={ratio}
                          className="pointer-events-none absolute inset-y-0 w-px bg-ds-border-muted/55"
                          style={{ left: `${ratio * 100}%` }}
                        />
                      ))}
                      <span className="absolute left-0 right-0 top-1/2 h-px bg-ds-border-muted" />
                      <span
                        className="pointer-events-none absolute inset-y-0 z-[1] w-px bg-accent/75"
                        style={{ left: playheadPercent }}
                      />
                      {track.keyframes.map((keyframe) => {
                        const displayedTime = drag?.trackId === track.id && drag.keyframeId === keyframe.id
                          ? trackTime(track, { ...keyframe, timeMs: drag.timeMs })
                          : trackTime(track, keyframe)
                        const keyframeSelected = selectedKeyframeId === keyframe.id && selected
                        return (
                          <button
                            key={keyframe.id}
                            type="button"
                            className={`absolute top-1/2 z-[2] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border transition ${
                              keyframeSelected
                                ? 'border-accent bg-accent shadow-[0_0_0_2px_rgba(101,87,255,.2)]'
                                : 'border-ds-muted bg-white hover:border-accent dark:bg-ds-card'
                            }`}
                            style={{ left: `${Math.max(0, Math.min(100, displayedTime / durationMs * 100))}%` }}
                            onClick={(event) => {
                              event.stopPropagation()
                              useCanvasMotionStore.getState().selectKeyframe(track.id, keyframe.id)
                              useCanvasMotionStore.getState().setCurrentTimeMs(trackTime(track, keyframe))
                            }}
                            onPointerDown={(event) => beginKeyframeDrag(event, track, keyframe)}
                            onFocus={() => useCanvasMotionStore.getState().selectKeyframe(track.id, keyframe.id)}
                            aria-label={`${track.property} keyframe at ${Math.round(displayedTime)}ms`}
                            title={`${Math.round(displayedTime)} ms · ${keyframe.value} · ${easingLabel(keyframe.easing)}`}
                          />
                        )
                      })}
                      <button
                        type="button"
                        className="absolute right-1 top-1/2 z-[2] hidden h-5 w-5 -translate-y-1/2 place-items-center rounded text-ds-faint hover:bg-ds-hover hover:text-accent group-hover:grid"
                        onClick={(event) => {
                          event.stopPropagation()
                          addKeyframeAtPlayhead(track)
                        }}
                        title={t('canvasMotionAddKeyframe', 'Add keyframe at playhead')}
                        aria-label={t('canvasMotionAddKeyframe', 'Add keyframe at playhead')}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            }) : svgPreview ? null : (
              <div className="grid h-[88px] grid-cols-[184px_minmax(420px,1fr)]">
                <div className="sticky left-0 border-r border-ds-border-muted bg-white/80 dark:bg-ds-card/80" />
                <div className="grid place-items-center px-6 text-center text-[10.5px] leading-5 text-ds-faint">
                  {selectedShapeIds.length > 0
                    ? t('canvasMotionEmptySelected', 'Apply a preset or add a property to start animating the selected layer.')
                    : t('canvasMotionEmpty', 'Select a layer or frame, then add a Motion preset.')}
                </div>
              </div>
            )}
          </div>
        </div>

        {selectedTrack ? (
          <CanvasMotionKeyframeInspector
            track={selectedTrack}
            keyframe={selectedKeyframe}
            targetLabel={shapeLabel(document.objects[selectedTrack.targetShapeId], selectedTrack.targetShapeId)}
            onDeleteTrack={() => {
              const next = removeTrack(document.motion, frameId, selectedTrack.id)
              commitMotion(next, 'motion-delete-track')
              useCanvasMotionStore.getState().selectKeyframe(null)
            }}
            onUpdateKeyframe={(patch) => {
              if (selectedKeyframe) updateKeyframe(selectedTrack, selectedKeyframe, patch)
            }}
            onDeleteKeyframe={removeSelectedKeyframe}
            onAddKeyframe={() => addKeyframeAtPlayhead(selectedTrack)}
          />
        ) : null}
      </div>
    </section>
  )
}
