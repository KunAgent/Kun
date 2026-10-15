/**
 * Canvas glyph field behind the Code home: a faint grid of monospace characters
 * whose density follows smooth noise, plus click ripples. A ripple's crest
 * scrambles, lifts and tints the glyphs it crosses (and rewrites them for
 * good); the trough behind it erases the field, which then fills back in.
 *
 * The resting field is painted once to an offscreen canvas. While ripples are
 * alive each frame blits that base, erases the trough with one radial gradient
 * per ripple and redraws only the cells inside the crest rings, so a frame
 * costs a few hundred glyphs and an idle field costs no frames at all.
 */

const GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
/** Front travel time; the trough then takes `REFILL_MS` to fill back in. */
const TRAVEL_MS = 1700
const REFILL_MS = 1100
const MAX_RIPPLES = 6
const ECHO_RADIUS = 0.58

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

type Ripple = { id: number; x: number; y: number; startedAt: number; reach: number }
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

function signedDistance(px: number, py: number, box: ClearBox): number {
  const qx = Math.abs(px - box.cx) - box.hw
  const qy = Math.abs(py - box.cy) - box.hh
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0)
}

function radiusAt(ripple: Ripple, age: number): number {
  return ripple.reach * easeOut(Math.min(1, age / TRAVEL_MS))
}

function bandAt(age: number): number {
  return 18 + 34 * Math.min(1, age / TRAVEL_MS)
}

