import { useEffect, useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactElement } from 'react'
import type { PetCursorSample, PetOverlayBootstrap, PetSessionStatus } from '@shared/pets'
import type { PetTypingState } from '@shared/pets-typing'
import { usePetAnimationPainter } from '../use-pet-animation-painter'
import { KuroCatEngine } from './kurocat-engine'
import '../joint/joint-stage.css'

export function isKuroCatBootstrap(bootstrap: PetOverlayBootstrap | null | undefined): boolean {
  if (!bootstrap?.petId) return false
  return bootstrap.petId === 'kun:kurocat' || bootstrap.petId.startsWith('kurocat:') || Boolean(bootstrap.kurocatSkin)
}

export function kuroCatStageSize(
  bootstrap: PetOverlayBootstrap | null | undefined,
  mascotWidth: number,
  viewport: { width: number; height: number }
): { width: number; height: number } {
  const is108 = bootstrap?.kurocatPrefs?.keyboardLayout === '108'
  const rawW = Math.round(mascotWidth * (is108 ? 2.48 : 2.04))
  const rawH = Math.round(mascotWidth * (is108 ? 1.98 : 1.96))
  return {
    width: Math.min(Math.max(180, viewport.width - 16), Math.max(is108 ? 256 : 220, rawW)),
    height: Math.min(Math.max(180, viewport.height - 32), Math.max(204, rawH))
  }
}

export function KuroCatStage(props: {
  pet: PetOverlayBootstrap
  typing?: PetTypingState
  cursor?: PetCursorSample | null
  business: PetSessionStatus
  dragging: boolean
  dragVelX: number
  width: number
  height: number
  language: string
  menuOpen: boolean
  actorEvents: ButtonHTMLAttributes<HTMLButtonElement>
  onTapStage?: (localStageX: number, localStageY: number) => void
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hitRef = useRef<HTMLButtonElement | null>(null)
  const engineRef = useRef<KuroCatEngine | null>(null)
  if (!engineRef.current) engineRef.current = new KuroCatEngine()
  const engine = engineRef.current

  useLayoutEffect(() => {
    engine.setAppearance(props.pet.petId, props.pet.kurocatSkin, props.pet.kurocatPrefs)
  }, [engine, props.pet.petId, props.pet.kurocatSkin, props.pet.kurocatPrefs])

  useLayoutEffect(() => {
    engine.syncWorkState(props.business, Date.now())
  }, [engine, props.business])

  useLayoutEffect(() => {
    engine.setDragging(props.dragging, props.dragVelX, Date.now())
  }, [engine, props.dragging, props.dragVelX])

  const wake = usePetAnimationPainter(`kurocat:${props.pet.petId}:${props.width}:${props.height}`, false, ({ reduced }) => {
    const canvas = canvasRef.current
    if (!canvas) return 50
    const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 2))
    const targetW = Math.max(1, Math.round(props.width * dpr))
    const targetH = Math.max(1, Math.round(props.height * dpr))
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return 80
    const now = Date.now()
    const active = engine.stepAndRender(ctx, props.width, props.height, dpr, now, reduced)
    if (hitRef.current) {
      hitRef.current.style.clipPath = `path('${engine.hitPathCss(props.width, props.height)}')`
    }
    if (active) return
    return 55
  })

  useLayoutEffect(() => {
    const now = Date.now()
    engine.syncTyping(props.typing, now)
    wake()
  }, [engine, props.typing, wake])

  useLayoutEffect(() => {
    const now = Date.now()
    engine.syncCursor(props.cursor, now)
    if (props.cursor?.overMascot) {
      engine.noteLocalHover(props.cursor.localX, props.cursor.localY, true, props.cursor.buttons, now)
    } else {
      engine.noteLocalHover(undefined, undefined, false, 0, now)
    }
    wake()
  }, [engine, props.cursor, wake])

  useEffect(() => () => {
    engine.setDragging(false, 0)
  }, [engine])

  const opacity = props.pet.kurocatPrefs?.opacity ?? 1
  const pointerStart = useRef<{ x: number; y: number } | null>(null)

  return (
    <div
      className="pet-reaction-stage pet-kurocat-stage"
      data-pet-reaction="kurocat-desk"
      data-ready="true"
      style={{ width: props.width, height: props.height, opacity }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: props.width, height: props.height, pointerEvents: 'none' }}
        aria-hidden="true"
      />
      <button
        {...props.actorEvents}
        ref={hitRef}
        type="button"
        className="pet-joint-hit"
        aria-label={`${props.pet.displayName ?? 'KuroCat'} · ${props.language.startsWith('zh') ? '原版桌台陪伴' : 'KuroCat desk companion'}`}
        aria-haspopup="menu"
        aria-expanded={props.menuOpen}
        aria-controls={props.menuOpen ? 'pet-context-menu' : undefined}
        onPointerDown={(event) => {
          pointerStart.current = { x: event.clientX, y: event.clientY }
          props.actorEvents.onPointerDown?.(event)
        }}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const lx = ((event.clientX - box.left) / Math.max(1, box.width)) * 2 - 1
          const ly = ((event.clientY - box.top) / Math.max(1, box.height)) * 2 - 1
          engine.noteLocalHover(lx, ly, true, event.buttons, Date.now())
          wake()
          props.actorEvents.onPointerMove?.(event)
        }}
        onPointerUp={(event) => {
          const start = pointerStart.current
          pointerStart.current = null
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4 && event.button === 0) {
            const box = event.currentTarget.getBoundingClientRect()
            engine.noteTap(event.clientX - box.left, event.clientY - box.top, props.width, props.height, Date.now())
            wake()
          }
          props.actorEvents.onPointerUp?.(event)
        }}
      />
    </div>
  )
}
