import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type {
  HostActionContext,
  HostActionResult,
  HostControlAvailability,
  HostControlController,
  HostScreenshot,
  MouseButton,
  ScrollDirection as HostScrollDirection
} from '../../../kun/src/adapters/computer-use/host-control.js'
import type { CuaDriverLike, ToolResult } from '@trycua/cua-driver'
import { ComputerFrameError, ComputerFrameRegistry } from './computer-frame-registry'

const SESSION_TTL_SECONDS = 15 * 60
const IDLE_TTL_SECONDS = 5 * 60
const DEFAULT_MAX_IMAGE_DIMENSION = 1280
const MAX_STRUCTURED_JSON_BYTES = 32 * 1024
const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024

type DesktopState = {
  screenshot_width: number
  screenshot_height: number
  screen_width: number
  screen_height: number
  scale_factor: number
  screenshot_mime_type: string
}

type CuaSdk = typeof import('@trycua/cua-driver')

export class CuaDriverError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly needsFreshFrame = false
  ) {
    super(message)
  }
}

export class CuaDriverController implements HostControlController {
  private driver?: CuaDriverLike
  private sdk?: CuaSdk
  private readiness?: HostControlAvailability
  private readonly frames = new ComputerFrameRegistry()
  private readonly maxImageDimension: number
  private readonly sdkLoader: () => Promise<CuaSdk>

  constructor(options: {
    maxImageDimension?: number
    sdkLoader?: () => Promise<CuaSdk>
  } = {}) {
    this.sdkLoader = options.sdkLoader ?? loadCuaSdk
    this.maxImageDimension = Math.max(
      320,
      Math.floor(options.maxImageDimension ?? DEFAULT_MAX_IMAGE_DIMENSION)
    )
  }

  async ensureReady(): Promise<HostControlAvailability> {
    if (this.readiness?.available && this.driver) return this.readiness
    try {
      const sdk = await this.sdkLoader()
      const driver = sdk.CuaDriver.createConfigured({
        claudeCodeCompatibility: false,
        authorization: {
          allowedModes: [sdk.SessionPermissionMode.Standard],
          compatibilityMode: sdk.SessionPermissionMode.Standard,
          unrestrictedAcknowledged: false,
          maxSessionTtlSeconds: BigInt(SESSION_TTL_SECONDS),
          maxIdleTtlSeconds: BigInt(IDLE_TTL_SECONDS)
        }
      })
      if (!driver.isAvailable()) throw new Error('CUA Driver reported itself unavailable.')
      const metadata = await driver.metadata()
      this.sdk = sdk
      this.driver = driver
      this.readiness = {
        available: true,
        backend: 'cua',
        driverVersion: metadata.driverVersion,
        contractVersion: metadata.contractVersion
      }
      return this.readiness
    } catch (error) {
      this.readiness = {
        available: false,
        backend: 'cua',
        reason: safeErrorMessage(error)
      }
      return this.readiness
    }
  }

  async shutdown(): Promise<void> {
    const driver = this.driver
    this.driver = undefined
    this.sdk = undefined
    this.readiness = undefined
    if (!driver) return
    await driver.shutdown().catch(() => undefined)
    const destroyable = driver as unknown as { uniffiDestroy?: () => void }
    destroyable.uniffiDestroy?.()
  }

  async screenSize(context: HostActionContext = {}): Promise<{ width: number; height: number }> {
    const result = await this.requireDriver().getScreenSize(
      { session: context.sessionId },
      abortOptions(context.signal)
    )
    const value = structuredObject(result)
    return {
      width: positiveNumber(value.width, 'screen width'),
      height: positiveNumber(value.height, 'screen height')
    }
  }

  async capture(context: HostActionContext = {}): Promise<HostScreenshot> {
    const sessionId = requireSession(context)
    const result = await this.requireDriver().getDesktopState(
      { session: sessionId },
      abortOptions(context.signal)
    )
    assertToolSuccess(result)
    const image = result.images[0]
    if (!image) throw new CuaDriverError('capture_failed', 'CUA Driver returned no screenshot.')
    const source = Buffer.from(image.dataBase64, 'base64')
    if (source.byteLength > MAX_SCREENSHOT_BYTES) {
      throw new CuaDriverError('capture_too_large', 'CUA Driver screenshot exceeded the safe size limit.')
    }
    const desktop = parseDesktopState(result)
    const scaled = await scaleScreenshot(source, this.maxImageDimension)
    const frame = this.frames.register({
      sessionId,
      image: { width: scaled.width, height: scaled.height, mimeType: 'image/png' },
      nativeDesktop: {
        width: desktop.screen_width,
        height: desktop.screen_height,
        scaleX: desktop.screen_width / scaled.width,
        scaleY: desktop.screen_height / scaled.height
      }
    })
    return {
      mimeType: 'image/png',
      dataBase64: scaled.buffer.toString('base64'),
      width: scaled.width,
      height: scaled.height,
      frame
    }
  }

