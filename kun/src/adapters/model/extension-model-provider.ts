import { randomUUID } from 'node:crypto'
import {
  ModelProviderDeclarationSchema,
  ModelProviderStreamEventSchema,
  ProviderBindingSchema,
  ProviderProbeResultSchema,
  type ModelProviderAdapter,
  type ModelProviderStreamEvent,
  type ProviderProbeResult
} from '@kun/extension-api'
import type { ExtensionPrincipal } from '../../services/extension-agent-service.js'
import type { ExtensionProviderAccountStore } from '../../services/extension-provider-account-store.js'
import { extensionProviderId } from '../../services/extension-provider-account-store.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import {
  abortError,
  appendProviderToolArguments,
  appendProviderToolName,
  assertModelRequestCapabilities,
  cancellationToken,
  finalizeProviderToolCalls,
  forwardAbort,
  hasReportedUsage,
  mapProviderErrorEvent,
  mapProviderEvent,
  mergedProviderModels,
  normalizeModelRequest,
  normalizeProviderReportedError,
  resolveProviderModel,
  safeProviderProtocolError,
  serializedBytes,
  usageSnapshot,
  type PendingProviderToolCall,
  type ProviderRegistration
} from './extension-model-support.js'
import {
  DEFAULT_MODEL_STREAM_LIMITS
} from './model-stream-resource-budget.js'

export type ExtensionModelProviderDiagnostic = {
  extensionId: string
  providerId: string
  modelId?: string
  accountId?: string
  requestId?: string
  operation: 'probe' | 'listModels' | 'stream'
  code:
    | 'probe_failed'
    | 'provider_error'
    | 'model_discovery_failed'
    | 'invalid_model'
    | 'duplicate_model'
    | 'model_limit_exceeded'
    | 'stream_protocol_error'
  category:
    | 'authentication'
    | 'authorization'
    | 'rate_limit'
    | 'invalid_request'
    | 'unavailable'
    | 'adapter_failure'
    | 'protocol'
  retryable: boolean
  message: string
  timestamp: string
}

export type ExtensionModelProviderRegistration = {
  providerId: string
  dispose(): Promise<void>
}

export type ExtensionModelProviderRegistryOptions = {
  accounts: ExtensionProviderAccountStore
  maxEventBytes?: number
  maxEventsPerRequest?: number
  maxTotalBytesPerRequest?: number
  maxOutputBytesPerRequest?: number
  maxPendingToolCallsPerRequest?: number
  maxCompletedToolCallsPerRequest?: number
  maxToolArgumentBytes?: number
  maxTotalPendingToolArgumentBytesPerRequest?: number
  maxCompletedToolArgumentBytesPerRequest?: number
  nowIso?: () => string
  maxDiagnostics?: number
}

/** Dynamic custom-provider registry whose clients plug into MultiProviderModelClient. */
export class ExtensionModelProviderRegistry {
  private readonly registrations = new Map<string, ProviderRegistration>()
  private readonly maxEventBytes: number
  private readonly maxEventsPerRequest: number
  private readonly maxTotalBytesPerRequest: number
  private readonly maxOutputBytesPerRequest: number
  private readonly maxPendingToolCallsPerRequest: number
  private readonly maxCompletedToolCallsPerRequest: number
  private readonly maxToolArgumentBytes: number
  private readonly maxTotalPendingToolArgumentBytesPerRequest: number
  private readonly maxCompletedToolArgumentBytesPerRequest: number
  private readonly nowIso: () => string
  private readonly maxDiagnostics: number
  private readonly diagnosticBuffer: ExtensionModelProviderDiagnostic[] = []
  private readonly listeners = new Set<() => void>()

