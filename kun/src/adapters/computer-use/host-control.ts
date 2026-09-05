/**
 * Host computer-use executor: captures the screen and injects mouse /
 * keyboard input on the host OS via `@computer-use/nut-js` (the same
 * native automation library shipped by UI-TARS-desktop) plus `jimp` for
 * downscaling screenshots.
 *
 * Both are optional native dependencies. They are loaded lazily through
 * runtime specifiers so the kun package typechecks and runs even when the
 * modules are absent or fail to build for the current platform — in that
 * case the computer_use capability simply reports itself unavailable.
 *
 * Coordinate convention: screenshots are downscaled to a bounded display
 * size and that size is reported to the model. The model returns
 * coordinates in that display-pixel space; we map them back to the OS's
 * logical-point space (DPI/Retina aware) before driving the cursor.
 */

export type HostControlAvailability = {
  available: boolean
  reason?: string
  backend?: 'cua' | 'legacy'
  driverVersion?: string
  contractVersion?: string
}

export type HostFrameDescriptor = {
  frameId: string
  sessionId: string
  capturedAtMs: number
  image: { width: number; height: number; mimeType: string }
  nativeDesktop: { width: number; height: number; scaleX: number; scaleY: number }
  coordinateSpace: 'kun-frame-v1'
}

export type HostActionContext = {
  sessionId?: string
  frameId?: string
  signal?: AbortSignal
}

export type HostScreenshot = {
  mimeType: string
  dataBase64: string
  /** Width/height of the returned image; the coordinate space for actions. */
  width: number
  height: number
  frame?: HostFrameDescriptor
}

export type HostActionResult = {
  degraded?: boolean
  errorCode?: string
  structured?: unknown
  verification?: unknown
}

export type ScrollDirection = 'up' | 'down' | 'left' | 'right'
export type MouseButton = 'left' | 'right' | 'middle'

export interface HostControlController {
  ensureReady(): Promise<HostControlAvailability>
  shutdown?(): Promise<void>
  screenSize(context?: HostActionContext): Promise<{ width: number; height: number }>
  capture(context?: HostActionContext): Promise<HostScreenshot>
  cursorPosition(context?: HostActionContext): Promise<{ x: number; y: number }>
  moveTo(x: number, y: number, context?: HostActionContext): Promise<HostActionResult | void>
  click(
    x?: number,
    y?: number,
    button?: MouseButton,
    count?: 1 | 2,
    modifiers?: string[],
    context?: HostActionContext
  ): Promise<HostActionResult | void>
  drag(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    context?: HostActionContext
  ): Promise<HostActionResult | void>
  scroll(
    x: number | undefined,
    y: number | undefined,
    direction: ScrollDirection,
    amount?: number,
    context?: HostActionContext
  ): Promise<HostActionResult | void>
  typeText(text: string, context?: HostActionContext): Promise<HostActionResult | void>
  pressHotkey(keyStr: string, context?: HostActionContext): Promise<HostActionResult | void>
  wait(ms: number, signal?: AbortSignal): Promise<void>
}

type ScreenContext = {
  logicalWidth: number
  logicalHeight: number
  scaleX: number
  scaleY: number
}

// Minimal surface of @computer-use/nut-js that we depend on. Loaded as
// `any` via a runtime specifier so the module is a pure optional dep.
type NutImage = {
  toRGB(): Promise<{ data: ArrayBufferLike; width: number; height: number; pixelDensity: { scaleX: number; scaleY: number } }>
  toBGR(): Promise<{ width: number; height: number; pixelDensity: { scaleX: number; scaleY: number } }>
}
type NutPoint = unknown
type NutApi = {
  screen: { grab(): Promise<NutImage> }
  mouse: {
    move(target: unknown): Promise<unknown>
    click(button: unknown): Promise<unknown>
    doubleClick(button: unknown): Promise<unknown>
    drag(target: unknown): Promise<unknown>
    scrollUp(amount: number): Promise<unknown>
    scrollDown(amount: number): Promise<unknown>
    scrollLeft(amount: number): Promise<unknown>
    scrollRight(amount: number): Promise<unknown>
    getPosition(): Promise<{ x: number; y: number }>
  }
  keyboard: {
    type(text: string): Promise<unknown>
    pressKey(...keys: unknown[]): Promise<unknown>
    releaseKey(...keys: unknown[]): Promise<unknown>
    config: { autoDelayMs: number }
  }
  clipboard?: { getContent(): Promise<string>; setContent(text: string): Promise<unknown> }
  Button: { LEFT: unknown; RIGHT: unknown; MIDDLE: unknown }
  Key: Record<string, unknown>
  Point: new (x: number, y: number) => NutPoint
  straightTo(point: NutPoint): unknown
  sleep(ms: number): Promise<void>
}

