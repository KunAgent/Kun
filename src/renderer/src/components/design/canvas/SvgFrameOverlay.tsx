import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { MousePointer2, Pause, Play, RotateCcw } from 'lucide-react'
import {
  embeddedArtifactOf,
  type CanvasDocument,
  type CanvasShape
} from '../../../design/canvas/canvas-types'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import { useCanvasMotionStore } from '../../../design/motion/canvas-motion-store'
import { useCanvasMotionPortalStyle } from '../../../design/motion/canvas-motion-preview'
import { useSvgArtifactPreview } from '../../../design/svg/use-svg-artifact-preview'
import {
  publishSvgAnimationPreview,
  registerSvgAnimationPreviewController,
  type SvgAnimationPreviewController
} from '../../../design/svg/svg-animation-preview-store'
import {
  htmlFrameCanvasRectToScreenRect,
  htmlFrameCanvasScreenTransform
} from './HtmlFrameOverlay'
import {
  advanceSvgTimeline,
  canvasCornerRadiusCss,
  selectSvgFramesForOverlay,
  shouldShowSvgFrameControls,
  svgFramesInCanvasPaintOrder
} from './svg-frame/svg-frame-helpers'

type SvgRootWithTimeline = SVGSVGElement & {
  pauseAnimations?: () => void
  unpauseAnimations?: () => void
  setCurrentTime?: (seconds: number) => void
  getCurrentTime?: () => number
}

type RuntimeCssTimeline = {
  animationCount: number
  durationMs: number
  loopsIndefinitely: boolean
}

const EMPTY_CSS_TIMELINE: RuntimeCssTimeline = {
  animationCount: 0,
  durationMs: 0,
  loopsIndefinitely: false
}

function animationDocument(iframe: HTMLIFrameElement | null): Document | null {
  try {
    return iframe?.contentDocument ?? null
  } catch {
    return null
  }
}

function controlTimeline(iframe: HTMLIFrameElement | null, timeMs: number, rate: number): void {
  const document = animationDocument(iframe)
  const root = document?.querySelector('svg') as SvgRootWithTimeline | null
  root?.pauseAnimations?.()
  root?.setCurrentTime?.(Math.max(0, timeMs) / 1000)
  const animations = document?.getAnimations?.() ?? []
  for (const animation of animations) {
    animation.playbackRate = rate
    animation.currentTime = Math.max(0, timeMs)
    animation.pause()
  }
}

function inspectCssTimeline(iframe: HTMLIFrameElement | null): RuntimeCssTimeline {
  const animations = animationDocument(iframe)?.getAnimations?.() ?? []
  let durationMs = 0
  let loopsIndefinitely = false
  for (const animation of animations) {
    const timing = animation.effect?.getComputedTiming()
    if (!timing) continue
    const endTime = Number(timing.endTime)
    const singleDuration = Number(timing.duration)
    if (timing.iterations === Infinity || endTime === Infinity) loopsIndefinitely = true
    if (Number.isFinite(endTime) && endTime > 0) durationMs = Math.max(durationMs, endTime)
    else if (Number.isFinite(singleDuration) && singleDuration > 0) durationMs = Math.max(durationMs, singleDuration)
  }
  return { animationCount: animations.length, durationMs, loopsIndefinitely }
}

function nextBackground(value: 'transparent' | 'light' | 'dark'): 'transparent' | 'light' | 'dark' {
  return value === 'transparent' ? 'light' : value === 'light' ? 'dark' : 'transparent'
}

function frameIntersectsViewport(shape: CanvasShape, viewBox: { x: number; y: number; width: number; height: number }): boolean {
  return shape.x + shape.width >= viewBox.x &&
    shape.y + shape.height >= viewBox.y &&
    shape.x <= viewBox.x + viewBox.width &&
    shape.y <= viewBox.y + viewBox.height
}

