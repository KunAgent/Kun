import type { PetCursorSample, ScreenPoint } from '../../shared/pets'
import type { Rect } from './pet-geometry'

export type PetCursorTarget = {
  petCenter: ScreenPoint
  workArea: Rect
  mascotWidth: number
}

type Options = {
  cursor: () => ScreenPoint
  placement: () => PetCursorTarget | null
  isTypingActive: () => boolean
  isOverlayInteractive?: () => boolean
  publish: (sample: PetCursorSample) => void
  now?: () => number
}

const ACTIVE_INTERVAL_MS = 33
const IDLE_WATCH_MS = 120
const GAZE_IDLE_MS = 2400
const DESK_HOLD_MS = 6000

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
const round3 = (value: number): number => Math.round(value * 1000) / 1000

/** Permissionless cursor sampling with anti-jitter deadzone and zero-IPC idle sleep. */
export class PetCursorTracker {
  private enabled = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastPoint: ScreenPoint | null = null
  private lastSampleAt = 0
  private lastMovedAt = 0
  private deskActiveAt = 0
  private travelPx = 0
  private wasActive = false
  private wasOverMascot = false
  private wheelSeq = 0
  private wheelDir: -1 | 0 | 1 = 0
  private clickSeq = 0
  private clickMask = 0
  private clickedAt = 0
  private readonly buttonSources = new Map<number, number>()
  private readonly now: () => number

  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now
  }

  private get buttons(): number {
    let mask = 0
    for (const value of this.buttonSources.values()) mask |= value
    return mask & 7
  }

  configure(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    if (!enabled) {
      this.stop()
      return
    }
    this.lastPoint = null
    this.lastSampleAt = 0
    this.travelPx = 0
    this.schedule(ACTIVE_INTERVAL_MS)
  }

  noteMouse(senderId: number, buttons: number, wheel: -1 | 0 | 1, globalActive: boolean): void {
    if (!this.enabled) return
    if (senderId >= 0 && globalActive) return
    const prevButtons = this.buttons
    const hadButtons = prevButtons !== 0
    if (buttons === 0) this.buttonSources.delete(senderId)
    else {
      if (!this.buttonSources.has(senderId) && this.buttonSources.size >= 16) {
        this.buttonSources.delete(this.buttonSources.keys().next().value!)
      }
      this.buttonSources.set(senderId, buttons & 7)
    }
    if (globalActive) {
      for (const key of this.buttonSources.keys()) if (key >= 0) this.buttonSources.delete(key)
    }
    const now = this.now()
    if (wheel !== 0) {
      this.wheelSeq += 1
      this.wheelDir = wheel
    }
    const newlyPressed = this.buttons & ~prevButtons
    const target = this.options.placement()
    const pt = this.options.cursor()
    const overlayInteractive = this.options.isOverlayInteractive?.() === true
    if (target && !overlayInteractive) {
      const petZone = Math.max(132, target.mascotWidth * 1.22)
      const overPet = Math.hypot(pt.x - target.petCenter.x, pt.y - target.petCenter.y) < petZone
      if (!overPet && newlyPressed !== 0) {
        this.clickSeq += 1
        this.clickMask = newlyPressed
        this.clickedAt = now
      }
      if (!overPet && (buttons !== 0 || wheel !== 0 || hadButtons)) {
        this.deskActiveAt = now
        this.lastMovedAt = now
      }
    }
    this.emitSample(pt, target, now, true)
    this.schedule(ACTIVE_INTERVAL_MS)
  }

  dispose(): void {
    this.enabled = false
    this.stop()
  }

  private stop(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.buttonSources.clear()
    this.lastPoint = null
    this.wasActive = false
    this.wasOverMascot = false
    this.travelPx = 0
  }

  private schedule(delayMs: number): void {
    clearTimeout(this.timer)
    if (!this.enabled) return
    this.timer = setTimeout(() => this.tick(), delayMs)
    this.timer.unref?.()
  }

  private tick(): void {
    if (!this.enabled) return
    const now = this.now()
    const target = this.options.placement()
    if (!target) {
      this.schedule(IDLE_WATCH_MS)
      return
    }
    const pt = this.options.cursor()
    const dt = this.lastSampleAt > 0 ? Math.max(0, now - this.lastSampleAt) : ACTIVE_INTERVAL_MS
    this.lastSampleAt = now
    let moved = false
    if (!this.lastPoint) {
      this.lastPoint = { x: pt.x, y: pt.y }
    } else {
      const step = Math.hypot(pt.x - this.lastPoint.x, pt.y - this.lastPoint.y)
      if (step >= 2) {
        this.lastPoint = { x: pt.x, y: pt.y }
        this.lastMovedAt = now
        moved = true
        const overlayInteractive = this.options.isOverlayInteractive?.() === true
        const distToPet = Math.hypot(pt.x - target.petCenter.x, pt.y - target.petCenter.y)
        const overPet = overlayInteractive || distToPet < Math.max(132, target.mascotWidth * 1.22)
        if (overPet) {
          this.travelPx = 0
        } else {
          this.travelPx = this.travelPx * Math.exp(-Math.min(500, dt) / 180) + step
          const deskOpen = this.deskActiveAt > 0 && now - this.deskActiveAt < DESK_HOLD_MS
          const typing = this.options.isTypingActive()
          const threshold = typing
            ? Math.max(130, target.workArea.width * 0.08)
            : Math.max(92, target.workArea.width * 0.055)
          if (this.travelPx >= threshold || (deskOpen && !typing && step >= 5)) {
            this.deskActiveAt = now
          }
        }
      } else {
        this.travelPx *= Math.exp(-Math.min(500, dt) / 180)
      }
    }

    const overMascot = isOverMascot(pt, target)
    const active = (this.lastMovedAt > 0 && now - this.lastMovedAt <= GAZE_IDLE_MS) || this.buttons !== 0 || overMascot
    if ((active && moved) || (this.wasActive && !active) || overMascot !== this.wasOverMascot) {
      this.emitSample(pt, target, now, active)
    }
    this.wasActive = active
    this.wasOverMascot = overMascot
    this.schedule(active ? ACTIVE_INTERVAL_MS : IDLE_WATCH_MS)
  }

  private emitSample(pt: ScreenPoint, target: PetCursorTarget | null, _now: number, active: boolean): void {
    if (!target) return
    const nx = round3(clamp((pt.x - target.workArea.x) / Math.max(1, target.workArea.width), 0, 1))
    const ny = round3(clamp((pt.y - target.workArea.y) / Math.max(1, target.workArea.height), 0, 1))
    let gx = 0
    let gy = 0
    if (active) {
      const eyeY = target.petCenter.y - target.mascotWidth * 0.06
      const rx = (pt.x - target.petCenter.x) / 240
      const ry = (pt.y - eyeY) / 200
      const mag = Math.hypot(rx, ry)
      const gain = mag > 0.001 ? Math.tanh(mag * 0.85) / mag : 0
      gx = round3(rx * gain)
      gy = round3(ry * gain)
    }
    const overMascot = isOverMascot(pt, target)
    const mascotHeight = target.mascotWidth * (208 / 192)
    this.wasActive = active
    this.wasOverMascot = overMascot
    this.options.publish({
      nx,
      ny,
      gx,
      gy,
      buttons: this.buttons,
      wheelSeq: this.wheelSeq,
      wheelDir: this.wheelDir,
      ...(this.clickSeq > 0 ? { clickSeq: this.clickSeq, clickMask: this.clickMask, clickedAt: this.clickedAt } : {}),
      deskActiveAt: this.deskActiveAt,
      active,
      ...(overMascot ? {
        overMascot: true,
        localX: round3(clamp((pt.x - target.petCenter.x) / Math.max(1, target.mascotWidth * 0.5), -1.2, 1.2)),
        localY: round3(clamp((pt.y - target.petCenter.y) / Math.max(1, mascotHeight * 0.5), -1.2, 1.2))
      } : {})
    })
  }
}

function isOverMascot(pt: ScreenPoint, target: PetCursorTarget): boolean {
  const mascotHeight = target.mascotWidth * (208 / 192)
  const dx = pt.x - target.petCenter.x
  const dy = pt.y - target.petCenter.y
  return Math.abs(dx) <= target.mascotWidth * 0.52 && dy >= -mascotHeight * 0.52 && dy <= mascotHeight * 0.54
}
