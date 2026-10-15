/**
 * Canvas glyph field behind the Code home. At rest only a few faint patches
 * of monospace characters show; the glyphs keep flickering and the patches
 * drift. A click sends a ripple: its crest scrambles, lifts and rewrites the
 * glyphs it crosses, and behind it the whole field lights up, then settles
 * back to the sparse resting patches.
 *
 * Three canvases: the visible one, an offscreen `base` (resting patches) and
 * an offscreen `dense` (every glyph at its lit strength). A ripple frame masks
 * `dense` with one radial gradient per ripple, slides `base` underneath, and
 * redraws only the cells inside the crest rings. The ambient tick (10 Hz)
 * repaints only the cells it changes, then blits `base`.
 */

const GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
/** Front travel time; the lit wake then fades by `LIT_END_MS` after the front passed. */
const TRAVEL_MS = 1700
const LIT_START_MS = 60
const LIT_FULL_MS = 260
const LIT_FADE_FROM_MS = 500
const LIT_END_MS = 2400
const MAX_RIPPLES = 6
const ECHO_RADIUS = 0.58
const AMBIENT_TICK_MS = 110
/** Share of all cells re-rolled per ambient tick. */
const FLICKER_SHARE = 0.04
/** The drift recomputes this share of rows per tick, so the field turns over about once a second. */
const DRIFT_ROW_SHARE = 0.1

export type GlyphFieldColors = {
  ink: string
  accent: string
  dark: boolean
}

/** A box (in field coordinates) the glyphs fade away from, so copy stays clean. */
export type GlyphClearRect = {
  x: number
  y: number
  width: number
  height: number
  pad: number
  feather: number
}

export type GlyphRipple = { id: number; x: number; y: number; startedAt: number; reach: number }
type ClearBox = { cx: number; cy: number; hw: number; hh: number; feather: number }

const FONT_SIZE = 11
const LINE_HEIGHT = 15
const SEED = 7
/** Crest glyphs at or above this strength are drawn in the bold pass. */
const BOLD_CREST = 0.42
const fontFor = (weight: number): string => `${weight} ${FONT_SIZE}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`

function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const smooth = (t: number): number => t * t * (3 - 2 * t)
const smoothstep = (a: number, b: number, x: number): number =>
  smooth(Math.min(1, Math.max(0, (x - a) / (b - a))))
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3)

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = smooth(x - xi)
  const v = smooth(y - yi)
  const a = hash(xi, yi, seed)
  const b = hash(xi + 1, yi, seed)
  const c = hash(xi, yi + 1, seed)
  const d = hash(xi + 1, yi + 1, seed)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function fbm(x: number, y: number, seed: number): number {
  return valueNoise(x, y, seed) * 0.62 + valueNoise(x * 2.03 + 11.3, y * 2.03 + 5.7, seed + 17) * 0.38
}

/** Resting strength 0..1 at a point and time (seconds): two noise layers drifting apart. */
export function restingLevel(x: number, y: number, seconds: number): number {
  const n = 0.62 * fbm(x / 150 + seconds * 0.018, y / 126 + seconds * 0.006, SEED) +
    0.38 * fbm(x / 96 - seconds * 0.014, y / 88 + seconds * 0.011, SEED + 9)
  // About a fifth of the cells clear the floor; only the densest few reach full strength.
  return smoothstep(0.585, 0.7, n)
}

function signedDistance(px: number, py: number, box: ClearBox): number {
  const qx = Math.abs(px - box.cx) - box.hw
  const qy = Math.abs(py - box.cy) - box.hh
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0)
}

function radiusAt(ripple: GlyphRipple, age: number): number {
  return ripple.reach * easeOut(Math.min(1, age / TRAVEL_MS))
}

function bandAt(age: number): number {
  return 18 + 34 * Math.min(1, age / TRAVEL_MS)
}

/** Crest strength 0..1 at distance `d`: the main front plus a fainter echo ring. */
export function crestStrength(ripple: GlyphRipple, d: number, age: number): number {
  const progress = Math.min(1, age / TRAVEL_MS)
  if (progress >= 1 || age < 0) return 0
  const radius = radiusAt(ripple, age)
  const band = bandAt(age)
  const amplitude = Math.pow(1 - progress, 1.3)
  let crest = 0
  const front = Math.abs(d - radius)
  if (front < band) crest = (1 - front / band) ** 2 * amplitude
  const echoBand = band * 0.7
  const echo = Math.abs(d - radius * ECHO_RADIUS)
  if (echo < echoBand) crest = Math.max(crest, (1 - echo / echoBand) ** 2 * amplitude * 0.42)
  return crest
}

