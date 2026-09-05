import { randomUUID } from 'node:crypto'
import {
  AnyComputerUseBridgeResponse,
  COMPUTER_USE_BRIDGE_CONTRACT_VERSION,
  KUN_COMPUTER_USE_BRIDGE_TOKEN_ENV,
  KUN_COMPUTER_USE_BRIDGE_URL_ENV,
  type ComputerUseBridgeRequestInput
} from '../../contracts/computer-use-bridge.js'
import type {
  HostActionContext,
  HostActionResult,
  HostControlAvailability,
  HostControlController,
  HostScreenshot,
  MouseButton,
  ScrollDirection
} from './host-control.js'

const REQUEST_TIMEOUT_MS = 120_000

export class ComputerUseBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly needsFreshFrame = false
  ) {
    super(message)
  }
}

export class RemoteHostController implements HostControlController {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    const url = new URL(baseUrl)
    if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname) || url.username || url.password) {
      throw new Error('computer-use GUI bridge must use an authenticated loopback HTTP URL')
    }
  }

  async ensureReady(): Promise<HostControlAvailability> {
    try {
      return asAvailability(await this.request({ operation: 'ready' }))
    } catch (error) {
      return {
        available: false,
        reason: `initiating GUI computer-use bridge is unavailable: ${errorMessage(error)}`
      }
    }
  }

  async capture(context?: HostActionContext): Promise<HostScreenshot> {
    return asScreenshot(await this.request({ operation: 'capture', ...requestContext(context) }, context?.signal))
  }

  async screenSize(context?: HostActionContext): Promise<{ width: number; height: number }> {
    return asScreenSize(await this.request({ operation: 'screen_size', ...requestContext(context) }, context?.signal))
  }

  async cursorPosition(context?: HostActionContext): Promise<{ x: number; y: number }> {
    return asCursorPosition(await this.request({ operation: 'cursor_position', ...requestContext(context) }, context?.signal))
  }

  async moveTo(x: number, y: number, context?: HostActionContext): Promise<HostActionResult | void> {
    return asActionResult(await this.request({ operation: 'move_to', x, y, ...requestContext(context) }, context?.signal))
  }

  async click(
    x: number | undefined,
    y: number | undefined,
    button: MouseButton = 'left',
    count: 1 | 2 = 1,
    modifiers: string[] = [],
    context?: HostActionContext
  ): Promise<HostActionResult | void> {
    return asActionResult(await this.request({
      operation: 'click',
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
      button,
      count,
      modifiers,
      ...requestContext(context)
    }, context?.signal))
  }

  async drag(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    context?: HostActionContext
  ): Promise<HostActionResult | void> {
    return asActionResult(await this.request({
      operation: 'drag', x1, y1, x2, y2, ...requestContext(context)
    }, context?.signal))
  }

  async scroll(
    x: number | undefined,
    y: number | undefined,
    direction: ScrollDirection,
    amount = 3,
    context?: HostActionContext
  ): Promise<HostActionResult | void> {
    return asActionResult(await this.request({
      operation: 'scroll',
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
      direction,
      amount,
      ...requestContext(context)
    }, context?.signal))
  }

  async typeText(text: string, context?: HostActionContext): Promise<HostActionResult | void> {
    return asActionResult(await this.request({
      operation: 'type_text', text, ...requestContext(context)
    }, context?.signal))
  }

  async pressHotkey(key: string, context?: HostActionContext): Promise<HostActionResult | void> {
    return asActionResult(await this.request({
      operation: 'press_hotkey', key, ...requestContext(context)
    }, context?.signal))
  }

  async wait(ms: number, signal?: AbortSignal): Promise<void> {
    await this.request({ operation: 'wait', ms }, signal)
  }

  private async request(input: ComputerUseBridgeRequestInput, signal?: AbortSignal): Promise<unknown> {
    const requestId = randomUUID()
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/u, '')}/v1/actions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        contractVersion: COMPUTER_USE_BRIDGE_CONTRACT_VERSION,
        requestId,
        ...input
      }),
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    const raw = await response.json().catch(() => ({}))
    if (!response.ok) throw bridgeError(response.status, raw)
    const parsed = AnyComputerUseBridgeResponse.parse(raw)
    if (parsed.requestId !== requestId) throw new Error('response request ID mismatch')
    return parsed.result
  }
}

