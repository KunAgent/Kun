import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import {
  AnyComputerUseBridgeRequest,
  COMPUTER_USE_BRIDGE_CONTRACT_VERSION,
  ComputerUseBridgeResponse,
  LEGACY_COMPUTER_USE_BRIDGE_CONTRACT_VERSION,
  LegacyComputerUseBridgeResponse,
  type AnyComputerUseBridgeRequest as ComputerUseBridgeRequestValue
} from '../../../kun/src/contracts/computer-use-bridge.js'
import type { HostControlController } from '../../../kun/src/adapters/computer-use/host-control.js'

const MAX_REQUEST_BYTES = 64 * 1024
const REQUEST_TIMEOUT_MS = 120_000

export type ComputerUseBridgeLaunch = {
  url: string
  token: string
}

/**
 * Authenticated loopback bridge owned by the visible Kun GUI. Native screen
 * capture and input automation stay in this process, so the headless Runtime
 * never acquires an Electron/Dock application identity or OS privacy grants.
 */
type RequestJournalEntry = {
  digest: string
  state: 'started' | 'completed' | 'unknown'
  response?: unknown
}

export class ComputerUseBridgeService {
  private server?: Server
  private launch?: ComputerUseBridgeLaunch
  private activeRequest = false
  private legacySessionId = ''
  private readonly requestJournal = new Map<string, RequestJournalEntry>()
  private readonly abortControllers = new Set<AbortController>()

  constructor(private readonly controller: HostControlController) {}

  async start(): Promise<ComputerUseBridgeLaunch> {
    if (this.launch) return this.launch
    const token = randomBytes(32).toString('base64url')
    this.legacySessionId = `legacy-${randomBytes(12).toString('hex')}`
    this.requestJournal.clear()
    const server = createServer((request, response) => {
      void this.handle(request, response)
    })
    server.maxHeadersCount = 32
    server.headersTimeout = 5_000
    server.requestTimeout = REQUEST_TIMEOUT_MS
    server.keepAliveTimeout = 1_000
    server.on('clientError', (_error, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      throw new Error('Computer Use GUI bridge did not bind a TCP port.')
    }
    this.server = server
    this.launch = {
      url: `http://127.0.0.1:${address.port}`,
      token
    }
    return this.launch
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.launch = undefined
    for (const controller of this.abortControllers) controller.abort()
    this.abortControllers.clear()
    this.activeRequest = false
    this.legacySessionId = ''
    this.requestJournal.clear()
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    await this.controller.shutdown?.()
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const launch = this.launch
    if (!launch || !this.validHost(request.headers.host, launch.url)) {
      this.json(response, 400, { error: 'invalid_host' })
      return
    }
    if (!this.validAuthorization(request.headers.authorization, launch.token)) {
      this.json(response, 401, { error: 'unauthorized' })
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/actions') {
      this.json(response, 404, { error: 'unsupported_operation' })
      return
    }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      this.json(response, 415, { error: 'content_type_required' })
      return
    }
    const declaredLength = Number(request.headers['content-length'] ?? 0)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      this.json(response, 413, { error: 'request_too_large' })
      request.destroy()
      return
    }
    // Desktop input is inherently ordered. Reject overlapping callers rather
    // than interleaving mouse/keyboard actions with an unrelated screenshot.
    if (this.activeRequest) {
      this.json(response, 429, { error: 'bridge_busy' })
      return
    }