/** How lit the dense field is at distance `d`: rises just behind the front, then fades. */
export function litStrength(ripple: GlyphRipple, d: number, age: number): number {
  const q = d / ripple.reach
  if (q >= 1) return 0
  const since = age - TRAVEL_MS * (1 - Math.cbrt(1 - q))
  if (since <= 0) return 0
  return (1 - 0.45 * q) * smoothstep(LIT_START_MS, LIT_FULL_MS, since) *
    (1 - smoothstep(LIT_FADE_FROM_MS, LIT_END_MS, since))
}

export function rippleLifetimeMs(): number {
  return TRAVEL_MS + LIT_END_MS + 100
}

export class GlyphRippleField {
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly base = document.createElement('canvas')
  private readonly baseCtx = this.base.getContext('2d')
  private readonly dense = document.createElement('canvas')
  private readonly denseCtx = this.dense.getContext('2d')
  private colors: GlyphFieldColors = { ink: '#20242d', accent: '#5b78ff', dark: false }
  private ripples: GlyphRipple[] = []
  private rippleSeq = 0
  private frameHandle = 0
  private ambientTimer = 0
  private readonly epoch = performance.now()
  private driftRow = 0
  private width = 0
  private height = 0
  private cellWidth = 6.6
  private cols = 0
  private rows = 0
  private glyph = new Uint8Array(0)
  private level = new Float32Array(0)
  private grain = new Float32Array(0)
  private tint = new Uint8Array(0)
  private veil = new Float32Array(0)
  private stamp = new Int32Array(0)
  private mark = new Int32Array(0)
  private markSeq = 0
  private readonly ring: number[] = []
  private readonly rewritten: number[] = []
  /** Bold-pass glyphs, five numbers each: cell, glyph, alpha, dx, dy. */
  private readonly bold: number[] = []

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')
  }

  get active(): boolean {
    return this.ripples.length > 0
  }

  /**
   * Size the field to `width`×`height` field units drawn at `pixelRatio`
   * backing pixels per unit. Glyphs survive when the grid size is unchanged,
   * so moving the clear boxes (a taller composer) only repaints.
   */
  layout(width: number, height: number, pixelRatio: number, clear: readonly GlyphClearRect[], colors: GlyphFieldColors): void {
    const ctx = this.ctx
    if (!ctx || !this.baseCtx || !this.denseCtx || width < 1 || height < 1) return
    this.colors = colors
    this.width = width
    this.height = height
    const backingWidth = Math.max(1, Math.round(width * pixelRatio))
    const backingHeight = Math.max(1, Math.round(height * pixelRatio))
    for (const target of [this.canvas, this.base, this.dense]) {
      if (target.width !== backingWidth) target.width = backingWidth
      if (target.height !== backingHeight) target.height = backingHeight
    }
    for (const context of [ctx, this.baseCtx, this.denseCtx]) {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.font = fontFor(500)
      context.textBaseline = 'top'
    }
    this.cellWidth = Math.max(4, ctx.measureText('M').width + 0.4)
    const cols = Math.ceil(width / this.cellWidth)
    const rows = Math.ceil(height / LINE_HEIGHT)
    const size = cols * rows
    const sameGrid = cols === this.cols && rows === this.rows
    this.cols = cols
    this.rows = rows
    if (!sameGrid) {
      this.glyph = new Uint8Array(size)
      this.level = new Float32Array(size)
      this.grain = new Float32Array(size)
      this.tint = new Uint8Array(size)
      this.stamp = new Int32Array(size)
      this.mark = new Int32Array(size)
      this.driftRow = 0
    }
    this.veil = new Float32Array(size)
    const boxes: ClearBox[] = clear.map((rect) => ({
      cx: rect.x + rect.width / 2,
      cy: rect.y + rect.height / 2,
      hw: rect.width / 2 + rect.pad,
      hh: rect.height / 2 + rect.pad,
      feather: rect.feather
    }))
    const seconds = this.seconds()
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const index = r * cols + c
        const x = (c + 0.5) * this.cellWidth
        const y = (r + 0.5) * LINE_HEIGHT
        if (!sameGrid) {
          this.glyph[index] = Math.floor(hash(c, r, SEED + 3) * GLYPHS.length)
          this.level[index] = restingLevel(x, y, seconds)
          this.grain[index] = 0.45 + 0.55 * hash(c, r, SEED + 41)
          this.tint[index] = fbm(x / 230 + 40, y / 196, SEED + 29) > 0.64 && hash(c, r, SEED + 5) < 0.55 ? 1 : 0
        }
        let veil = 1
        for (const box of boxes) veil = Math.min(veil, smoothstep(0, box.feather, signedDistance(x, y, box)))
        this.veil[index] = veil
      }
    }
    this.paintAll()
  }

  /** Recolour without touching the grid (theme or palette switch). */
  recolor(colors: GlyphFieldColors): void {
    if (colors.ink === this.colors.ink && colors.accent === this.colors.accent && colors.dark === this.colors.dark) return
    this.colors = colors
    this.paintAll()
  }

  ripple(x: number, y: number): void {
    if (this.cols === 0) return
    const reach = Math.max(360, Math.min(780, Math.hypot(this.width, this.height) * 0.55))
    this.ripples.push({ id: ++this.rippleSeq, x, y, startedAt: performance.now(), reach })
    if (this.ripples.length > MAX_RIPPLES) this.ripples.shift()
    this.start()
  }

  /** The resting flicker and drift; off while hidden, off-screen or under reduced motion. */
  setAmbient(enabled: boolean): void {
    if (enabled === Boolean(this.ambientTimer)) return
    if (!enabled) {
      window.clearInterval(this.ambientTimer)
      this.ambientTimer = 0
      return
    }
    this.ambientTimer = window.setInterval(() => this.ambientTick(), AMBIENT_TICK_MS)
  }

  stop(): void {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle)
    this.frameHandle = 0
    this.setAmbient(false)
  }

  /** Stop and give the backing stores back; the next `layout` rebuilds them. */
  release(): void {
    this.stop()
    this.ripples = []
    for (const target of [this.canvas, this.base, this.dense]) {
      target.width = 0
      target.height = 0
    }
    this.cols = 0
    this.rows = 0
  }

  private seconds(): number {
    return (performance.now() - this.epoch) / 1000
  }

  private start(): void {
    if (this.frameHandle) return
    const tick = (): void => {
      this.frameHandle = 0
      if (this.draw(performance.now())) this.frameHandle = requestAnimationFrame(tick)
    }
    this.frameHandle = requestAnimationFrame(tick)
  }

  private restAlpha(index: number): number {
    const dark = this.colors.dark
    const scale = this.tint[index] ? (dark ? 0.22 : 0.26) : (dark ? 0.09 : 0.13)
    return this.level[index] * this.veil[index] * scale
  }

  private litAlpha(index: number): number {
    const dark = this.colors.dark
    const scale = this.tint[index] ? (dark ? 0.3 : 0.34) : (dark ? 0.15 : 0.21)
    return this.grain[index] * this.veil[index] * scale
  }

  private paintGlyph(context: CanvasRenderingContext2D, glyph: number, c: number, r: number, dx: number, dy: number): void {
    context.fillText(GLYPHS[glyph] ?? 'a', c * this.cellWidth + dx, r * LINE_HEIGHT + (LINE_HEIGHT - FONT_SIZE) / 2 + dy)
  }

  /** Paint one cell into `context` at `alpha`; `clear` first wipes its box. */
  private paintCell(context: CanvasRenderingContext2D, index: number, alpha: number, clear: boolean): void {
    const c = index % this.cols
    const r = (index / this.cols) | 0
    if (clear) context.clearRect(c * this.cellWidth - 0.5, r * LINE_HEIGHT, this.cellWidth + 1, LINE_HEIGHT)
    if (alpha < 0.01) return
    context.globalAlpha = Math.min(1, alpha)
    context.fillStyle = this.tint[index] ? this.colors.accent : this.colors.ink
    this.paintGlyph(context, this.glyph[index], c, r, 0, 0)
  }

  private paintAll(): void {
    const base = this.baseCtx
    const dense = this.denseCtx
    if (!base || !dense) return
    base.clearRect(0, 0, this.width, this.height)
    dense.clearRect(0, 0, this.width, this.height)
    for (let index = 0; index < this.cols * this.rows; index += 1) {
      this.paintCell(base, index, this.restAlpha(index), false)
      this.paintCell(dense, index, this.litAlpha(index), false)
    }
    base.globalAlpha = 1
    dense.globalAlpha = 1
    this.draw(performance.now())
  }

  private ambientTick(): void {
    const base = this.baseCtx
    const dense = this.denseCtx
    if (!base || !dense || this.cols === 0) return
    // Drift: recompute a band of rows from the moving noise and repaint them.
    const seconds = this.seconds()
    const band = Math.max(1, Math.ceil(this.rows * DRIFT_ROW_SHARE))
    for (let step = 0; step < band; step += 1) {
      const r = (this.driftRow + step) % this.rows
      base.clearRect(0, r * LINE_HEIGHT, this.width, LINE_HEIGHT)
      for (let c = 0; c < this.cols; c += 1) {
        const index = r * this.cols + c
        this.level[index] = restingLevel((c + 0.5) * this.cellWidth, (r + 0.5) * LINE_HEIGHT, seconds)
        this.paintCell(base, index, this.restAlpha(index), false)
      }
    }
    this.driftRow = (this.driftRow + band) % this.rows
    // Flicker: re-roll a few glyphs everywhere, in both layers.
    const size = this.cols * this.rows
    const flips = Math.ceil(size * FLICKER_SHARE)
    for (let n = 0; n < flips; n += 1) {
      const index = Math.floor(Math.random() * size)
      this.glyph[index] = Math.floor(Math.random() * GLYPHS.length)
      this.paintCell(base, index, this.restAlpha(index), true)
      this.paintCell(dense, index, this.litAlpha(index), true)
    }
    base.globalAlpha = 1
    dense.globalAlpha = 1
    if (!this.frameHandle) this.draw(performance.now())
  }

  /** Mark and collect the cells whose centres lie in the ring [inner, outer]. */
  private collectRing(cx: number, cy: number, inner: number, outer: number): void {
    if (outer <= 0) return
    const firstRow = Math.max(0, Math.floor((cy - outer) / LINE_HEIGHT))
    const lastRow = Math.min(this.rows - 1, Math.ceil((cy + outer) / LINE_HEIGHT))
    for (let r = firstRow; r <= lastRow; r += 1) {
      const dy = (r + 0.5) * LINE_HEIGHT - cy
      const span = Math.sqrt(Math.max(0, outer * outer - dy * dy))
      const firstCol = Math.max(0, Math.floor((cx - span) / this.cellWidth))
      const lastCol = Math.min(this.cols - 1, Math.ceil((cx + span) / this.cellWidth))
      for (let c = firstCol; c <= lastCol; c += 1) {
        const d = Math.hypot((c + 0.5) * this.cellWidth - cx, dy)
        if (d < inner || d > outer) continue
        const index = r * this.cols + c
        if (this.mark[index] === this.markSeq) continue
        this.mark[index] = this.markSeq
        this.ring.push(index)
      }
    }
  }

  /** Paint one frame; returns whether ripples are still alive. */
  private draw(now: number): boolean {
    const ctx = this.ctx
    if (!ctx || this.cols === 0) return false
    this.ripples = this.ripples.filter((ripple) => now - ripple.startedAt < rippleLifetimeMs())
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, this.width, this.height)
    if (this.ripples.length === 0) {
      ctx.drawImage(this.base, 0, 0, this.width, this.height)
      return false
    }

    // Lit wake: one gradient mask per ripple, filled with the dense field,
    // then the resting patches slid in underneath.
    for (const ripple of this.ripples) {
      const age = now - ripple.startedAt
      const radius = radiusAt(ripple, age)
      if (radius < 2) continue
      const gradient = ctx.createRadialGradient(ripple.x, ripple.y, 0, ripple.x, ripple.y, radius)
      for (let stop = 0; stop <= 20; stop += 1) {
        gradient.addColorStop(stop / 20, `rgba(0,0,0,${litStrength(ripple, (radius * stop) / 20, age).toFixed(3)})`)
      }
      ctx.fillStyle = gradient
      ctx.fillRect(ripple.x - radius, ripple.y - radius, radius * 2, radius * 2)
    }
    ctx.globalCompositeOperation = 'source-in'
    ctx.drawImage(this.dense, 0, 0, this.width, this.height)
    ctx.globalCompositeOperation = 'destination-over'
    ctx.drawImage(this.base, 0, 0, this.width, this.height)
    ctx.globalCompositeOperation = 'source-over'

    this.ring.length = 0
    this.markSeq += 1
    for (const ripple of this.ripples) {
      const age = now - ripple.startedAt
      if (age >= TRAVEL_MS) continue
      const radius = radiusAt(ripple, age)
      const band = bandAt(age)
      this.collectRing(ripple.x, ripple.y, radius - band, radius + band)
      this.collectRing(ripple.x, ripple.y, radius * ECHO_RADIUS - band * 0.7, radius * ECHO_RADIUS + band * 0.7)
    }
    for (const index of this.ring) {
      const c = index % this.cols
      const r = (index / this.cols) | 0
      ctx.clearRect(c * this.cellWidth - 0.5, r * LINE_HEIGHT, this.cellWidth + 1, LINE_HEIGHT)
    }
    this.rewritten.length = 0
    this.bold.length = 0
    const crestAlpha = this.colors.dark ? 0.9 : 0.95
    for (const index of this.ring) {
      const c = index % this.cols
      const r = (index / this.cols) | 0
      const x = (c + 0.5) * this.cellWidth
      const y = (r + 0.5) * LINE_HEIGHT
      let crest = 0
      let unlit = 1
      let ux = 0
      let uy = 0
      let strongest: GlyphRipple | null = null
      for (const ripple of this.ripples) {
        const age = now - ripple.startedAt
        const d = Math.hypot(x - ripple.x, y - ripple.y)
        const strength = crestStrength(ripple, d, age)
        unlit *= 1 - litStrength(ripple, d, age)
        if (strength > crest) {
          crest = strength
          strongest = ripple
          ux = d > 0.01 ? (x - ripple.x) / d : 0
          uy = d > 0.01 ? (y - ripple.y) / d : 0
        }
      }
      let glyph = this.glyph[index]
      if (strongest && crest > 0.3 && this.stamp[index] !== strongest.id) {
        this.stamp[index] = strongest.id
        this.glyph[index] = Math.floor(hash(index, strongest.id, 91) * GLYPHS.length)
        this.rewritten.push(index)
      }
      if (strongest && crest > 0.2) {
        glyph = Math.floor(hash(index, Math.floor((now - strongest.startedAt) / 70), strongest.id) * GLYPHS.length)
      }
      const alpha = this.restAlpha(index) + (1 - unlit) * this.litAlpha(index) +
        crest * crestAlpha * Math.pow(this.veil[index], 0.6)
      if (alpha < 0.01) continue
      const lift = crest * 3.5
      if (crest >= BOLD_CREST) {
        this.bold.push(index, glyph, Math.min(1, alpha), ux * lift, uy * lift)
        continue
      }
      ctx.globalAlpha = Math.min(1, alpha)
      ctx.fillStyle = crest > 0.08 || this.tint[index] ? this.colors.accent : this.colors.ink
      this.paintGlyph(ctx, glyph, c, r, ux * lift, uy * lift)
    }
    if (this.bold.length) {
      // The crest core: heavier ink glyphs, one font switch per frame.
      ctx.font = fontFor(700)
      ctx.fillStyle = this.colors.ink
      for (let k = 0; k < this.bold.length; k += 5) {
        const index = this.bold[k]
        ctx.globalAlpha = this.bold[k + 2]
        this.paintGlyph(ctx, this.bold[k + 1], index % this.cols, (index / this.cols) | 0, this.bold[k + 3], this.bold[k + 4])
      }
      ctx.font = fontFor(500)
    }
    ctx.globalAlpha = 1
    if (this.baseCtx && this.denseCtx) {
      for (const index of this.rewritten) {
        this.paintCell(this.baseCtx, index, this.restAlpha(index), true)
        this.paintCell(this.denseCtx, index, this.litAlpha(index), true)
      }
      this.baseCtx.globalAlpha = 1
      this.denseCtx.globalAlpha = 1
    }
    return true
  }
}