  async cursorPosition(context: HostActionContext = {}): Promise<{ x: number; y: number }> {
    const sessionId = requireSession(context)
    const result = await this.requireDriver().getCursorPosition(
      { session: sessionId },
      abortOptions(context.signal)
    )
    const value = structuredObject(result)
    const native = {
      x: finiteNumber(value.x, 'cursor x'),
      y: finiteNumber(value.y, 'cursor y')
    }
    const frame = this.frames.latest(sessionId)
    if (!frame) return native
    return {
      x: clamp(Math.round(native.x / frame.nativeDesktop.scaleX), 0, frame.image.width - 1),
      y: clamp(Math.round(native.y / frame.nativeDesktop.scaleY), 0, frame.image.height - 1)
    }
  }

  async moveTo(x: number, y: number, context: HostActionContext = {}): Promise<HostActionResult> {
    const resolved = this.resolvePoint(x, y, context)
    return this.project(await this.requireDriver().moveCursor({
      x: resolved.x,
      y: resolved.y,
      target: this.desktopTarget(),
      session: resolved.sessionId
    }, abortOptions(context.signal)))
  }

  async click(
    x: number | undefined,
    y: number | undefined,
    button: MouseButton = 'left',
    count: 1 | 2 = 1,
    modifiers: string[] = [],
    context: HostActionContext = {}
  ): Promise<HostActionResult> {
    if (modifiers.length > 0) {
      throw new CuaDriverError(
        'unsupported_modifier_click',
        'CUA Driver does not expose atomic modifier-click in this contract; the action was not executed.'
      )
    }
    if ((x === undefined) !== (y === undefined)) {
      throw new CuaDriverError('missing_coordinate', 'Click coordinates must include both x and y.')
    }
    const resolved = x === undefined || y === undefined
      ? await this.currentNativePoint(context)
      : this.resolvePoint(x, y, context)
    return this.project(await this.requireDriver().click({
      x: resolved.x,
      y: resolved.y,
      target: this.desktopTarget(),
      session: resolved.sessionId,
      button: this.clickButton(button),
      count
    }, abortOptions(context.signal)))
  }

  async drag(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    context: HostActionContext = {}
  ): Promise<HostActionResult> {
    const start = this.resolvePoint(x1, y1, context)
    const end = this.resolvePoint(x2, y2, { ...context, frameId: start.frameId })
    return this.project(await this.requireDriver().drag({
      fromX: start.x,
      fromY: start.y,
      toX: end.x,
      toY: end.y,
      target: this.desktopTarget(),
      session: start.sessionId,
      button: this.sdk!.ClickButton.Left
    }, abortOptions(context.signal)))
  }

  async scroll(
    x: number | undefined,
    y: number | undefined,
    direction: HostScrollDirection,
    amount = 3,
    context: HostActionContext = {}
  ): Promise<HostActionResult> {
    if ((x === undefined) !== (y === undefined)) {
      throw new CuaDriverError('missing_coordinate', 'Scroll coordinates must include both x and y.')
    }
    const resolved = x === undefined || y === undefined
      ? await this.currentNativePoint(context)
      : this.resolvePoint(x, y, context)
    return this.project(await this.requireDriver().scroll({
      x: resolved.x,
      y: resolved.y,
      direction: this.scrollDirection(direction),
      target: this.desktopTarget(),
      session: resolved.sessionId,
      by: this.sdk!.ScrollBy.Line,
      amount: BigInt(clamp(Math.round(amount), 1, 100))
    }, abortOptions(context.signal)))
  }

  async typeText(text: string, context: HostActionContext = {}): Promise<HostActionResult> {
    const sessionId = requireSession(context)
    return this.project(await this.requireDriver().typeText({
      text,
      target: this.desktopTarget(),
      session: sessionId
    }, abortOptions(context.signal)))
  }

  async pressHotkey(keyStr: string, context: HostActionContext = {}): Promise<HostActionResult> {
    const sessionId = requireSession(context)
    const keys = keyStr.split(/[\s+]+/u).map((value) => value.trim()).filter(Boolean)
    if (keys.length === 0) throw new CuaDriverError('unsupported_key', 'The key combination is empty.')
    return this.project(await this.requireDriver().hotkey({
      keys,
      target: this.desktopTarget(),
      session: sessionId
    }, abortOptions(context.signal)))
  }