  constructor(private readonly options: ExtensionModelProviderRegistryOptions) {
    this.maxEventBytes = Math.max(1_024, options.maxEventBytes ?? 1024 * 1024)
    this.maxEventsPerRequest = Math.max(1, options.maxEventsPerRequest ?? DEFAULT_MODEL_STREAM_LIMITS.maxFrames)
    this.maxTotalBytesPerRequest = Math.max(
      1_024,
      options.maxTotalBytesPerRequest ?? DEFAULT_MODEL_STREAM_LIMITS.maxTotalBytes
    )
    this.maxOutputBytesPerRequest = Math.max(
      1_024,
      options.maxOutputBytesPerRequest ?? DEFAULT_MODEL_STREAM_LIMITS.maxOutputBytes
    )
    this.maxPendingToolCallsPerRequest = Math.max(
      1,
      Math.floor(options.maxPendingToolCallsPerRequest ?? DEFAULT_MODEL_STREAM_LIMITS.maxPendingToolCalls)
    )
    this.maxCompletedToolCallsPerRequest = Math.max(
      1,
      Math.floor(options.maxCompletedToolCallsPerRequest ?? DEFAULT_MODEL_STREAM_LIMITS.maxCompletedToolCalls)
    )
    this.maxToolArgumentBytes = Math.max(
      1_024,
      options.maxToolArgumentBytes ?? DEFAULT_MODEL_STREAM_LIMITS.maxPendingToolArgumentBytes
    )
    this.maxTotalPendingToolArgumentBytesPerRequest = Math.max(
      1_024,
      options.maxTotalPendingToolArgumentBytesPerRequest ?? DEFAULT_MODEL_STREAM_LIMITS.maxTotalPendingToolArgumentBytes
    )
    this.maxCompletedToolArgumentBytesPerRequest = Math.max(
      1_024,
      options.maxCompletedToolArgumentBytesPerRequest ?? DEFAULT_MODEL_STREAM_LIMITS.maxCompletedToolArgumentBytes
    )
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.maxDiagnostics = Math.max(1, Math.floor(options.maxDiagnostics ?? 256))
  }

  async register(
    principal: ExtensionPrincipal,
    declarationInput: unknown,
    adapter: ModelProviderAdapter
  ): Promise<ExtensionModelProviderRegistration> {
    if (!principal.permissions.includes('providers.register')) throw new Error('Missing permission: providers.register')
    const declaration = ModelProviderDeclarationSchema.parse(declarationInput)
    const providerId = extensionProviderId(principal.extensionId, declaration.id)
    const provider = await this.options.accounts.getProvider(providerId)
    if (!provider || provider.ownerExtensionId !== principal.extensionId) {
      throw new Error(`authentication provider definition must be registered first: ${providerId}`)
    }
    if (this.registrations.has(providerId)) throw new Error(`extension model provider already registered: ${providerId}`)
    const registration: ProviderRegistration = {
      providerId,
      principal,
      declaration,
      adapter,
      activeRequests: new Map(),
      reportDiagnostic: (diagnostic) => this.recordDiagnostic(
        principal.extensionId,
        providerId,
        diagnostic
      ),
      disposed: false
    }
    this.registrations.set(providerId, registration)
    this.emitChanged()
    let disposed = false
    return {
      providerId,
      dispose: async () => {
        if (disposed) return
        disposed = true
        await this.disposeRegistration(registration)
      }
    }
  }

  clientMap(): Map<string, ModelClient> {
    return new Map([...this.registrations.values()]
      .filter((registration) => !registration.disposed)
      .map((registration) => [
        registration.providerId,
        new ExtensionRemoteModelClient(registration, this.options.accounts, {
          maxEventBytes: this.maxEventBytes,
          maxEventsPerRequest: this.maxEventsPerRequest,
          maxTotalBytesPerRequest: this.maxTotalBytesPerRequest,
          maxOutputBytesPerRequest: this.maxOutputBytesPerRequest,
          maxPendingToolCallsPerRequest: this.maxPendingToolCallsPerRequest,
          maxCompletedToolCallsPerRequest: this.maxCompletedToolCallsPerRequest,
          maxToolArgumentBytes: this.maxToolArgumentBytes,
          maxTotalPendingToolArgumentBytesPerRequest: this.maxTotalPendingToolArgumentBytesPerRequest,
          maxCompletedToolArgumentBytesPerRequest: this.maxCompletedToolArgumentBytesPerRequest
        })
      ]))
  }

