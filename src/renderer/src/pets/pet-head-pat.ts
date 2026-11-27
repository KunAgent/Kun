const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v))

export type HeadPatParticle = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  duration: number
  phase: number
  kind: 'heart' | 'blue-heart' | 'drop'
}

export type HeadPatFrame = {
  active: boolean
  squint: number
  purrDeg: number
  purrShiftPx: number
  scaleX: number
  scaleY: number
  moving: boolean
  particles: readonly HeadPatParticle[]
}

const MIN_STROKE = 0.13

function resolvePetKind(petId?: string | null): 'xiao-kun' | 'ikun' | 'whale-girl' | 'kurocat' | 'custom' {
  if (!petId) return 'custom'
  if (petId === 'xiao-kun' || petId.endsWith(':xiao-kun')) return 'xiao-kun'
  if (petId === 'ikun' || petId.endsWith(':ikun')) return 'ikun'
  if (petId === 'whale-girl' || petId.endsWith(':whale-girl')) return 'whale-girl'
  if (petId === 'kurocat' || petId.endsWith(':kurocat') || petId.startsWith('kurocat:')) return 'kurocat'
  return 'custom'
}

/** Row-0 closed/happy-squint sprite column verified against each built-in pet's spritesheet. */
export function happyFrameColumn(petId?: string | null): number {
  const kind = resolvePetKind(petId)
  return kind === 'xiao-kun' || kind === 'whale-girl' || kind === 'kurocat' ? 3 : 2
}

export function isHeadPatZone(relX: number, relY: number): boolean {
  return Math.abs(relX) <= 0.88 && relY >= -0.98 && relY <= 0.36
}

/** KuroCat-style back-and-forth / circular head-rub & gentle pat tracker. */
export class PetHeadPatTracker {
  private energy = 0
  private squint = 0
  private handX = 0
  private overHead = false
  private lastRelX: number | null = null
  private lastRelY: number | null = null
  private anchorX: number | null = null
  private anchorY: number | null = null
  private dirX = 0
  private dirY = 0
  private strokeTravel = 0
  private reverseTravel = 0
  private strokeCount = 0
  private lastStepAt: number | null = null
  private lastSpawnAt = -Infinity
  private onWake: (() => void) | null = null
  private readonly particles: HeadPatParticle[] = []

  setWake(fn: (() => void) | null): () => void {
    this.onWake = fn
    return () => {
      if (this.onWake === fn) this.onWake = null
    }
  }

  isActive(): boolean {
    return this.energy > 0.16 || this.squint > 0.12
  }

  reset(): void {
    this.energy = 0
    this.squint = 0
    this.overHead = false
    this.resetStrokes()
    this.particles.length = 0
  }

  leave(): void {
    this.overHead = false
    this.resetStrokes()
  }

  private resetStrokes(): void {
    this.lastRelX = null
    this.lastRelY = null
    this.anchorX = null
    this.anchorY = null
    this.dirX = 0
    this.dirY = 0
    this.strokeTravel = 0
    this.reverseTravel = 0
    this.strokeCount = 0
  }

  noteMove(relX: number, relY: number, buttons: number, now: number, petId?: string | null): boolean {
    if (buttons !== 0 || !isHeadPatZone(relX, relY)) {
      this.overHead = false
      this.resetStrokes()
      return this.isActive()
    }
    this.overHead = true
    if (this.lastRelX !== null && this.lastRelY !== null) {
      const dx = relX - this.lastRelX
      const dy = relY - this.lastRelY
      const dist = Math.hypot(dx, dy)
      if (dist > 0.012 && dist < 1.3) {
        if (this.anchorX === null || this.anchorY === null) {
          this.anchorX = this.lastRelX
          this.anchorY = this.lastRelY
        }
        if (this.dirX === 0 && this.dirY === 0) {
          const vx = relX - this.anchorX
          const vy = relY - this.anchorY
          const seg = Math.hypot(vx, vy)
          if (seg >= MIN_STROKE) {
            this.dirX = vx / seg
            this.dirY = vy / seg
            this.strokeTravel = seg
            this.reverseTravel = 0
          }
        } else {
          const ux = dx / dist
          const uy = dy / dist
          const dot = ux * this.dirX + uy * this.dirY
          if (dot >= 0.42) {
            this.strokeTravel += dist
            this.reverseTravel = Math.max(0, this.reverseTravel - dist * 0.45)
          } else {
            this.reverseTravel += dist
            if (this.strokeTravel >= MIN_STROKE && this.reverseTravel >= MIN_STROKE) {
              this.strokeCount += 1
              this.dirX = ux
              this.dirY = uy
              this.strokeTravel = this.reverseTravel
              this.reverseTravel = 0
              this.anchorX = this.lastRelX
              this.anchorY = this.lastRelY
            }
          }
        }

        if (this.strokeCount >= 1) {
          const wasActive = this.isActive()
          this.energy = clamp(Math.max(this.energy, 0.56) + dist * 1.35, 0, 1)
          if (now - this.lastSpawnAt >= 210) {
            this.lastSpawnAt = now
            this.spawnParticles(relX, 1, petId)
          }
          if (!wasActive) this.onWake?.()
        }
      }
    } else {
      this.anchorX = relX
      this.anchorY = relY
    }
    this.lastRelX = relX
    this.lastRelY = relY
    return this.isActive()
  }