  async wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, clamp(ms, 0, 60_000))
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })
  }

  private requireDriver(): CuaDriverLike {
    if (!this.driver) throw new CuaDriverError('driver_unavailable', 'CUA Driver is not ready.')
    return this.driver
  }

  private desktopTarget(): ReturnType<CuaSdk['ActionTarget']['Desktop']['new']> {
    return this.sdk!.ActionTarget.Desktop.new({ displayId: 'primary' })
  }

  private clickButton(button: MouseButton): import('@trycua/cua-driver').ClickButton {
    if (button === 'right') return this.sdk!.ClickButton.Right
    if (button === 'middle') return this.sdk!.ClickButton.Middle
    return this.sdk!.ClickButton.Left
  }

  private scrollDirection(
    direction: HostScrollDirection
  ): import('@trycua/cua-driver').ScrollDirection {
    switch (direction) {
      case 'up': return this.sdk!.ScrollDirection.Up
      case 'down': return this.sdk!.ScrollDirection.Down
      case 'left': return this.sdk!.ScrollDirection.Left
      case 'right': return this.sdk!.ScrollDirection.Right
    }
  }

  private async currentNativePoint(context: HostActionContext): Promise<{
    x: number
    y: number
    sessionId: string
  }> {
    const sessionId = requireSession(context)
    const result = await this.requireDriver().getCursorPosition(
      { session: sessionId },
      abortOptions(context.signal)
    )
    const value = structuredObject(result)
    return {
      x: finiteNumber(value.x, 'cursor x'),
      y: finiteNumber(value.y, 'cursor y'),
      sessionId
    }
  }

  private resolvePoint(x: number, y: number, context: HostActionContext): {
    x: number
    y: number
    sessionId: string
    frameId: string
  } {
    const sessionId = requireSession(context)
    try {
      const resolved = this.frames.resolve(sessionId, context.frameId, { x, y })
      return { x: resolved.x, y: resolved.y, sessionId, frameId: resolved.frame.frameId }
    } catch (error) {
      if (error instanceof ComputerFrameError) {
        throw new CuaDriverError(error.code, error.message, true, true)
      }
      throw error
    }
  }

  private project(result: ToolResult): HostActionResult {
    assertToolSuccess(result)
    return {
      degraded: result.degraded,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      ...(result.verification
        ? {
            verification: {
              status: result.verification.status,
              stable: result.verification.stable,
              samples: Number(result.verification.samples)
            }
          }
        : {})
    }
  }
}

function parseDesktopState(result: ToolResult): DesktopState {
  const value = structuredObject(result)
  return {
    screenshot_width: positiveNumber(value.screenshot_width, 'screenshot width'),
    screenshot_height: positiveNumber(value.screenshot_height, 'screenshot height'),
    screen_width: positiveNumber(value.screen_width, 'screen width'),
    screen_height: positiveNumber(value.screen_height, 'screen height'),
    scale_factor: positiveNumber(value.scale_factor, 'scale factor'),
    screenshot_mime_type: typeof value.screenshot_mime_type === 'string'
      ? value.screenshot_mime_type
      : 'image/png'
  }
}

function structuredObject(result: ToolResult): Record<string, unknown> {
  assertToolSuccess(result)
  const parsed = boundedStructuredJson(result.structuredJson ?? result.rawJson)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CuaDriverError('invalid_driver_result', 'CUA Driver returned invalid structured output.')
  }
  return parsed as Record<string, unknown>
}

function boundedStructuredJson(value: string): unknown {
  if (Buffer.byteLength(value) > MAX_STRUCTURED_JSON_BYTES) {
    throw new CuaDriverError('driver_result_too_large', 'CUA Driver structured output exceeded the safe limit.')
  }
  return JSON.parse(value) as unknown
}

function assertToolSuccess(result: ToolResult): void {
  if (!result.isError) return
  throw new CuaDriverError(result.errorCode ?? 'driver_action_failed', boundedMessage(result.text))
}

async function scaleScreenshot(source: Buffer, maxDimension: number): Promise<{
  buffer: Buffer
  width: number
  height: number
}> {
  const input = sharp(source)
  const metadata = await input.metadata()
  if (!metadata.width || !metadata.height) {
    throw new CuaDriverError('invalid_screenshot', 'CUA Driver returned an image without dimensions.')
  }
  const scale = Math.min(1, maxDimension / Math.max(metadata.width, metadata.height))
  const width = Math.max(1, Math.round(metadata.width * scale))
  const height = Math.max(1, Math.round(metadata.height * scale))
  const buffer = scale < 1
    ? await input.resize({ width, height, fit: 'fill' }).png().toBuffer()
    : source
  return { buffer, width, height }
}

function requireSession(context: HostActionContext): string {
  const session = context.sessionId?.trim()
  if (!session) throw new CuaDriverError('missing_session', 'A computer session is required.')
  return session.slice(0, 128)
}

function abortOptions(signal: AbortSignal | undefined): { signal: AbortSignal } | undefined {
  return signal ? { signal } : undefined
}

async function loadCuaSdk(): Promise<CuaSdk> {
  try {
    const specifier = '@trycua/cua-driver'
    return await import(/* @vite-ignore */ specifier)
  } catch (error) {
    throw new CuaDriverError(
      'driver_unavailable',
      `CUA Driver native package could not be loaded: ${safeErrorMessage(error)}`
    )
  }
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CuaDriverError('invalid_driver_result', `CUA Driver returned an invalid ${label}.`)
  }
  return value
}

function positiveNumber(value: unknown, label: string): number {
  const number = finiteNumber(value, label)
  if (number <= 0) throw new CuaDriverError('invalid_driver_result', `${label} must be positive.`)
  return number
}

function boundedMessage(message: string): string {
  return message.trim().slice(0, 2_048) || 'CUA Driver action failed.'
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return boundedMessage(error.message)
  return `CUA Driver failed (${createHash('sha256').update(String(error)).digest('hex').slice(0, 12)}).`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