  /** Providers whose extension declared `gatewayExport`, with their declared models. */
  gatewayExportable(): { providerId: string; extensionId: string; displayName: string; models: { id: string; displayName?: string }[] }[] {
    return [...this.registrations.values()].filter((registration) => !registration.disposed && registration.declaration.gatewayExport === true)
      .map((registration) => ({ providerId: registration.providerId, extensionId: registration.principal.extensionId,
        displayName: registration.declaration.displayName,
        models: registration.declaration.models.map((model) => ({ id: model.id, displayName: model.displayName })) }))
  }

  isAvailable(providerId: string): boolean {
    const registration = this.registrations.get(providerId)
    return Boolean(registration && !registration.disposed)
  }

  async probe(providerId: string, accountId: string, modelId?: string, signal?: AbortSignal) {
    const registration = this.requireRegistration(providerId)
    const selectedModel = modelId
      ? await resolveProviderModel(registration, modelId, signal, accountId)
      : (await mergedProviderModels(registration, signal, accountId))[0]
    if (!selectedModel) throw new Error(`extension provider has no available models: ${providerId}`)
    await this.options.accounts.validateBinding({
      providerId,
      accountId,
      modelId: selectedModel.id
    })
    let result: ProviderProbeResult
    try {
      result = ProviderProbeResultSchema.parse(await registration.adapter.probe(
        ProviderBindingSchema.parse({ providerId, accountId, modelId: selectedModel.id }),
        { cancellation: cancellationToken(signal ?? new AbortController().signal) }
      ))
    } catch (error) {
      if (signal?.aborted) throw error
      registration.reportDiagnostic({
        operation: 'probe',
        code: 'probe_failed',
        category: 'adapter_failure',
        retryable: false,
        ...(accountId ? { accountId } : {}),
        ...(selectedModel ? { modelId: selectedModel.id } : {}),
        message: 'Extension provider probe failed.'
      })
      throw new Error('Extension provider probe failed.')
    }
    if (!result.ok) {
      registration.reportDiagnostic({
        operation: 'probe',
        code: 'provider_error',
        category: 'unavailable',
        retryable: false,
        accountId,
        modelId: selectedModel.id,
        message: 'Extension provider probe reported an unavailable service.'
      })
    }
    return {
      ok: result.ok,
      ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
      ...(result.message || result.details
        ? { message: result.ok ? 'Extension provider probe completed.' : 'Extension provider probe failed.' }
        : {})
    }
  }

  async listModels(providerId: string, accountId: string, signal?: AbortSignal) {
    const registration = this.requireRegistration(providerId)
    await this.options.accounts.validateBinding({ providerId, accountId, modelId: 'model-list' })
    return mergedProviderModels(registration, signal, accountId)
  }

  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  diagnostics(extensionId?: string): ExtensionModelProviderDiagnostic[] {
    return this.diagnosticBuffer
      .filter((diagnostic) => !extensionId || diagnostic.extensionId === extensionId)
      .map((diagnostic) => structuredClone(diagnostic))
  }

  async disposeExtension(extensionId: string): Promise<void> {
    await Promise.allSettled([...this.registrations.values()]
      .filter((registration) => registration.principal.extensionId === extensionId)
      .map((registration) => this.disposeRegistration(registration)))
  }

  async disposeAll(): Promise<void> {
    await Promise.allSettled([...this.registrations.values()].map((registration) => this.disposeRegistration(registration)))
  }

  private requireRegistration(providerId: string): ProviderRegistration {
    const registration = this.registrations.get(providerId)
    if (!registration || registration.disposed) throw new Error(`extension model provider is unavailable: ${providerId}`)
    return registration
  }