type JimpImage = { resize(opts: { w: number; h: number }): JimpImage; getBuffer(mime: string): Promise<Buffer> }
type JimpModule = { Jimp: { fromBitmap(bitmap: { width: number; height: number; data: Buffer }): Promise<JimpImage> } }

export type HostControllerOptions = {
  /** Longest screenshot edge in pixels; larger captures are downscaled. */
  maxImageDimension?: number
  /** Screenshot mime type returned to the model. */
  imageMimeType?: 'image/png' | 'image/jpeg'
}

const DEFAULT_MAX_IMAGE_DIMENSION = 1280
// nut.js scroll steps per model-requested "wheel click".
const SCROLL_UNITS_PER_CLICK = 3

/**
 * Compute the downscaled display size reported to the model: the long
 * edge is capped to `maxDimension`, aspect ratio preserved. `scale` is
 * the factor from logical points to display pixels (≤ 1).
 */
export function computeDisplayDims(
  logicalWidth: number,
  logicalHeight: number,
  maxDimension: number
): { width: number; height: number; scale: number } {
  const longest = Math.max(logicalWidth, logicalHeight)
  const scale = longest > maxDimension ? maxDimension / longest : 1
  return {
    width: Math.max(1, Math.round(logicalWidth * scale)),
    height: Math.max(1, Math.round(logicalHeight * scale)),
    scale
  }
}

/**
 * Map a coordinate the model produced in display-pixel space back to the
 * OS's logical-point space, clamped to the screen bounds.
 */
export function mapDisplayToLogical(
  x: number,
  y: number,
  logicalWidth: number,
  logicalHeight: number,
  maxDimension: number
): { x: number; y: number } {
  const display = computeDisplayDims(logicalWidth, logicalHeight, maxDimension)
  const lx = display.scale > 0 ? x / display.scale : x
  const ly = display.scale > 0 ? y / display.scale : y
  return {
    x: clamp(Math.round(lx), 0, Math.max(0, logicalWidth - 1)),
    y: clamp(Math.round(ly), 0, Math.max(0, logicalHeight - 1))
  }
}

async function loadModule<T>(specifier: string): Promise<T | null> {
  try {
    // Indirect specifier keeps this a runtime-only (optional) dependency.
    const mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>
    // Both @computer-use/nut-js and jimp expose their API as named exports
    // on the namespace; merge any CJS `default` underneath so the named
    // exports win regardless of the module's interop shape.
    const def = mod.default
    if (def && typeof def === 'object') {
      return { ...(def as Record<string, unknown>), ...mod } as T
    }
    return mod as unknown as T
  } catch {
    return null
  }
}

export class HostController implements HostControlController {
  private nut: NutApi | null = null
  private jimp: JimpModule | null = null
  private loadAttempted = false
  private loadReason?: string
  private screen: ScreenContext | null = null
  private readonly maxDimension: number
  private readonly imageMimeType: 'image/png' | 'image/jpeg'

  constructor(options: HostControllerOptions = {}) {
    this.maxDimension = Math.max(320, Math.floor(options.maxImageDimension ?? DEFAULT_MAX_IMAGE_DIMENSION))
    this.imageMimeType = options.imageMimeType ?? 'image/png'
  }

  async ensureReady(): Promise<HostControlAvailability> {
    if (!this.loadAttempted) {
      this.loadAttempted = true
      const nut = await loadModule<NutApi>('@computer-use/nut-js')
      const jimp = await loadModule<JimpModule>('jimp')
      if (!nut || typeof nut.screen?.grab !== 'function') {
        this.loadReason = 'native automation module @computer-use/nut-js is not installed for this platform'
      } else if (!jimp || typeof jimp.Jimp?.fromBitmap !== 'function') {
        this.loadReason = 'image module jimp is not installed'
      } else {
        this.nut = nut
        this.jimp = jimp
        nut.keyboard.config.autoDelayMs = 0
      }
    }
    return this.nut && this.jimp
      ? { available: true }
      : { available: false, reason: this.loadReason ?? 'computer-use backend is unavailable' }
  }

  private requireNut(): NutApi {
    if (!this.nut) throw new Error(this.loadReason ?? 'computer-use backend is unavailable')
    return this.nut
  }

  private async screenContext(): Promise<ScreenContext> {
    if (this.screen) return this.screen
    const nut = this.requireNut()
    const grab = await nut.screen.grab()
    const bgr = await grab.toBGR()
    return this.setScreenFromFrame(bgr.width, bgr.height, bgr.pixelDensity)
  }

