import { Diamond } from 'lucide-react'
import type { ReactElement } from 'react'
import type { CanvasShape } from '../../../../design/canvas/canvas-types'
import { evaluateMotionTrack, motionKeyframeId, motionTrackId, type CanvasMotionProperty } from '../../../../design/motion'
import { removeKeyframe, upsertKeyframe } from '../../../../design/motion/canvas-motion-mutations'
import { useCanvasMotionStore } from '../../../../design/motion/canvas-motion-store'
import { useCanvasShapeStore } from '../../../../design/canvas/canvas-shape-store'

const PROPERTIES: Array<{ property: CanvasMotionProperty; label: string }> = [
  { property: 'x', label: 'X' },
  { property: 'y', label: 'Y' },
  { property: 'rotation', label: 'R' },
  { property: 'opacity', label: 'O' }
]

function baseValue(shape: CanvasShape, property: CanvasMotionProperty): number {
  if (property === 'scaleX' || property === 'scaleY') return 1
  return shape[property]
}

function localTime(track: { delayMs?: number; durationMs?: number; keyframes: Array<{ timeMs: number }> }, timeMs: number): number {
  const delayed = Math.max(0, timeMs - (track.delayMs ?? 0))
  const last = track.keyframes[track.keyframes.length - 1]?.timeMs ?? 0
  if (!track.durationMs || last <= 0) return delayed
  return Math.max(0, Math.min(last, delayed / track.durationMs * last))
}

function rawValue(
  track: { operation: 'set' | 'offset' | 'scale'; baseValue: number },
  absolute: number,
  currentBase: number
): number {
  if (track.operation === 'offset') return absolute - currentBase
  if (track.operation === 'scale') return currentBase === 0 ? absolute : absolute / currentBase
  return absolute
}

export function MotionKeyframeControls({ shape }: { shape: CanvasShape }): ReactElement | null {
  const open = useCanvasMotionStore((state) => state.open)
  const frameId = useCanvasMotionStore((state) => state.activeFrameId)
  const timeMs = useCanvasMotionStore((state) => state.currentTimeMs)
  const document = useCanvasShapeStore((state) => state.document)
  if (!open || !frameId) return null
  const timeline = document.motion?.timelines[frameId]

  return (
    <div className="flex items-center gap-1 rounded-[8px] bg-ds-hover/25 p-1" aria-label="Motion keyframes">
      <span className="mr-auto pl-1 text-[9.5px] uppercase tracking-[0.08em] text-ds-faint">Keyframe</span>
      {PROPERTIES.map(({ property, label }) => {
        const track = timeline?.tracks.find(
          (candidate) => candidate.targetShapeId === shape.id && candidate.property === property
        )
        const keyTime = track ? localTime(track, timeMs) : timeMs
        const keyframe = track?.keyframes.find((candidate) => Math.abs(candidate.timeMs - keyTime) < 0.5)
        return (
          <button
            key={property}
            type="button"
            className={`flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-[6px] px-1 text-[9px] transition ${
              keyframe ? 'bg-accent-soft text-accent' : 'text-ds-faint hover:bg-ds-hover hover:text-ds-ink'
            }`}
            title={`${keyframe ? 'Remove' : 'Add'} ${property} keyframe at ${Math.round(timeMs)}ms`}
            aria-label={`${keyframe ? 'Remove' : 'Add'} ${property} keyframe`}
            aria-pressed={Boolean(keyframe)}
            onClick={() => {
              useCanvasMotionStore.getState().setPlaying(false)
              let next = document.motion
              if (track && keyframe) {
                next = removeKeyframe(next, frameId, track.id, keyframe.id)
              } else {
                const value = track
                  ? evaluateMotionTrack(track, timeMs, baseValue(shape, property))
                  : baseValue(shape, property)
                const targetTrackId = track?.id ?? motionTrackId(frameId, shape.id, property)
                if (!track && timeMs > 0) {
                  next = upsertKeyframe(next, {
                    frameId,
                    targetShapeId: shape.id,
                    property,
                    trackId: targetTrackId,
                    keyframeId: motionKeyframeId(targetTrackId, 0),
                    timeMs: 0,
                    value: baseValue(shape, property),
                    easing: { type: 'ease-out' },
                    operation: property === 'scaleX' || property === 'scaleY' ? 'scale' : 'set',
                    baseValue: baseValue(shape, property),
                    // A new track has only the zero keyframe, so its local-time
                    // range cannot be scaled yet. Align the initial span with
                    // the current playhead; otherwise a 500ms keyframe on a
                    // 600ms span is immediately displayed at 600ms.
                    durationMs: Math.max(timeMs, 1)
                  })
                }
                const liveTrack = next?.timelines[frameId]?.tracks.find(
                  (candidate) => candidate.targetShapeId === shape.id && candidate.property === property
                )
                next = upsertKeyframe(next, {
                  frameId,
                  targetShapeId: shape.id,
                  property,
                  trackId: liveTrack?.id ?? targetTrackId,
                  timeMs: liveTrack ? localTime(liveTrack, timeMs) : timeMs,
                  value: liveTrack ? rawValue(liveTrack, value, baseValue(shape, property)) : value,
                  easing: { type: 'ease-out' },
                  operation: liveTrack?.operation ?? 'set',
                  baseValue: liveTrack?.baseValue ?? baseValue(shape, property),
                  delayMs: liveTrack?.delayMs,
                  durationMs: Math.max(liveTrack?.durationMs ?? 0, timeMs, 1)
                })
              }
              if (next) useCanvasShapeStore.getState().setMotionDocument(next, 'motion-inspector-keyframe')
            }}
          >
            <Diamond className="h-2.5 w-2.5" fill={keyframe ? 'currentColor' : 'none'} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
