import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactElement } from 'react'
import { PET_SHEET_COLUMNS, petSheetRowsForVersion, type PetAnimationState, type PetCursorSample, type PetSpriteVersion } from '@shared/pets'
import { drawSoloLiveEyes, loadSoloEyeOverlays, type PetEyeOverlaySet } from './joint/eye-layer'
import { createPetGazeMemory, stepPetGaze, type PetGazeMemory } from './typing/typing-motion'
import { frameAtElapsedMs, framePosition, nextFrameDelayMs, staticFrame } from './pet-animation'
import { petAudio } from './pet-audio'
import { drawHeadPatOverlay, happyFrameColumn, type PetHeadPatTracker } from './pet-head-pat'
import { paintPetStyle, usePetAnimationPainter } from './use-pet-animation-painter'

const BLEED_X = 0.14
const BLEED_TOP = 0.30

export function PetResidentSprite({
  animation,
  version,
  sheet,
  petId,
  cursor,
  gazeMemory,
  headPat,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  animation: PetAnimationState
  version: PetSpriteVersion
  sheet?: string | null
  petId?: string | null
  cursor?: PetCursorSample | null
  gazeMemory?: PetGazeMemory
  headPat?: PetHeadPatTracker
}): ReactElement {
  const actor = useRef<HTMLButtonElement>(null)
  const eyeCanvas = useRef<HTMLCanvasElement>(null)
  const overlays = useRef<PetEyeOverlaySet | undefined>(undefined)
  const [, setEyeReady] = useState(0)
  const localGaze = useRef<PetGazeMemory | null>(null)
  const overlayDrawn = useRef(false)
  const latestCursor = useRef(cursor)
  latestCursor.current = cursor

  useEffect(() => {
    let cancelled = false
    overlays.current = undefined
    if (!petId || !sheet) return undefined
    void loadSoloEyeOverlays(petId, sheet).then((loaded) => {
      if (!cancelled) {
        overlays.current = loaded
        setEyeReady((n) => n + 1)
      }
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [petId, sheet])

  const wake = usePetAnimationPainter(`${sheet}:${animation}:${version}:${petId ?? ''}`, false, ({ elapsed, reduced }) => {
    const now = Date.now()
    const baseFrame = reduced ? staticFrame(animation, version) : frameAtElapsedMs(animation, elapsed, version)
    const pat = animation === 'idle' && headPat ? headPat.step(now, reduced) : null
    const isCat = Boolean(petId && (petId === 'kurocat' || petId.endsWith(':kurocat')))
    petAudio.setPurrIntensity(pat?.squint ?? 0, isCat)
    const patActive = Boolean(pat?.active)
    const frame = patActive
      ? {
          row: 0,
          column: happyFrameColumn(petId),
          backgroundPosition: framePosition(0, happyFrameColumn(petId), petSheetRowsForVersion(version))
        }
      : baseFrame

    const canGaze = animation === 'idle' && !patActive && Boolean(petId && overlays.current)
    const memory = gazeMemory ?? (localGaze.current ??= createPetGazeMemory())
    const activeCursor = canGaze && latestCursor.current?.active ? latestCursor.current : null
    const gazeState = animation === 'idle'
      ? stepPetGaze(memory, activeCursor ? activeCursor.gx : 0, activeCursor ? activeCursor.gy : 0, 0, 0, now, reduced)
      : null

    const totalDeg = (gazeState ? gazeState.headTilt * (180 / Math.PI) * (1 - (pat?.squint ?? 0)) : 0) + (pat?.purrDeg ?? 0)
    const shiftX = pat?.purrShiftPx ?? 0
    const sx = pat?.scaleX ?? 1
    const sy = pat?.scaleY ?? 1
    const hasTransform = Math.abs(totalDeg) > 0.08 || Math.abs(shiftX) > 0.04 || Math.abs(sx - 1) > 0.002 || Math.abs(sy - 1) > 0.002
    paintPetStyle(actor.current, {
      backgroundPosition: frame.backgroundPosition,
      transform: hasTransform
        ? `translate3d(${shiftX.toFixed(2)}px, 0, 0) rotate(${totalDeg.toFixed(2)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`
        : 'none'
    })

    const canvas = eyeCanvas.current
    if (canvas && actor.current) {
      const wantEyes = canGaze && Boolean(gazeState && frame.row === 0 && (frame.column === 0 || frame.column === 5))
      const wantPat = Boolean(pat && (pat.squint > 0.04 || pat.particles.length > 0))
      if (wantEyes || wantPat) {
        const w = actor.current.clientWidth || parseFloat(String(props.style?.width ?? 112)) || 112
        const h = actor.current.clientHeight || Math.round(w * 208 / 192)
        const cw = w * (1 + BLEED_X * 2)
        const ch = h * (1 + BLEED_TOP)
        const ratio = Math.min(2, window.devicePixelRatio || 1)
        const pw = Math.max(1, Math.round(cw * ratio)), ph = Math.max(1, Math.round(ch * ratio))
        if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph }
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.clearRect(0, 0, pw, ph)
          ctx.setTransform(ratio, 0, 0, ratio, w * BLEED_X * ratio, h * BLEED_TOP * ratio)
          let drew = false
          if (wantEyes && gazeState) {
            drew = drawSoloLiveEyes(ctx, overlays.current, frame.column, w, h, gazeState.gaze) || drew
          }
          if (wantPat && pat) {
            drew = drawHeadPatOverlay(ctx, petId, w, h, pat) || drew
          }
          overlayDrawn.current = drew
        }
      } else if (overlayDrawn.current) {
        const ctx = canvas.getContext('2d')
        ctx?.setTransform(1, 0, 0, 1, 0, 0)
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
        overlayDrawn.current = false
      }
    }

    if (gazeState?.moving || pat?.moving) return
    return nextFrameDelayMs(animation, elapsed)
  })

  useEffect(() => headPat?.setWake(wake), [headPat, wake])
  useEffect(() => () => { petAudio.setPurrIntensity(0, true) }, [])

  return (
    <button
      {...props}
      ref={actor}
      style={{
        position: 'relative',
        transformOrigin: '50% 88%',
        ...props.style,
        backgroundImage: sheet ? `url("${sheet}")` : undefined,
        backgroundSize: `${PET_SHEET_COLUMNS * 100}% ${petSheetRowsForVersion(version) * 100}%`
      }}
    >
      <canvas
        ref={eyeCanvas}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: `-${BLEED_X * 100}%`,
          top: `-${BLEED_TOP * 100}%`,
          width: `${(1 + BLEED_X * 2) * 100}%`,
          height: `${(1 + BLEED_TOP) * 100}%`,
          pointerEvents: 'none'
        }}
      />
    </button>
  )
}