  noteTap(relX: number, relY: number, now: number, petId?: string | null): boolean {
    if (Math.abs(relX) > 0.95 || relY < -1.0 || relY > 0.62) return this.isActive()
    this.overHead = true
    this.strokeCount = Math.max(1, this.strokeCount)
    this.lastRelX = relX
    this.lastRelY = relY
    this.energy = clamp(Math.max(this.energy + 0.48, 0.66), 0, 1)
    this.lastSpawnAt = now
    this.spawnParticles(relX, 2, petId)
    this.onWake?.()
    return true
  }

  private spawnParticles(relX: number, count: number, petId?: string | null): void {
    const kind = resolvePetKind(petId)
    const crownY = kind === 'ikun' ? 20 : kind === 'xiao-kun' ? 28 : kind === 'kurocat' ? 36 : kind === 'whale-girl' ? 44 : 34
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= 10) this.particles.shift()
      const roll = Math.random()
      const pKind: HeadPatParticle['kind'] = kind === 'whale-girl'
        ? (roll < 0.45 ? 'blue-heart' : roll < 0.78 ? 'heart' : 'drop')
        : 'heart'
      this.particles.push({
        x: 96 + clamp(relX, -0.65, 0.65) * 26 + (Math.random() - 0.5) * 30,
        y: crownY + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 18,
        vy: -34 - Math.random() * 18,
        size: 6.2 + Math.random() * 2.6,
        life: 1,
        duration: 0.85 + Math.random() * 0.28,
        phase: Math.random() * Math.PI * 2,
        kind: pKind
      })
    }
  }

  step(now: number, reduced: boolean): HeadPatFrame {
    const rawDt = this.lastStepAt === null ? 1 / 60 : Math.max(0, now - this.lastStepAt) / 1000
    this.lastStepAt = now
    const dt = Math.min(rawDt, 0.05)

    this.energy = Math.max(0, this.energy - dt * (this.overHead ? 0.28 : 0.92))
    const wantSquint = this.energy > 0.16 ? 1 : 0
    if (reduced || rawDt > 0.6) {
      this.squint = wantSquint
      if (reduced) this.particles.length = 0
    } else {
      this.squint += (wantSquint - this.squint) * (1 - Math.exp(-14 * dt))
      if (this.squint < 0.008 && wantSquint === 0) this.squint = 0
    }

    const targetHandX = this.overHead && this.lastRelX !== null ? clamp(this.lastRelX, -0.85, 0.85) : 0
    this.handX += (targetHandX - this.handX) * (1 - Math.exp(-12 * dt))

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.x += (p.vx + Math.sin(now * 0.01 + p.phase) * 14) * dt
      p.y += p.vy * dt
      p.life -= dt / p.duration
      if (p.life <= 0) this.particles.splice(i, 1)
    }

    const s = this.squint
    const purrDeg = !reduced && s > 0.02 ? this.handX * 4.2 * s + Math.sin(now * 0.015) * 2.3 * s : 0
    const purrShiftPx = !reduced && s > 0.05 ? Math.sin(now * 0.022) * 0.85 * s : 0
    const scaleX = 1 + (!reduced ? (0.028 + Math.sin(now * 0.02) * 0.012) * s : 0)
    const scaleY = 1 - (!reduced ? (0.024 + Math.sin(now * 0.02) * 0.01) * s : 0)
    const moving = !reduced && (this.energy > 0.005 || s > 0.008 || this.particles.length > 0)

    return {
      active: s >= 0.26,
      squint: s,
      purrDeg,
      purrShiftPx,
      scaleX,
      scaleY,
      moving,
      particles: this.particles
    }
  }
}

