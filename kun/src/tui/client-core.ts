import { z, type ZodType } from 'zod'
import { randomUUID } from 'node:crypto'
import {
  ApprovalDecisionResponse,
  AttachmentReleaseResponse,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
  BackgroundShellListResponse,
  BackgroundShellRecord,
  BackgroundShellStopResponse,
  ClearThreadGoalResponse,
  ClearThreadTodosResponse,
  CompactResponse,
  ClaudeSdkInstallStatusSchema,
  CreateThreadRequest,
  DeleteThreadResponse,
  ForkThreadRequest,
  GraphRunStatusSchema,
  GraphRunV1Schema,
  ListThreadsResponse,
  ModelConnectionConnectRequestSchema,
  ModelConnectionCliAuthRequestSchema,
  ModelConnectionCredentialRequestSchema,
  ModelConnectionOAuthStartRequestSchema,
  ModelConnectionOAuthStatusSchema,
  ModelConnectionOAuthSubmitRequestSchema,
  ModelConnectionPatchRequestSchema,
  ModelConnectionSelectRequestSchema,
  ModelConnectionSnapshotSchema,
  McpServerConfig,
  MemoryCreateRequest,
  MemoryRecord,
  MemoryUpdateRequest,
  RuntimeInfoResponse,
  RuntimeConfigApplyRequest,
  RuntimeConfigApplyResponse,
  ReplaceSteeringRequest,
  SetThreadGoalRequest,
  SetThreadTodosRequest,
  StartTurnRequest,
  StartTurnResponse,
  SteeringQueueResponse,
  ThreadGoalResponse,
  ThreadSchema,
  ThreadTodosResponse,
  ThreadUsageResponseSchema,
  ProviderQuotaListResponseSchema,
  UpdateThreadRequest,
  UserInputAnswerSchema,
  type ApprovalDecisionRequest,
  type CreateThreadRequest as CreateThreadRequestValue,
  type RuntimeEvent as RuntimeEventValue,
  type StartTurnRequest as StartTurnRequestValue,
  type ThreadRecord,
  type ThreadSummary
} from '../contracts/index.js'
import { createApprovalConsentToken, KUN_APPROVAL_CONSENT_HEADER } from '../server/approval-consent.js'
import { isLoopbackHost } from '../server/loopback-host.js'
import { readRuntimeDiscovery, type RuntimeDiscoveryRecord } from '../server/runtime-discovery.js'
import { ensureSharedRuntime, runtimeDiscoveryDirectory } from '../cli/shared-runtime.js'
import {
  allowsDevelopmentManagerBootstrap,
  runtimeBuildIdForFlavor
} from '../cli/runtime-flavor.js'
import { readRuntimeBuildIdForEntry } from '../server/runtime-build-identity.js'
import type { TuiOptions } from './options.js'
import { defaultKunControlDir } from '../manager/manager-discovery.js'
import { ensureServiceManager } from '../manager/manager-client.js'
import {
  IncrementalSseParser,
  parseReplayResetRequiredFrame,
  parseRuntimeEventFrame,
  type ReplayResetRequired
} from './sse.js'
import { TuiClientError, type ModelConnectionTransport } from './client-types.js'
import { abortableDelay, responseError, safePath, segment } from './client-utils.js'

export class KunTuiClientCore {
  protected endpoint: { baseUrl: string; runtimeToken: string }
  protected readonly fetchImpl: typeof fetch
  protected readonly modelConnectionTransport?: ModelConnectionTransport
  protected readonly connectionResolver?: () => Promise<{ baseUrl: string; runtimeToken: string }>
  protected connectionRefresh?: Promise<boolean>

  constructor(input: {
    baseUrl: string
    runtimeToken?: string
    fetch?: typeof fetch
    modelConnectionTransport?: ModelConnectionTransport
    resolveConnection?: () => Promise<{ baseUrl: string; runtimeToken: string }>
  }) {
    this.endpoint = {
      baseUrl: input.baseUrl.replace(/\/$/, ''),
      runtimeToken: input.runtimeToken ?? ''
    }
    this.fetchImpl = input.fetch ?? fetch
    this.modelConnectionTransport = input.modelConnectionTransport
    this.connectionResolver = input.resolveConnection
  }