function hasMotionTargetAncestor(
  document: CanvasDocument,
  shapeId: string,
  targetIds: ReadonlySet<string>
): boolean {
  const visited = new Set<string>()
  let currentId: string | null = shapeId
  while (currentId && currentId !== document.rootId && !visited.has(currentId)) {
    if (targetIds.has(currentId)) return true
    visited.add(currentId)
    currentId = document.objects[currentId]?.parentId ?? null
  }
  return false
}

function SvgArtifactFrame({
  shape,
  workspaceRoot,
  zoom,
  screenX,
  screenY,
  screenWidth,
  screenHeight,
  selected,
  panning,
  zIndex
}: {
  shape: CanvasShape
  workspaceRoot: string
  zoom: number
  screenX: number
  screenY: number
  screenWidth: number
  screenHeight: number
  selected: boolean
  panning: boolean
  zIndex: number
}): ReactElement | null {
  const reference = embeddedArtifactOf(shape)
  const artifact = useDesignWorkspaceStore((state) =>
    reference ? state.artifacts.find((item) => item.id === reference.id && item.kind === 'svg') : undefined
  )
  const [background, setBackground] = useState<'transparent' | 'light' | 'dark'>('transparent')
  const [playing, setPlaying] = useState(true)
  const [interactive, setInteractive] = useState(false)
  const [rate, setRate] = useState(1)
  const [currentMs, setCurrentMs] = useState(0)
  const [cssTimeline, setCssTimeline] = useState<RuntimeCssTimeline>(EMPTY_CSS_TIMELINE)
  const designMotionOpen = useCanvasMotionStore((state) => state.open)
  const currentMsRef = useRef(0)
  const resumeAfterDesignMotionRef = useRef(true)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const tickRef = useRef<number | null>(null)
  const lastTickRef = useRef<number | null>(null)
  const lastUiTickRef = useRef(0)
  const controllerRef = useRef<SvgAnimationPreviewController | null>(null)
  const preview = useSvgArtifactPreview(workspaceRoot, artifact?.relativePath ?? '', background)
  const hasAnimations = preview.animationCount + cssTimeline.animationCount > 0
  const durationMs = hasAnimations
    ? Math.max(1, preview.animationCount > 0 ? preview.durationMs : 0, cssTimeline.durationMs)
    : 4000
  const loopsIndefinitely = preview.loopsIndefinitely || cssTimeline.loopsIndefinitely
  const motionStyle = useCanvasMotionPortalStyle(shape, zoom)

  const seek = useCallback((timeMs: number): void => {
    const bounded = Math.max(0, Math.min(durationMs, timeMs))
    currentMsRef.current = bounded
    setCurrentMs(bounded)
    controlTimeline(iframeRef.current, bounded, rate)
  }, [durationMs, rate])

  controllerRef.current = {
    play: () => {
      if (!hasAnimations) return
      if (designMotionOpen) resumeAfterDesignMotionRef.current = true
      if (currentMsRef.current >= durationMs) seek(0)
      setPlaying(true)
    },
    pause: () => {
      if (designMotionOpen) resumeAfterDesignMotionRef.current = false
      setPlaying(false)
    },
    restart: () => {
      if (designMotionOpen) resumeAfterDesignMotionRef.current = true
      seek(0)
      setPlaying(true)
    },
    seek: (timeMs) => {
      if (designMotionOpen) resumeAfterDesignMotionRef.current = false
      setPlaying(false)
      seek(timeMs)
    },
    setRate: (nextRate) => setRate(Math.max(0.1, Math.min(4, nextRate)))
  }

  useEffect(() => {
    if (!designMotionOpen || !selected) return
    return registerSvgAnimationPreviewController(shape.id, {
      play: () => controllerRef.current?.play(),
      pause: () => controllerRef.current?.pause(),
      restart: () => controllerRef.current?.restart(),
      seek: (timeMs) => controllerRef.current?.seek(timeMs),
      setRate: (nextRate) => controllerRef.current?.setRate(nextRate)
    })
  }, [designMotionOpen, selected, shape.id])

  useEffect(() => {
    if (!designMotionOpen || !selected) return
    if (!artifact) {
      publishSvgAnimationPreview({
        shapeId: shape.id,
        artifactId: reference?.id ?? '',
        title: shape.name?.trim() || 'SVG',
        status: 'missing',
        animationCount: 0,
        durationMs: 1_000,
        loopsIndefinitely: false,
        currentTimeMs: 0,
        playing: false,
        rate
      })
      return
    }
    publishSvgAnimationPreview({
      shapeId: shape.id,
      artifactId: artifact.id,
      title: artifact.title,
      status: preview.status,
      animationCount: preview.animationCount + cssTimeline.animationCount,
      durationMs,
      loopsIndefinitely,
      currentTimeMs: currentMs,
      playing,
      rate
    })
  }, [
    artifact,
    cssTimeline.animationCount,
    currentMs,
    designMotionOpen,
    durationMs,
    loopsIndefinitely,
    playing,
    preview.animationCount,
    preview.status,
    rate,
    reference?.id,
    selected,
    shape.name,
    shape.id
  ])

  useEffect(() => {
    if (!playing || preview.status !== 'ready' || !hasAnimations) {
      if (tickRef.current !== null) cancelAnimationFrame(tickRef.current)
      tickRef.current = null
      lastTickRef.current = null
      controlTimeline(iframeRef.current, currentMsRef.current, rate)
      return
    }
    const tick = (now: number): void => {
      const previous = lastTickRef.current ?? now
      lastTickRef.current = now
      const next = advanceSvgTimeline({
        currentMs: currentMsRef.current,
        elapsedMs: now - previous,
        rate,
        durationMs,
        loopsIndefinitely
      })
      currentMsRef.current = next.timeMs
      controlTimeline(iframeRef.current, next.timeMs, rate)
      if (next.ended || now - lastUiTickRef.current >= 80) {
        lastUiTickRef.current = now
        setCurrentMs(next.timeMs)
      }
      if (next.ended) {
        setPlaying(false)
        tickRef.current = null
        return
      }
      tickRef.current = requestAnimationFrame(tick)
    }
    tickRef.current = requestAnimationFrame(tick)
    return () => {
      if (tickRef.current !== null) cancelAnimationFrame(tickRef.current)
      tickRef.current = null
      lastTickRef.current = null
    }
  }, [durationMs, hasAnimations, loopsIndefinitely, playing, preview.status, rate])

  useEffect(() => {
    setCurrentMs(0)
    currentMsRef.current = 0
    setCssTimeline(EMPTY_CSS_TIMELINE)
    if (!useCanvasMotionStore.getState().open) setPlaying(true)
  }, [preview.revision])

  useEffect(() => {
    if (selected && !shape.locked && !panning) return
    setInteractive(false)
  }, [panning, selected, shape.locked])

  useEffect(() => {
    if (designMotionOpen) {
      resumeAfterDesignMotionRef.current = playing
      setPlaying(false)
    } else if (resumeAfterDesignMotionRef.current && hasAnimations) {
      setPlaying(true)
    }
    // The transition itself is the trigger; including `playing` would overwrite
    // the saved pre-Motion state after setPlaying(false).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designMotionOpen])

  useEffect(() => {
    if (!artifact) return
    if (preview.status === 'ready' && preview.visualElementCount > 0) {
      useDesignWorkspaceStore.getState().setArtifactPreviewStatus(artifact.id, 'ready')
    } else if (preview.status === 'invalid') {
      useDesignWorkspaceStore.getState().setArtifactPreviewStatus(artifact.id, 'error')
    } else if (preview.status === 'missing' && artifact.previewStatus !== 'pending') {
      useDesignWorkspaceStore.getState().setArtifactPreviewStatus(artifact.id, 'error')
    }
  }, [artifact, preview.status, preview.visualElementCount])

  if (!artifact || !reference) return null
  const diagnostics = preview.diagnostics.length
  const label = preview.status === 'invalid'
    ? preview.diagnostics[0]?.message ?? 'Invalid SVG'
    : preview.status === 'missing'
      ? 'SVG file is missing'
      : 'Loading SVG…'
  const borderRadius = canvasCornerRadiusCss(shape.cornerRadius, zoom)
  const showControls = !designMotionOpen && shouldShowSvgFrameControls({
    selected,
    locked: shape.locked,
    panning,
    previewReady: preview.status === 'ready'
  })

  return (
    <div
      className="pointer-events-none absolute overflow-visible"
      data-canvas-motion-target={shape.id}
      data-canvas-motion-kind="portal"
      style={{
        left: screenX,
        top: screenY,
        width: screenWidth,
        height: screenHeight,
        ...motionStyle,
        zIndex
      }}
      data-svg-artifact-id={artifact.id}
    >
      <div
        className="absolute inset-0 overflow-hidden border bg-white shadow-sm"
        style={{
          borderRadius,
          borderColor: selected ? '#6557ff' : 'rgba(15,23,42,0.16)',
          boxShadow: selected ? '0 0 0 1px rgba(101,87,255,.45)' : undefined
        }}
      >
        {preview.status === 'ready' ? (
          <iframe
            key={`${artifact.relativePath}:${preview.revision}`}
            ref={iframeRef}
            sandbox="allow-same-origin"
            srcDoc={preview.srcDoc}
            title={artifact.title}
            className="absolute inset-0 h-full w-full border-0"
            style={{ pointerEvents: interactive && !shape.locked && !panning ? 'auto' : 'none' }}
            onLoad={() => {
              setCssTimeline(inspectCssTimeline(iframeRef.current))
              controlTimeline(iframeRef.current, currentMsRef.current, rate)
            }}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-slate-50 px-6 text-center text-xs text-slate-600 dark:bg-[#171b22] dark:text-white/65">
            {label}
          </div>
        )}
      </div>
      {showControls ? (
        <div className="pointer-events-auto absolute left-0 top-full mt-2 flex h-8 w-max max-w-[calc(100vw-32px)] items-center gap-1.5 rounded-lg border border-black/10 bg-white/95 px-2 text-slate-700 shadow backdrop-blur dark:border-white/15 dark:bg-[#20252e] dark:text-white/75">
          {hasAnimations ? (
            <>
              <button
                type="button"
                className="grid h-6 w-6 place-items-center rounded hover:bg-slate-100 dark:hover:bg-white/10 dark:hover:text-white"
                title={playing ? 'Pause SVG animation' : 'Play SVG animation'}
                onClick={() => {
                  if (!playing && currentMsRef.current >= durationMs) seek(0)
                  setPlaying((value) => !value)
                }}
              >
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                className="grid h-6 w-6 place-items-center rounded hover:bg-slate-100 dark:hover:bg-white/10 dark:hover:text-white"
                title="Restart SVG animation"
                onClick={() => {
                  seek(0)
                  setPlaying(true)
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <input
                type="range"
                min={0}
                max={durationMs}
                step={10}
                value={loopsIndefinitely ? currentMs % durationMs : Math.min(currentMs, durationMs)}
                className="h-1 w-28 accent-[#6557ff]"
                aria-label="SVG animation timeline"
                onChange={(event) => {
                  setPlaying(false)
                  seek(Number(event.target.value))
                }}
              />
              <button
                type="button"
                className="h-6 min-w-9 rounded px-1 text-[10px] font-semibold hover:bg-slate-100 dark:hover:bg-white/10 dark:hover:text-white"
                title="Change playback speed"
                onClick={() => setRate((value) => value === 0.5 ? 1 : value === 1 ? 2 : 0.5)}
              >
                {rate}x
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="h-5 w-5 shrink-0 rounded border border-black/10"
            style={{
              background: background === 'dark'
                ? '#111827'
                : background === 'light'
                  ? '#fff'
                  : 'linear-gradient(135deg,#e5e7eb 25%,#fff 25% 50%,#e5e7eb 50% 75%,#fff 75%)',
              backgroundSize: background === 'transparent' ? '8px 8px' : undefined
            }}
            title="Change SVG preview background"
            onClick={() => setBackground((value) => nextBackground(value))}
          />
          <button
            type="button"
            className={`grid h-6 w-6 shrink-0 place-items-center rounded ${interactive ? 'bg-violet-100 text-violet-700 dark:bg-violet-400/20 dark:text-violet-200' : 'hover:bg-slate-100 dark:hover:bg-white/10 dark:hover:text-white'}`}
            title="Toggle SVG pointer interaction"
            onClick={() => setInteractive((value) => !value)}
          >
            <MousePointer2 className="h-3.5 w-3.5" />
          </button>
          {diagnostics > 0 ? (
            <span className="max-w-20 truncate text-[9px] font-semibold text-amber-700 dark:text-amber-300" title={preview.diagnostics.map((item) => item.message).join('\n')}>
              {diagnostics} warning{diagnostics === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function SvgFrameOverlay({ workspaceRoot }: { workspaceRoot: string }): ReactElement | null {
  const document = useCanvasShapeStore((state) => state.document)
  const vbox = useCanvasViewportStore((state) => state.vbox)
  const containerWidth = useCanvasViewportStore((state) => state.containerWidth)
  const containerHeight = useCanvasViewportStore((state) => state.containerHeight)
  const activeTool = useCanvasViewportStore((state) => state.activeTool)
  const selectedIds = useCanvasSelectionStore((state) => state.selectedIds)
  const motionOpen = useCanvasMotionStore((state) => state.open)
  const motionFrameId = useCanvasMotionStore((state) => state.activeFrameId)
  const canvasScreenTransform = useMemo(() => htmlFrameCanvasScreenTransform({
    vbox,
    containerWidth,
    containerHeight
  }), [containerHeight, containerWidth, vbox])
  const zoom = canvasScreenTransform.scale
  const frames = useMemo(() => {
    const motionTargets = new Set(
      motionOpen && motionFrameId
        ? (document.motion?.timelines[motionFrameId]?.tracks ?? []).map((track) => track.targetShapeId)
        : []
    )
    const priorityIds = new Set(selectedIds)
    const candidates = svgFramesInCanvasPaintOrder(document).filter((shape) => {
      const selected = selectedIds.has(shape.id)
      const motionRelevant = motionOpen && hasMotionTargetAncestor(document, shape.id, motionTargets)
      if (motionRelevant) priorityIds.add(shape.id)
      if (selected || motionRelevant) return true
      return shape.width * zoom >= 8 && shape.height * zoom >= 8 && frameIntersectsViewport(shape, vbox)
    })
    return selectSvgFramesForOverlay(candidates, priorityIds)
  }, [document, motionFrameId, motionOpen, selectedIds, vbox, zoom])
  const paintIndexById = useMemo(() => new Map(
    (document.objects[document.rootId]?.children ?? []).map((id, index) => [id, index + 1])
  ), [document])
  if (containerWidth <= 0 || vbox.width <= 0 || frames.length === 0) return null
  return (
    <>
      {frames.map((shape) => {
        const screenRect = htmlFrameCanvasRectToScreenRect(shape, vbox, canvasScreenTransform)
        return (
          <SvgArtifactFrame
            key={shape.id}
            shape={shape}
            workspaceRoot={workspaceRoot}
            zoom={zoom}
            screenX={screenRect.x}
            screenY={screenRect.y}
            screenWidth={screenRect.width}
            screenHeight={screenRect.height}
            selected={selectedIds.has(shape.id)}
            panning={activeTool === 'hand'}
            zIndex={paintIndexById.get(shape.id) ?? 1}
          />
        )
      })}
    </>
  )
}