export function drawHeadPatOverlay(
  ctx: CanvasRenderingContext2D,
  petId: string | null | undefined,
  width: number,
  height: number,
  frame: HeadPatFrame
): boolean {
  if (frame.squint <= 0.04 && frame.particles.length === 0) return false
  const kind = resolvePetKind(petId)
  ctx.save()
  ctx.scale(width / 192, height / 208)

  if (frame.squint > 0.06) {
    const blush = clamp(frame.squint, 0, 1)
    const cheeks = kind === 'whale-girl'
      ? [{ x: 84.5, y: 102.5, rx: 5.4, ry: 3.0 }, { x: 105.0, y: 102.5, rx: 5.4, ry: 3.0 }]
      : kind === 'xiao-kun'
        ? [{ x: 41.2, y: 125.5, rx: 10.5, ry: 7.4 }, { x: 118.8, y: 130.5, rx: 10.5, ry: 7.4 }]
        : kind === 'ikun'
          ? [
              { x: 80.9, y: 114.6, rx: 7.4, ry: 5.2 },
              { x: 132.5, y: 114.6, rx: 7.0, ry: 5.0 },
              { x: 93.2, y: 42.5, rx: 2.8, ry: 2.0 },
              { x: 107.2, y: 41.0, rx: 2.8, ry: 2.0 }
            ]
          : kind === 'kurocat'
            ? [{ x: 66.0, y: 78.5, rx: 7.4, ry: 4.4 }, { x: 114.0, y: 78.5, rx: 7.4, ry: 4.4 }]
            : [{ x: 68, y: 112, rx: 7.5, ry: 4.5 }, { x: 124, y: 112, rx: 7.5, ry: 4.5 }]

    for (let idx = 0; idx < cheeks.length; idx++) {
      const ch = cheeks[idx]
      const grad = ctx.createRadialGradient(ch.x, ch.y, 0.6, ch.x, ch.y, ch.rx)
      grad.addColorStop(0, `rgba(255, 102, 144, ${(blush * 0.46).toFixed(3)})`)
      grad.addColorStop(0.58, `rgba(255, 134, 168, ${(blush * 0.22).toFixed(3)})`)
      grad.addColorStop(1, 'rgba(255, 140, 170, 0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.ellipse(ch.x, ch.y, ch.rx, ch.ry, 0, 0, Math.PI * 2)
      ctx.fill()

      if (blush > 0.42 && idx < 2) {
        const lineA = clamp((blush - 0.42) / 0.48, 0, 1) * 0.42
        const span = ch.rx * 0.34
        ctx.strokeStyle = `rgba(232, 78, 124, ${lineA.toFixed(3)})`
        ctx.lineWidth = kind === 'whale-girl' ? 0.95 : 1.25
        ctx.lineCap = 'round'
        ctx.beginPath()
        for (const ox of [-span, 0, span]) {
          ctx.moveTo(ch.x + ox - 0.8, ch.y + 1.5)
          ctx.lineTo(ch.x + ox + 0.9, ch.y - 1.4)
        }
        ctx.stroke()
      }
    }
  }

  for (const p of frame.particles) {
    const enter = clamp((1 - p.life) / 0.16, 0, 1)
    const fade = clamp(p.life / 0.42, 0, 1)
    const alpha = enter * fade
    if (alpha <= 0.02) continue
    ctx.save()
    ctx.globalAlpha *= alpha
    ctx.translate(p.x, p.y)
    const sc = (0.72 + 0.32 * enter) * (p.size / 7.5)
    ctx.scale(sc, sc)
    if (p.kind === 'drop') {
      drawDroplet(ctx)
    } else {
      drawHeart(ctx, p.kind === 'blue-heart' ? '#5cc8ff' : '#ff6f96', p.kind === 'blue-heart' ? '#2563eb' : '#d63b6a')
    }
    ctx.restore()
  }

  ctx.restore()
  return true
}

function drawHeart(ctx: CanvasRenderingContext2D, fill: string, stroke: string): void {
  ctx.fillStyle = fill
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1.15
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(0, 4.2)
  ctx.bezierCurveTo(-6.2, -0.4, -7.2, -5.8, -3.5, -6.6)
  ctx.bezierCurveTo(-1.3, -7.1, 0, -5.2, 0, -3.8)
  ctx.bezierCurveTo(0, -5.2, 1.3, -7.1, 3.5, -6.6)
  ctx.bezierCurveTo(7.2, -5.8, 6.2, -0.4, 0, 4.2)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)'
  ctx.beginPath()
  ctx.arc(-2.6, -4.4, 1.1, 0, Math.PI * 2)
  ctx.fill()
}

function drawDroplet(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#7ad7ff'
  ctx.strokeStyle = '#2c7be5'
  ctx.lineWidth = 1.05
  ctx.beginPath()
  ctx.moveTo(0, -5.8)
  ctx.bezierCurveTo(3.8, -1.2, 4.2, 3.6, 0, 4.6)
  ctx.bezierCurveTo(-4.2, 3.6, -3.8, -1.2, 0, -5.8)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)'
  ctx.beginPath()
  ctx.arc(-1.1, 0.8, 0.95, 0, Math.PI * 2)
  ctx.fill()
}