  private async disposeRegistration(registration: ProviderRegistration): Promise<void> {
    if (registration.disposed) return
    registration.disposed = true
    this.registrations.delete(registration.providerId)
    for (const [requestId, controller] of registration.activeRequests) {
      controller.abort(new Error('extension model provider disposed'))
      // Adapter cleanup is best-effort. A broken third-party cancel hook must
      // not retain active request references or block extension/runtime shutdown.
      void Promise.resolve()
        .then(() => registration.adapter.cancel(requestId))
        .catch(() => undefined)
    }
    registration.activeRequests.clear()
    this.emitChanged()
  }

  private emitChanged(): void {
    for (const listener of this.listeners) {
      try { listener() } catch { /* isolate runtime listeners */ }
    }
  }

  private recordDiagnostic(
    extensionId: string,
    providerId: string,
    diagnostic: Omit<ExtensionModelProviderDiagnostic, 'extensionId' | 'providerId' | 'timestamp'>
  ): void {
    this.diagnosticBuffer.push({
      extensionId,
      providerId,
      ...diagnostic,
      timestamp: this.nowIso()
    })
    if (this.diagnosticBuffer.length > this.maxDiagnostics) {
      this.diagnosticBuffer.splice(0, this.diagnosticBuffer.length - this.maxDiagnostics)
    }
  }
}

class ExtensionRemoteModelClient implements ModelClient {
  readonly provider: string
  readonly model: string