  /**
   * Derive (and cache) the logical screen geometry from a freshly grabbed
   * frame. Called on every capture so a mid-session resolution change,
   * monitor hot-plug, or scale-factor change cannot desync the reported
   * dimensions and the coordinate mapping from the image the model sees.
   */
  private setScreenFromFrame(
    physicalWidth: number,
    physicalHeight: number,
    pixelDensity: { scaleX: number; scaleY: number } | undefined
  ): ScreenContext {
    const scaleX = pixelDensity?.scaleX || 1
    const scaleY = pixelDensity?.scaleY || 1
    this.screen = {
      logicalWidth: Math.max(1, Math.round(physicalWidth / scaleX)),
      logicalHeight: Math.max(1, Math.round(physicalHeight / scaleY)),
      scaleX,
      scaleY
    }
    return this.screen
  }

  /** Deterministic downscaled display size for the current screen. */
  private displayDims(ctx: ScreenContext): { width: number; height: number; scale: number } {
    return computeDisplayDims(ctx.logicalWidth, ctx.logicalHeight, this.maxDimension)
  }

  /** Map a coordinate in display-image space to OS logical points. */
  private async toLogical(x: number, y: number): Promise<{ x: number; y: number }> {
    const ctx = await this.screenContext()
    return mapDisplayToLogical(x, y, ctx.logicalWidth, ctx.logicalHeight, this.maxDimension)
  }

  async screenSize(): Promise<{ width: number; height: number }> {
    const ctx = await this.screenContext()
    const display = this.displayDims(ctx)
    return { width: display.width, height: display.height }
  }

  async capture(): Promise<HostScreenshot> {
    const nut = this.requireNut()
    const jimp = this.jimp!
    const grab = await nut.screen.grab()
    const rgb = await grab.toRGB()
    // Re-derive geometry from THIS frame so the reported size and the
    // coordinate mapping always match the image the model is about to see.
    const ctx = this.setScreenFromFrame(rgb.width, rgb.height, rgb.pixelDensity)
    const display = this.displayDims(ctx)
    const image = await jimp.Jimp.fromBitmap({
      width: rgb.width,
      height: rgb.height,
      data: Buffer.from(rgb.data)
    })
    const buffer = await image.resize({ w: display.width, h: display.height }).getBuffer(this.imageMimeType)
    return {
      mimeType: this.imageMimeType,
      dataBase64: buffer.toString('base64'),
      width: display.width,
      height: display.height
    }
  }

  async cursorPosition(): Promise<{ x: number; y: number }> {
    const nut = this.requireNut()
    const ctx = await this.screenContext()
    const display = this.displayDims(ctx)
    const pos = await nut.mouse.getPosition()
    return {
      x: clamp(Math.round(pos.x * display.scale), 0, display.width - 1),
      y: clamp(Math.round(pos.y * display.scale), 0, display.height - 1)
    }
  }

  async moveTo(x: number, y: number): Promise<void> {
    const nut = this.requireNut()
    const point = await this.toLogical(x, y)
    await nut.mouse.move(nut.straightTo(new nut.Point(point.x, point.y)))
  }

  async click(
    x: number | undefined,
    y: number | undefined,
    button: MouseButton = 'left',
    count: 1 | 2 = 1,
    modifiers: string[] = []
  ): Promise<void> {
    const nut = this.requireNut()
    if (typeof x === 'number' && typeof y === 'number') {
      await this.moveTo(x, y)
      await nut.sleep(80)
    }
    const nutButton = button === 'right' ? nut.Button.RIGHT : button === 'middle' ? nut.Button.MIDDLE : nut.Button.LEFT
    const modKeys = modifiers.length ? this.resolveKeys(modifiers.join('+')) : []
    if (modKeys.length) await nut.keyboard.pressKey(...modKeys)
    try {
      if (count === 2) await nut.mouse.doubleClick(nutButton)
      else await nut.mouse.click(nutButton)
    } finally {
      if (modKeys.length) await nut.keyboard.releaseKey(...modKeys)
    }
  }