export function computerUseControllerFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): HostControlController {
  const url = env[KUN_COMPUTER_USE_BRIDGE_URL_ENV]?.trim()
  const token = env[KUN_COMPUTER_USE_BRIDGE_TOKEN_ENV]?.trim()
  if (url && token) {
    try {
      return new RemoteHostController(url, token, fetchImpl)
    } catch (error) {
      return new UnavailableHostController(errorMessage(error))
    }
  }
  return new UnavailableHostController('computer use requires an initiating Kun GUI')
}

class UnavailableHostController implements HostControlController {
  constructor(private readonly reason: string) {}
  async ensureReady(): Promise<HostControlAvailability> { return { available: false, reason: this.reason } }
  async capture(): Promise<never> { throw new Error(this.reason) }
  async screenSize(): Promise<never> { throw new Error(this.reason) }
  async cursorPosition(): Promise<never> { throw new Error(this.reason) }
  async moveTo(): Promise<never> { throw new Error(this.reason) }
  async click(): Promise<never> { throw new Error(this.reason) }
  async drag(): Promise<never> { throw new Error(this.reason) }
  async scroll(): Promise<never> { throw new Error(this.reason) }
  async typeText(): Promise<never> { throw new Error(this.reason) }
  async pressHotkey(): Promise<never> { throw new Error(this.reason) }
  async wait(): Promise<never> { throw new Error(this.reason) }
}

function requestContext(context?: HostActionContext): { sessionId?: string; frameId?: string } {
  return {
    ...(context?.sessionId ? { sessionId: context.sessionId } : {}),
    ...(context?.frameId ? { frameId: context.frameId } : {})
  }
}

function asAvailability(value: unknown): HostControlAvailability {
  if (!value || typeof value !== 'object' || typeof (value as { available?: unknown }).available !== 'boolean') {
    throw new Error('invalid readiness response')
  }
  const result = value as HostControlAvailability
  return {
    available: result.available,
    ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
    ...(result.backend ? { backend: result.backend } : {}),
    ...(result.driverVersion ? { driverVersion: result.driverVersion } : {}),
    ...(result.contractVersion ? { contractVersion: result.contractVersion } : {})
  }
}

function asScreenshot(value: unknown): HostScreenshot {
  if (!value || typeof value !== 'object') throw new Error('invalid screenshot response')
  const result = value as Partial<HostScreenshot>
  if (
    typeof result.mimeType !== 'string' || typeof result.dataBase64 !== 'string' ||
    !Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height)
  ) throw new Error('invalid screenshot response')
  return result as HostScreenshot
}

function asScreenSize(value: unknown): { width: number; height: number } {
  if (!value || typeof value !== 'object') throw new Error('invalid screen size response')
  const result = value as Record<string, unknown>
  if (Number.isFinite(result.width) && Number.isFinite(result.height)) {
    return result as { width: number; height: number }
  }
  throw new Error('invalid screen size response')
}

function asCursorPosition(value: unknown): { x: number; y: number } {
  if (!value || typeof value !== 'object') throw new Error('invalid cursor position response')
  const result = value as Record<string, unknown>
  if (Number.isFinite(result.x) && Number.isFinite(result.y)) {
    return result as { x: number; y: number }
  }
  throw new Error('invalid cursor position response')
}

function asActionResult(value: unknown): HostActionResult | void {
  if (!value || typeof value !== 'object') return
  const result = value as Record<string, unknown>
  if (result.ok === false) {
    const error = result.error as Record<string, unknown> | undefined
    throw new ComputerUseBridgeError(
      typeof error?.code === 'string' ? error.code : 'computer_action_failed',
      typeof error?.message === 'string' ? error.message : 'Computer action failed.',
      error?.retryable === true,
      error?.needsFreshFrame === true
    )
  }
  return {
    ...(result.degraded === true ? { degraded: true } : {}),
    ...(typeof result.errorCode === 'string' ? { errorCode: result.errorCode } : {}),
    ...('structured' in result ? { structured: result.structured } : {}),
    ...('verification' in result ? { verification: result.verification } : {})
  }
}

function bridgeError(status: number, raw: unknown): Error {
  const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const error = body.error && typeof body.error === 'object'
    ? body.error as Record<string, unknown>
    : body
  return new ComputerUseBridgeError(
    typeof error.code === 'string'
      ? error.code
      : typeof body.error === 'string'
        ? body.error
        : `http_${status}`,
    typeof error.message === 'string' ? error.message : `Computer-use bridge returned HTTP ${status}.`,
    error.retryable === true,
    error.needsFreshFrame === true
  )
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]' || hostname === 'localhost'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