  constructor(
    private readonly registration: ProviderRegistration,
    private readonly accounts: ExtensionProviderAccountStore,
    private readonly limits: {
      maxEventBytes: number
      maxEventsPerRequest: number
      maxTotalBytesPerRequest: number
      maxOutputBytesPerRequest: number
      maxPendingToolCallsPerRequest: number
      maxCompletedToolCallsPerRequest: number
      maxToolArgumentBytes: number
      maxTotalPendingToolArgumentBytesPerRequest: number
      maxCompletedToolArgumentBytesPerRequest: number
    }
  ) {
    this.provider = registration.providerId
    this.model = registration.declaration.models[0]?.id ?? 'extension-model'
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    if (this.registration.disposed) throw new Error(`extension model provider is unavailable: ${this.provider}`)
    if (!request.accountId) throw new Error(`account is required for extension provider: ${this.provider}`)
    await this.accounts.validateBinding({
      providerId: this.provider,
      accountId: request.accountId,
      modelId: request.model
    })
    const model = await resolveProviderModel(
      this.registration,
      request.model,
      request.abortSignal,
      request.accountId
    )
    assertModelRequestCapabilities(request, model)
    const requestId = `modelreq_${randomUUID()}`
    const controller = new AbortController()
    const detachAbort = forwardAbort(request.abortSignal, controller)
    this.registration.activeRequests.set(requestId, controller)
    const normalized = normalizeModelRequest(
      request,
      requestId,
      this.provider,
      request.accountId,
      model.capabilities.input.includes('image')
    )
    let expectedSequence = 0
    let eventCount = 0
    let totalBytes = 0
    let outputBytes = 0
    let terminal = false
    let lastUsage: Extract<ModelProviderStreamEvent, { type: 'usage' }>['usage'] | undefined
    let terminalChunks: ModelStreamChunk[] | undefined
    const pendingToolCalls = new Map<string, PendingProviderToolCall>()
    let totalPendingToolArgumentBytes = 0
    let completedToolCalls = 0
    let completedToolArgumentBytes = 0
    const pendingToolCall = (callId: string): PendingProviderToolCall => {
      const existing = pendingToolCalls.get(callId)
      if (existing) return existing
      if (pendingToolCalls.size >= this.limits.maxPendingToolCallsPerRequest) {
        throw new Error(
          `extension provider pending tool-call limit exceeded ` +
          `(${pendingToolCalls.size + 1}/${this.limits.maxPendingToolCallsPerRequest})`
        )
      }
      const created: PendingProviderToolCall = {
        callId,
        nameBlocks: [],
        nameParts: [],
        argumentBlocks: [],
        argumentParts: [],
        argumentBytes: 0
      }
      pendingToolCalls.set(callId, created)
      return created
    }
    let cancelPromise: Promise<void> | undefined
    const cancel = (reason: unknown): Promise<void> => {
      controller.abort(reason)
      cancelPromise ??= Promise.resolve()
        .then(() => this.registration.adapter.cancel(requestId))
        .catch(() => undefined)
      return cancelPromise
    }
    const onRequestAbort = () => { void cancel(request.abortSignal.reason) }
    if (request.abortSignal.aborted) onRequestAbort()
    else request.abortSignal.addEventListener('abort', onRequestAbort, { once: true })
    try {
      const source = this.registration.adapter.stream(normalized, {
        cancellation: cancellationToken(controller.signal)
      })
      for await (const rawEvent of source) {
        if (controller.signal.aborted) throw abortError()
        eventCount += 1
        if (eventCount > this.limits.maxEventsPerRequest) {
          throw new Error('extension provider stream event limit exceeded')
        }
        const eventBytes = serializedBytes(rawEvent)
        if (eventBytes > this.limits.maxEventBytes) {
          throw new Error('extension provider stream event is too large')
        }
        totalBytes += eventBytes
        if (totalBytes > this.limits.maxTotalBytesPerRequest) {
          throw new Error(
            `extension provider stream byte limit exceeded ` +
            `(${totalBytes}/${this.limits.maxTotalBytesPerRequest} bytes)`
          )
        }
        const event = ModelProviderStreamEventSchema.parse(rawEvent)
        if (event.requestId !== requestId) throw new Error('extension provider stream requestId mismatch')
        if (event.sequence !== expectedSequence) {
          throw new Error(`extension provider stream sequence mismatch: expected ${expectedSequence}, received ${event.sequence}`)
        }
        expectedSequence += 1
        if (terminal) throw new Error('extension provider emitted data after a terminal event')
        if (event.type === 'usage' && hasReportedUsage(event.usage)) lastUsage = event.usage
        if (event.type === 'completed' && event.usage && hasReportedUsage(event.usage)) {
          lastUsage = event.usage
        }
        if (event.type === 'completed' && !lastUsage) {
          throw new Error('extension provider completed without terminal usage')
        }
        if (event.type === 'toolCallDelta') {
          const pending = pendingToolCall(event.callId)
          if (pending.complete) throw new Error('extension provider emitted tool-call data after completion')
          if (event.nameDelta) appendProviderToolName(pending, event.nameDelta)
          if (event.argumentsDelta) {
            const bytes = Buffer.byteLength(event.argumentsDelta, 'utf8')
            const nextArgumentBytes = pending.argumentBytes + bytes
            if (nextArgumentBytes > this.limits.maxToolArgumentBytes) {
              throw new Error(
                `extension provider tool argument byte limit exceeded ` +
                `(${nextArgumentBytes}/${this.limits.maxToolArgumentBytes} bytes)`
              )
            }
            const nextTotalPendingBytes = totalPendingToolArgumentBytes + bytes
            if (nextTotalPendingBytes > this.limits.maxTotalPendingToolArgumentBytesPerRequest) {
              throw new Error(
                `extension provider total pending tool-argument byte limit exceeded ` +
                `(${nextTotalPendingBytes}/${this.limits.maxTotalPendingToolArgumentBytesPerRequest} bytes)`
              )
            }
            appendProviderToolArguments(pending, event.argumentsDelta)
            pending.argumentBytes = nextArgumentBytes
            totalPendingToolArgumentBytes = nextTotalPendingBytes
          }
        }
        if (event.type === 'toolCallComplete') {
          const pending = pendingToolCall(event.callId)
          if (pending.complete) throw new Error('extension provider completed the same tool call more than once')
          const nextCompletedToolCalls = completedToolCalls + 1
          if (nextCompletedToolCalls > this.limits.maxCompletedToolCallsPerRequest) {
            throw new Error(
              `extension provider completed tool-call limit exceeded ` +
              `(${nextCompletedToolCalls}/${this.limits.maxCompletedToolCallsPerRequest})`
            )
          }
          const argumentBytes = serializedBytes(event.input)
          if (argumentBytes > this.limits.maxToolArgumentBytes) {
            throw new Error(
              `extension provider tool argument byte limit exceeded ` +
              `(${argumentBytes}/${this.limits.maxToolArgumentBytes} bytes)`
            )
          }
          const nextCompletedArgumentBytes = completedToolArgumentBytes + argumentBytes
          if (nextCompletedArgumentBytes > this.limits.maxCompletedToolArgumentBytesPerRequest) {
            throw new Error(
              `extension provider completed tool-argument byte limit exceeded ` +
              `(${nextCompletedArgumentBytes}/${this.limits.maxCompletedToolArgumentBytesPerRequest} bytes)`
            )
          }
          pending.complete = event
          completedToolCalls = nextCompletedToolCalls
          completedToolArgumentBytes = nextCompletedArgumentBytes
        }
        const chunks = mapProviderEvent(event)
        for (const chunk of chunks) {
          if (chunk.kind === 'assistant_text_delta' || chunk.kind === 'assistant_reasoning_delta') {
            outputBytes += Buffer.byteLength(chunk.text, 'utf8')
          }
        }
        if (outputBytes > this.limits.maxOutputBytesPerRequest) {
          throw new Error(
            `extension provider stream output byte limit exceeded ` +
            `(${outputBytes}/${this.limits.maxOutputBytesPerRequest} bytes)`
          )
        }
        if (event.type === 'completed' || event.type === 'error') {
          if (event.type === 'error') {
            const normalizedError = normalizeProviderReportedError(event.code, event.retryable)
            this.registration.reportDiagnostic({
              operation: 'stream',
              code: 'provider_error',
              category: normalizedError.category,
              retryable: normalizedError.retryable,
              modelId: request.model,
              accountId: request.accountId,
              requestId,
              message: normalizedError.message
            })
          }
          const toolCallChunks = event.type === 'completed'
            ? finalizeProviderToolCalls(
                normalized,
                pendingToolCalls,
                event.finishReason,
                this.limits
              )
            : []
          terminal = true
          terminalChunks = [
            ...toolCallChunks,
            ...(lastUsage ? [{ kind: 'usage' as const, usage: usageSnapshot(lastUsage) }] : []),
            ...(event.type === 'error'
              ? mapProviderErrorEvent(event)
              : chunks)
          ]
        } else {
          // Usage is a cumulative terminal snapshot. Buffer the latest event
          // so a provider that reports it both before and with completion is
          // accounted exactly once.
          if (
            event.type !== 'usage' &&
            event.type !== 'toolCallDelta' &&
            event.type !== 'toolCallComplete'
          ) for (const chunk of chunks) yield chunk
        }
      }
      if (!terminal) throw new Error('extension provider stream ended without a terminal event')
      for (const chunk of terminalChunks ?? []) yield chunk
    } catch (error) {
      if (controller.signal.aborted || request.abortSignal.aborted) throw abortError()
      // Extension cancellation is best-effort and must not be able to suppress
      // the bounded protocol error by returning a promise that never settles.
      void cancel(error)
      const safeMessage = safeProviderProtocolError(error)
      this.registration.reportDiagnostic({
        operation: 'stream',
        code: 'stream_protocol_error',
        category: 'protocol',
        retryable: false,
        modelId: request.model,
        accountId: request.accountId,
        requestId,
        message: safeMessage
      })
      yield {
        kind: 'error',
        code: 'extension_provider_protocol_error',
        message: safeMessage
      }
      yield { kind: 'completed', stopReason: 'error' }
    } finally {
      request.abortSignal.removeEventListener('abort', onRequestAbort)
      detachAbort()
      this.registration.activeRequests.delete(requestId)
    }
  }
}