  async drag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
    const nut = this.requireNut()
    await this.moveTo(x1, y1)
    await nut.sleep(100)
    const end = await this.toLogical(x2, y2)
    await nut.mouse.drag(nut.straightTo(new nut.Point(end.x, end.y)))
  }

  async scroll(
    x: number | undefined,
    y: number | undefined,
    direction: ScrollDirection,
    amount = 3
  ): Promise<void> {
    const nut = this.requireNut()
    if (typeof x === 'number' && typeof y === 'number') {
      await this.moveTo(x, y)
    }
    // nut.js scroll units are roughly one wheel notch each; the model's
    // scroll_amount is "wheel clicks", so use a small per-click factor.
    // (The previous ×100 sent ~300 steps for a default scroll, overshooting
    // every target.)
    const ticks = Math.max(1, Math.round(amount)) * SCROLL_UNITS_PER_CLICK
    switch (direction) {
      case 'up':
        await nut.mouse.scrollUp(ticks)
        break
      case 'down':
        await nut.mouse.scrollDown(ticks)
        break
      case 'left':
        await nut.mouse.scrollLeft(ticks)
        break
      case 'right':
        await nut.mouse.scrollRight(ticks)
        break
    }
  }

  async typeText(text: string): Promise<void> {
    const nut = this.requireNut()
    if (!text) return
    const trailingNewline = /\n$/.test(text)
    const body = text.replace(/\n$/, '')
    if (process.platform === 'win32' && nut.clipboard) {
      const original = await safe(() => nut.clipboard!.getContent())
      await nut.clipboard.setContent(body)
      const paste = this.resolveKeys('ctrl+v')
      await nut.keyboard.pressKey(...paste)
      await nut.sleep(50)
      await nut.keyboard.releaseKey(...paste)
      await nut.sleep(50)
      if (typeof original === 'string') await safe(() => nut.clipboard!.setContent(original))
    } else {
      await nut.keyboard.type(body)
    }
    if (trailingNewline) await this.pressHotkey('return')
  }

  async pressHotkey(keyStr: string): Promise<void> {
    const nut = this.requireNut()
    const keys = this.resolveKeys(keyStr)
    if (keys.length === 0) throw new Error(`unsupported key combination: ${keyStr}`)
    await nut.keyboard.pressKey(...keys)
    await nut.keyboard.releaseKey(...keys)
  }

  async wait(ms: number, signal?: AbortSignal): Promise<void> {
    const clamped = Math.max(0, Math.min(ms, 60_000))
    if (clamped === 0 || signal?.aborted) return
    await new Promise<void>((resolve) => {
      const cleanup = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      const onAbort = (): void => {
        cleanup()
        resolve()
      }
      const timer = setTimeout(() => {
        cleanup()
        resolve()
      }, clamped)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Map a `+`/space separated key string to nut.js Key codes. */
  private resolveKeys(keyStr: string): unknown[] {
    const nut = this.requireNut()
    const cmd = process.platform === 'darwin' ? nut.Key.LeftCmd : nut.Key.LeftSuper
    const ctrl = nut.Key.LeftControl
    const aliases: Record<string, unknown> = {
      ctrl: ctrl,
      control: ctrl,
      shift: nut.Key.LeftShift,
      alt: nut.Key.LeftAlt,
      option: nut.Key.LeftAlt,
      meta: cmd,
      cmd: cmd,
      command: cmd,
      super: nut.Key.LeftSuper,
      win: nut.Key.LeftSuper,
      return: nut.Key.Enter,
      enter: nut.Key.Enter,
      esc: nut.Key.Escape,
      escape: nut.Key.Escape,
      del: nut.Key.Delete,
      delete: nut.Key.Delete,
      backspace: nut.Key.Backspace,
      tab: nut.Key.Tab,
      space: nut.Key.Space,
      up: nut.Key.Up,
      down: nut.Key.Down,
      left: nut.Key.Left,
      right: nut.Key.Right,
      arrowup: nut.Key.Up,
      arrowdown: nut.Key.Down,
      arrowleft: nut.Key.Left,
      arrowright: nut.Key.Right,
      pagedown: nut.Key.PageDown,
      pageup: nut.Key.PageUp,
      home: nut.Key.Home,
      end: nut.Key.End,
      ',': nut.Key.Comma,
      '.': nut.Key.Period,
      // Punctuation whose Key-enum name does not match its literal char.
      '-': nut.Key.Minus,
      '=': nut.Key.Equal,
      '/': nut.Key.Slash,
      ';': nut.Key.Semicolon,
      "'": nut.Key.Quote,
      '[': nut.Key.LeftBracket,
      ']': nut.Key.RightBracket,
      '\\': nut.Key.Backslash,
      '`': nut.Key.Grave
    }
    const lowerKeyTable: Record<string, unknown> = {}
    for (const [name, code] of Object.entries(nut.Key)) lowerKeyTable[name.toLowerCase()] = code
    const tokens = keyStr
      .split(/[\s+]+/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
    const resolved: unknown[] = []
    for (const part of tokens) {
      const code = aliases[part] ?? lowerKeyTable[part] ?? lowerKeyTable[`num${part}`]
      // Fail loud: a partially-resolved chord (e.g. "ctrl+/" losing the "/")
      // would otherwise silently fire only its modifier — a wrong action.
      if (code === undefined) {
        throw new Error(`unsupported key token "${part}" in combination "${keyStr}"`)
      }
      resolved.push(code)
    }
    return resolved
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.max(min, Math.min(max, value))
}

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch {
    return undefined
  }
}