  get baseUrl(): string { return this.endpoint.baseUrl }
  get runtimeToken(): string { return this.endpoint.runtimeToken }
  async subscribeThreadEvents(input: {
    threadId: string
    sinceSeq: number
    signal: AbortSignal
    onEvent: (event: RuntimeEventValue) => void | Promise<void>
    onReplayResetRequired?: (reset: ReplayResetRequired) => number | Promise<number>
    onConnection?: (state: 'connecting' | 'connected' | 'reconnecting') => void
    onError?: (error: Error) => void
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  }): Promise<void> {
    let cursor = Math.max(0, input.sinceSeq)
    let failures = 0
    let hasConnected = false
    const sleep = input.sleep ?? abortableDelay
    while (!input.signal.aborted) {
      input.onConnection?.(hasConnected || failures > 0 ? 'reconnecting' : 'connecting')
      try {
        if (failures > 0) await this.refreshConnection()
        const response = await this.fetchImpl(
          `${this.baseUrl}/v1/threads/${segment(input.threadId)}/events?since_seq=${cursor}`,
          {
            method: 'GET',
            headers: this.headers({ Accept: 'text/event-stream', 'Last-Event-ID': String(cursor) }),
            signal: input.signal
          }
        )
        if (!response.ok || !response.body) {
          throw await responseError(response, '/v1/threads/:id/events', this.runtimeToken)
        }
        input.onConnection?.('connected')
        hasConnected = true
        failures = 0
        const parser = new IncrementalSseParser()
        const reader = response.body.getReader()
        let replayReset = false
        const consumeFrames = async (frames: ReturnType<IncrementalSseParser['push']>): Promise<boolean> => {
          for (const frame of frames) {
            const reset = parseReplayResetRequiredFrame(frame)
            if (reset) {
              if (reset.threadId !== input.threadId) {
                throw new Error('runtime replay reset targeted the wrong thread')
              }
              if (!input.onReplayResetRequired) {
                throw new Error('runtime history was compacted; reopen the thread to continue')
              }
              const recovered = await input.onReplayResetRequired(reset)
              if (!Number.isSafeInteger(recovered) || recovered < reset.floorSeq - 1) {
                throw new Error('runtime replay reset recovery returned an invalid cursor')
              }
              cursor = recovered
              return true
            }
            const event = parseRuntimeEventFrame(frame)
            if (!event || event.kind === 'heartbeat' || event.seq <= cursor) continue
            cursor = event.seq
            await input.onEvent(event)
          }
          return false
        }
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (await consumeFrames(parser.push(value))) {
              replayReset = true
              break
            }
          }
          if (!replayReset) {
            replayReset = await consumeFrames(parser.finish())
          }
        } finally {
          await reader.cancel().catch(() => undefined)
          reader.releaseLock()
        }
        if (replayReset) continue
      } catch (error) {
        if (input.signal.aborted) return
        const safe = error instanceof Error ? error : new Error(String(error))
        input.onError?.(safe)
        if (safe instanceof TuiClientError && (safe.status === 404 || safe.status === 410)) return
      }
      if (input.signal.aborted) return
      failures += 1
      const delay = Math.min(5_000, 200 * 2 ** Math.min(failures, 5))
      await sleep(delay, input.signal)
    }
  }

  protected async request<T>(
    path: string,
    schema: ZodType<T>,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
  ): Promise<T> {
    const method = init.method ?? 'GET'
    const initialEndpoint = this.endpoint
    let response: Response
    try {
      response = await this.fetchImpl(`${initialEndpoint.baseUrl}${path}`, {
        method,
        headers: this.headers(init.headers),
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(30_000)
      })
    } catch {
      const changed = await this.refreshConnection().catch(() => false)
      if (changed && (method === 'GET' || method === 'HEAD')) {
        return this.request(path, schema, init)
      }
      throw new TuiClientError(`Kun runtime request failed for ${safePath(path)}`, undefined, 'connection_failed', safePath(path))
    }
    if (response.status === 401) {
      const changed = await this.refreshConnection().catch(() => false)
      if (changed && (method === 'GET' || method === 'HEAD')) {
        return this.request(path, schema, init)
      }
    }
    if (!response.ok) throw await responseError(response, safePath(path), this.runtimeToken)
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new TuiClientError(`Kun runtime returned invalid JSON for ${safePath(path)}`, response.status, 'invalid_response', safePath(path))
    }
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      throw new TuiClientError(`Kun runtime response did not match the client contract for ${safePath(path)}`, response.status, 'invalid_response', safePath(path))
    }
    return parsed.data
  }

  protected refreshConnection(): Promise<boolean> {
    if (!this.connectionResolver) return Promise.resolve(false)
    if (this.connectionRefresh) return this.connectionRefresh
    const previous = this.endpoint
    let refresh: Promise<boolean>
    refresh = this.connectionResolver()
      .then((connection) => {
        const next = {
          baseUrl: connection.baseUrl.replace(/\/$/, ''),
          runtimeToken: connection.runtimeToken
        }
        this.endpoint = next
        return next.baseUrl !== previous.baseUrl || next.runtimeToken !== previous.runtimeToken
      })
      .finally(() => {
        if (this.connectionRefresh === refresh) this.connectionRefresh = undefined
      })
    this.connectionRefresh = refresh
    return refresh
  }

  protected headers(extra: Record<string, string> = {}): Headers {
    const headers = new Headers({ Accept: 'application/json', ...extra })
    if (this.runtimeToken) headers.set('Authorization', `Bearer ${this.runtimeToken}`)
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    return headers
  }
}