    this.activeRequest = true
    const controller = new AbortController()
    this.abortControllers.add(controller)
    request.once('aborted', () => controller.abort())
    let journalRequestId: string | undefined
    try {
      const body = await readBoundedJson(request, MAX_REQUEST_BYTES)
      const parsed = AnyComputerUseBridgeRequest.safeParse(body)
      if (!parsed.success) {
        this.json(response, 400, { error: 'invalid_request' })
        return
      }
      journalRequestId = parsed.data.requestId
      const digest = createHash('sha256')
        .update(JSON.stringify(parsed.data))
        .digest('hex')
      const journaled = this.requestJournal.get(parsed.data.requestId)
      if (journaled) {
        if (journaled.digest !== digest) {
          this.json(response, 409, { error: 'request_id_conflict' })
          return
        }
        if (journaled.state === 'completed') {
          this.writeBridgeSuccess(response, parsed.data, journaled.response)
          return
        }
        this.json(response, 409, { error: 'request_outcome_unknown' })
        return
      }
      this.requestJournal.set(parsed.data.requestId, { digest, state: 'started' })
      this.evictRequestJournal()
      const result = await this.execute(parsed.data, controller.signal)
      this.requestJournal.set(parsed.data.requestId, {
        digest,
        state: 'completed',
        response: result
      })
      this.writeBridgeSuccess(response, parsed.data, result)
    } catch (error) {
      if (journalRequestId) {
        const entry = this.requestJournal.get(journalRequestId)
        if (entry?.state === 'started') entry.state = 'unknown'
      }
      if (error instanceof RequestBodyError) {
        this.json(response, error.status, { error: error.code })
      } else if (controller.signal.aborted) {
        this.json(response, 499, { error: 'request_aborted' })
      } else {
        const structured = structuredBridgeError(error)
        this.json(response, structured.status, structured.body)
      }
    } finally {
      this.abortControllers.delete(controller)
      this.activeRequest = false
    }
  }

  private async execute(
    request: ComputerUseBridgeRequestValue,
    signal: AbortSignal
  ): Promise<unknown> {
    const sessionId = 'sessionId' in request ? request.sessionId : undefined
    const frameId = 'frameId' in request ? request.frameId : undefined
    const context = request.contractVersion === COMPUTER_USE_BRIDGE_CONTRACT_VERSION
      ? { sessionId, frameId, signal }
      : { sessionId: this.legacySessionId, signal }
    switch (request.operation) {
      case 'ready':
        return this.controller.ensureReady()
      case 'capture':
        return this.controller.capture(context)
      case 'screen_size':
        return this.controller.screenSize(context)
      case 'cursor_position':
        return this.controller.cursorPosition(context)
      case 'move_to':
        return actionResult(await this.controller.moveTo(request.x, request.y, context))
      case 'click':
        return actionResult(await this.controller.click(
          request.x,
          request.y,
          request.button,
          request.count,
          request.modifiers,
          context
        ))
      case 'drag':
        return actionResult(await this.controller.drag(
          request.x1,
          request.y1,
          request.x2,
          request.y2,
          context
        ))
      case 'scroll':
        return actionResult(await this.controller.scroll(
          request.x,
          request.y,
          request.direction,
          request.amount,
          context
        ))
      case 'type_text':
        return actionResult(await this.controller.typeText(request.text, context))
      case 'press_hotkey':
        return actionResult(await this.controller.pressHotkey(request.key, context))
      case 'wait':
        await this.controller.wait(request.ms, signal)
        return { ok: true }
    }
  }

  private writeBridgeSuccess(
    response: ServerResponse,
    request: ComputerUseBridgeRequestValue,
    result: unknown
  ): void {
    const responseContract = request.contractVersion === LEGACY_COMPUTER_USE_BRIDGE_CONTRACT_VERSION
      ? LegacyComputerUseBridgeResponse
      : ComputerUseBridgeResponse
    this.json(response, 200, responseContract.parse({
      contractVersion: request.contractVersion,
      requestId: request.requestId,
      result
    }))
  }

  private evictRequestJournal(): void {
    while (this.requestJournal.size > 256) {
      const oldest = this.requestJournal.keys().next().value as string | undefined
      if (!oldest) return
      this.requestJournal.delete(oldest)
    }
  }

  private validHost(host: string | undefined, launchUrl: string): boolean {
    if (!host) return false
    return host.toLowerCase() === new URL(launchUrl).host.toLowerCase()
  }

  private validAuthorization(header: string | undefined, token: string): boolean {
    if (!header?.startsWith('Bearer ')) return false
    const supplied = Buffer.from(header.slice('Bearer '.length), 'utf8')
    const expected = Buffer.from(token, 'utf8')
    return supplied.length === expected.length && timingSafeEqual(supplied, expected)
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    if (response.headersSent) {
      response.destroy()
      return
    }
    const payload = Buffer.from(JSON.stringify(body))
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(payload.byteLength),
      'cache-control': 'no-store',
      connection: 'close',
      'x-content-type-options': 'nosniff'
    })
    response.end(payload)
  }
}

function actionResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return { ok: true }
  return { ok: true, ...(value as Record<string, unknown>) }
}

function structuredBridgeError(error: unknown): {
  status: number
  body: Record<string, unknown>
} {
  const candidate = error as {
    code?: unknown
    message?: unknown
    retryable?: unknown
    needsFreshFrame?: unknown
  }
  const code = typeof candidate?.code === 'string'
    ? candidate.code.slice(0, 128)
    : 'bridge_failed_closed'
  const safeCodes = new Set([
    'stale_frame',
    'unsupported_modifier_click',
    'driver_unavailable',
    'driver_error',
    'authorization_refused',
    'background_unavailable',
    'background_occluded'
  ])
  return {
    status: code === 'stale_frame' ? 409 : code === 'unsupported_modifier_click' ? 422 : 500,
    body: {
      error: safeCodes.has(code) ? code : 'bridge_failed_closed',
      ...(safeCodes.has(code) && typeof candidate.message === 'string'
        ? { message: candidate.message.slice(0, 1_024) }
        : {}),
      retryable: candidate.retryable === true,
      needsFreshFrame: candidate.needsFreshFrame === true
    }
  }
}

class RequestBodyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code)
  }
}

function readBoundedJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.byteLength
      if (bytes > maxBytes) {
        reject(new RequestBodyError(413, 'request_too_large'))
        request.destroy()
        return
      }
      chunks.push(buffer)
    })
    request.once('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new RequestBodyError(400, 'invalid_json'))
      }
    })
    request.once('error', reject)
  })
}