/** Crest strength 0..1 at distance `d`: the main front plus a fainter echo ring. */
export function crestStrength(ripple: Ripple, d: number, age: number): number {
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

/** How much of the resting field the trough erases at distance `d` (0..0.9). */
export function troughDepth(ripple: Ripple, d: number, age: number): number {
  const q = d / ripple.reach
  if (q >= 1) return 0
  const since = age - TRAVEL_MS * (1 - Math.cbrt(1 - q))
  if (since <= 0) return 0
  return 0.9 * (1 - 0.55 * q) * smoothstep(0, 90, since) * (1 - smoothstep(0, REFILL_MS, since - 90))
}

export function rippleLifetimeMs(): number {
  return TRAVEL_MS + REFILL_MS + 140
}

export class GlyphRippleField {
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly base = document.createElement('canvas')
  private readonly baseCtx = this.base.getContext('2d')
  private colors: GlyphFieldColors = { ink: '#20242d', accent: '#5b78ff', dark: false }
  private ripples: Ripple[] = []
  private rippleSeq = 0
  private frameHandle = 0
  private width = 0
  private height = 0
  private cellWidth = 6.6
  private cols = 0
  private rows = 0
  private glyph = new Uint8Array(0)
  private level = new Float32Array(0)
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
   * so moving the clear boxes (a taller composer) only repaints the base.
   */
  layout(width: number, height: number, pixelRatio: number, clear: readonly GlyphClearRect[], colors: GlyphFieldColors): void {
    const ctx = this.ctx
    const baseCtx = this.baseCtx
    if (!ctx || !baseCtx || width < 1 || height < 1) return
    this.colors = colors
    this.width = width
    this.height = height
    const backingWidth = Math.max(1, Math.round(width * pixelRatio))
    const backingHeight = Math.max(1, Math.round(height * pixelRatio))
    for (const target of [this.canvas, this.base]) {
      if (target.width !== backingWidth) target.width = backingWidth
      if (target.height !== backingHeight) target.height = backingHeight
    }
    for (const context of [ctx, baseCtx]) {
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
      this.tint = new Uint8Array(size)
      this.stamp = new Int32Array(size)
      this.mark = new Int32Array(size)
    }
    this.veil = new Float32Array(size)
    const boxes: ClearBox[] = clear.map((rect) => ({
      cx: rect.x + rect.width / 2,
      cy: rect.y + rect.height / 2,
      hw: rect.width / 2 + rect.pad,
      hh: rect.height / 2 + rect.pad,
      feather: rect.feather
    }))
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const index = r * cols + c
        const x = (c + 0.5) * this.cellWidth
        const y = (r + 0.5) * LINE_HEIGHT
        if (!sameGrid) {
          this.glyph[index] = Math.floor(hash(c, r, SEED + 3) * GLYPHS.length)
          this.level[index] = 0.14 + 0.86 * smoothstep(0.4, 0.8, fbm(x / 150, y / 126, SEED))
          this.tint[index] = fbm(x / 230 + 40, y / 196, SEED + 29) > 0.64 && hash(c, r, SEED + 5) < 0.6 ? 1 : 0
        }
        let veil = 1
        for (const box of boxes) veil = Math.min(veil, smoothstep(0, box.feather, signedDistance(x, y, box)))
        this.veil[index] = veil
      }
    }
    this.paintBase()
    this.draw(performance.now())
  }

  /** Recolour without touching the grid (theme or palette switch). */
  recolor(colors: GlyphFieldColors): void {
    if (colors.ink === this.colors.ink && colors.accent === this.colors.accent && colors.dark === this.colors.dark) return
    this.colors = colors
    this.paintBase()
    this.draw(performance.now())
  }

  ripple(x: number, y: number): void {
    if (this.cols === 0) return
    const reach = Math.max(360, Math.min(780, Math.hypot(this.width, this.height) * 0.55))
    this.ripples.push({ id: ++this.rippleSeq, x, y, startedAt: performance.now(), reach })
    if (this.ripples.length > MAX_RIPPLES) this.ripples.shift()
    this.start()
  }

  stop(): void {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle)
    this.frameHandle = 0
  }

  /** Stop and give the backing stores back; the next `layout` rebuilds them. */
  release(): void {
    this.stop()
    this.ripples = []
    for (const target of [this.canvas, this.base]) {
      target.width = 0
      target.height = 0
    }
    this.cols = 0
    this.rows = 0
  }

  private start(): void {
    if (this.frameHandle) return
    const tick = (): void => {
      this.frameHandle = 0
      if (this.draw(performance.now())) this.frameHandle = requestAnimationFrame(tick)
    }
    this.frameHandle = requestAnimationFrame(tick)
  }

  private alphaScale(index: number): number {
    const dark = this.colors.dark
    const tinted = this.tint[index] === 1
    return tinted ? (dark ? 0.26 : 0.32) : (dark ? 0.1 : 0.15)
  }

  private baseAlpha(index: number): number {
    return this.level[index] * this.veil[index] * this.alphaScale(index)
  }

  private paintGlyph(context: CanvasRenderingContext2D, glyph: number, c: number, r: number, dx: number, dy: number): void {
    context.fillText(GLYPHS[glyph] ?? 'a', c * this.cellWidth + dx, r * LINE_HEIGHT + (LINE_HEIGHT - FONT_SIZE) / 2 + dy)
  }

  private paintBaseCell(index: number, clear: boolean): void {
    const context = this.baseCtx
    if (!context) return
    const c = index % this.cols
    const r = (index / this.cols) | 0
    if (clear) context.clearRect(c * this.cellWidth - 0.5, r * LINE_HEIGHT, this.cellWidth + 1, LINE_HEIGHT)
    const alpha = this.baseAlpha(index)
    if (alpha < 0.01) return
    context.globalAlpha = Math.min(1, alpha)
    context.fillStyle = this.tint[index] ? this.colors.accent : this.colors.ink
    this.paintGlyph(context, this.glyph[index], c, r, 0, 0)
  }

  private paintBase(): void {
    const context = this.baseCtx
    if (!context) return
    context.clearRect(0, 0, this.width, this.height)
    for (let index = 0; index < this.cols * this.rows; index += 1) this.paintBaseCell(index, false)
    context.globalAlpha = 1
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
    ctx.drawImage(this.base, 0, 0, this.width, this.height)
    if (this.ripples.length === 0) return false

    ctx.globalCompositeOperation = 'destination-out'
    for (const ripple of this.ripples) {
      const age = now - ripple.startedAt
      const radius = radiusAt(ripple, age)
      if (radius < 2) continue
      const gradient = ctx.createRadialGradient(ripple.x, ripple.y, 0, ripple.x, ripple.y, radius)
      for (let stop = 0; stop <= 12; stop += 1) {
        gradient.addColorStop(stop / 12, `rgba(0,0,0,${troughDepth(ripple, (radius * stop) / 12, age).toFixed(3)})`)
      }
      ctx.fillStyle = gradient
      ctx.fillRect(ripple.x - radius, ripple.y - radius, radius * 2, radius * 2)
    }
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
    const crestAlpha = this.colors.dark ? 0.9 : 0.95
    this.bold.length = 0
    for (const index of this.ring) {
      const c = index % this.cols
      const r = (index / this.cols) | 0
      const x = (c + 0.5) * this.cellWidth
      const y = (r + 0.5) * LINE_HEIGHT
      let crest = 0
      let keep = 1
      let ux = 0
      let uy = 0
      let strongest: Ripple | null = null
      for (const ripple of this.ripples) {
        const age = now - ripple.startedAt
        const d = Math.hypot(x - ripple.x, y - ripple.y)
        const strength = crestStrength(ripple, d, age)
        keep *= 1 - troughDepth(ripple, d, age)
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
      const alpha = this.baseAlpha(index) * keep + crest * crestAlpha * Math.pow(this.veil[index], 0.6)
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
    for (const index of this.rewritten) this.paintBaseCell(index, true)
    if (this.baseCtx) this.baseCtx.globalAlpha = 1
    return true
  }
}
