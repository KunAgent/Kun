import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CompatibilityReportSchema,
  type CompatibilityReport,
  type WorkspaceContext
} from '@kun/extension-api'
import { z } from 'zod'
import { asExtensionError, extensionError, type ExtensionErrorDetails } from './errors.js'
import { redactSecrets, redactSecretText } from '../config/secret-redaction.js'
import {
  DEFAULT_EXTENSION_CONCURRENT_REQUESTS,
  DEFAULT_EXTENSION_MESSAGE_BYTES,
  DEFAULT_EXTENSION_REQUEST_TIMEOUT_MS,
  DEFAULT_EXTENSION_STREAM_BUFFER_BYTES,
  DEFAULT_EXTENSION_STREAM_WINDOW,
  JsonRpcPeer,
  type RpcEnvelope,
  type RpcRequestContext
} from './host-protocol.js'
import {
  DEFAULT_EXTENSION_LOG_BYTES,
  DEFAULT_EXTENSION_LOG_RETENTION,
  ExtensionLogWriter
} from './log-writer.js'
import { ExtensionPaths } from './paths.js'
import {
  EXTENSION_RPC_VERSION,
  type JsonValue,
  type ResolvedExtension
} from './types.js'

export const DEFAULT_EXTENSION_ACTIVATION_TIMEOUT_MS = 15_000
export const DEFAULT_EXTENSION_CANCELLATION_GRACE_MS = 2_000
export const DEFAULT_EXTENSION_SHUTDOWN_TIMEOUT_MS = 5_000
export const DEFAULT_EXTENSION_MEMORY_BYTES = 256 * 1024 * 1024
export const DEFAULT_EXTENSION_EVENTS_PER_SECOND = 200

const HostInitializationResponseSchema = z.strictObject({
  initialized: z.literal(true),
  rpcVersion: z.number().int().positive(),
  apiVersion: z.string().min(1)
})

const HostLoadResponseSchema = z.strictObject({
  loaded: z.literal(true)
})

export type ExtensionHostLimits = {
  activationTimeoutMs: number
  operationTimeoutMs: number
  cancellationGraceMs: number
  shutdownTimeoutMs: number
  maxMessageBytes: number
  maxConcurrentRequests: number
  streamWindow: number
  maxStreamBufferBytes: number
  maxMemoryBytes: number
  maxEventsPerSecond: number
  maxLogBytes: number
  logRetention: number
}

export type ExtensionPrincipal = {
  extensionId: string
  version: string
  declaredApiVersion?: string
  apiVersion: string
  lifecycleNonce: string
  grantedPermissions: readonly string[]
  workspaceRoots: readonly string[]
  development: boolean
}

export type ExtensionBrokerRequest = {
  principal: ExtensionPrincipal
  method: string
  params: JsonValue
  signal: AbortSignal
  requestId: string
}

export type ExtensionHostExit = {
  extensionId: string
  lifecycleNonce: string
  expected: boolean
  code: number | null
  signal: NodeJS.Signals | null
  error?: { code: string; message: string; details: ExtensionErrorDetails }
}

export type ExtensionHostProcessOptions = {
  extension: ResolvedExtension
  compatibilityReport: CompatibilityReport
  paths: ExtensionPaths
  workspaceRoots?: string[]
  workspaceContext?: WorkspaceContext
  capabilities?: string[]
  runnerPath?: string
  limits?: Partial<ExtensionHostLimits>
  broker?(request: ExtensionBrokerRequest): Promise<JsonValue>
  requiredPermission?(method: string, params: JsonValue): string | undefined
  onNotification?(principal: ExtensionPrincipal, method: string, params: JsonValue): void | Promise<void>
  onStream?(
    principal: ExtensionPrincipal,
    requestId: string,
    sequence: number,
    payload: JsonValue,
    terminal: boolean
  ): void | Promise<void>
  onExit?(exit: ExtensionHostExit): void | Promise<void>
  environment?: Record<string, string>
}

export type ExtensionHostLifecycleState =
  | 'idle'
  | 'starting'
  | 'initialized'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'stopped'
  | 'crashed'
  | 'unavailable'

export class ExtensionHostProcess {
  readonly limits: ExtensionHostLimits
  readonly lifecycleNonce = randomUUID()
  readonly logPath: string
  readonly principal: ExtensionPrincipal
  readonly compatibilityReport: CompatibilityReport
  private readonly log: ExtensionLogWriter
  private child: ChildProcess | undefined
  private peer: JsonRpcPeer | undefined
  private exitPromise: Promise<void> | undefined
  private resolveExit: (() => void) | undefined
  private stopRequested = false
  private eventsInWindow = 0
  private eventWindowStartedAt = Date.now()
  private _state: ExtensionHostLifecycleState = 'idle'
  private _lastError: ReturnType<typeof serializeError> | undefined

  constructor(private readonly options: ExtensionHostProcessOptions) {
    this.limits = resolveHostLimits(options.limits)
    this.compatibilityReport = assertHostAdmission(
      options.extension,
      options.compatibilityReport
    )
    const negotiatedApiVersion = this.compatibilityReport.api.compatible
      ? this.compatibilityReport.api.negotiatedApiVersion
      : options.extension.manifest.apiVersion
    const workspaceRoots = [...new Set(options.workspaceRoots ?? [])].map((root) => resolve(root)).sort()
    this.principal = Object.freeze({
      extensionId: options.extension.id,
      version: options.extension.version,
      declaredApiVersion: options.extension.manifest.apiVersion,
      apiVersion: negotiatedApiVersion,
      lifecycleNonce: this.lifecycleNonce,
      grantedPermissions: Object.freeze([...options.extension.grantedPermissions]),
      workspaceRoots: Object.freeze(workspaceRoots),
      development: options.extension.development
    })
    this.logPath = `${options.paths.logsDirectory(options.extension.id)}/host.log`
    this.log = new ExtensionLogWriter(this.logPath, {
      maxBytes: this.limits.maxLogBytes,
      retention: this.limits.logRetention
    })
  }

  get state(): ExtensionHostLifecycleState {
    return this._state
  }

  get pid(): number | undefined {
    return ['starting', 'initialized', 'activating', 'active', 'deactivating'].includes(this._state)
      ? this.child?.pid
      : undefined
  }

  get lastError(): ReturnType<typeof serializeError> | undefined {
    return this._lastError === undefined ? undefined : structuredClone(this._lastError)
  }

  async start(): Promise<void> {
    if (this._state !== 'idle' && this._state !== 'stopped') return
    const main = this.options.extension.manifest.main
    if (main === undefined) {
      this._state = 'unavailable'
      throw extensionError(
        'EXTENSION_HEADLESS_ENTRYPOINT_REQUIRED',
        'Extension has no Node main entrypoint',
        { extensionId: this.options.extension.id }
      )
    }
    this._state = 'starting'
    this.stopRequested = false
    await this.log.write('lifecycle', `starting ${this.principal.extensionId}@${this.principal.version}`)

    const runnerPath = this.options.runnerPath ?? fileURLToPath(new URL('./host-runner.js', import.meta.url))
    const extensionRoot = await realpath(this.options.extension.packagePath)
    const memoryMb = Math.max(16, Math.floor(this.limits.maxMemoryBytes / (1024 * 1024)))
    const child = fork(runnerPath, [], {
      cwd: extensionRoot,
      env: minimalExtensionEnvironment({
        ...this.options.environment,
        KUN_EXTENSION_HOST_RUNNER: '1'
      }),
      execArgv: [`--max-old-space-size=${memoryMb}`],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    this.child = child
    this.exitPromise = new Promise((resolvePromise) => {
      this.resolveExit = resolvePromise
    })
    child.stdout?.on('data', (chunk: Buffer) => void this.log.write('stdout', chunk).catch(() => undefined))
    child.stderr?.on('data', (chunk: Buffer) => void this.log.write('stderr', chunk).catch(() => undefined))
    child.once('error', (error) => this.recordFatal(error))
    child.once('exit', (code, signal) => void this.handleExit(code, signal))

    const peer = new JsonRpcPeer({
      send: (envelope) => this.send(envelope),
      onRequest: (method, params, context) => this.handleBrokerRequest(method, params, context),
      onNotification: (method, params) => this.handleNotification(method, params),
      onStream: (requestId, sequence, payload, terminal) =>
        this.options.onStream?.(this.principal, requestId, sequence, payload, terminal),
      maxMessageBytes: this.limits.maxMessageBytes,
      maxConcurrentRequests: this.limits.maxConcurrentRequests,
      defaultRequestTimeoutMs: this.limits.operationTimeoutMs,
      streamWindow: this.limits.streamWindow,
      maxStreamBufferBytes: this.limits.maxStreamBufferBytes,
      cancellationGraceMs: this.limits.cancellationGraceMs,
      onCancellationTimeout: (requestId) => this.protocolFailure(extensionError(
        'EXTENSION_HOST_CANCELLATION_TIMEOUT',
        'Extension host ignored request cancellation',
        { requestId }
      ))
    })
    this.peer = peer
    child.on('message', (message: unknown) => {
      try {
        this.recordEvent()
        void peer.receive(message).catch((error: unknown) => this.protocolFailure(error))
      } catch (error) {
        void this.protocolFailure(error)
      }
    })

    try {
      const initializationResponse = HostInitializationResponseSchema.safeParse(
        await peer.request('host.initialize', {
          identity: {
            extensionId: this.principal.extensionId,
            publisher: this.options.extension.manifest.publisher,
            name: this.options.extension.manifest.name,
            version: this.principal.version,
            declaredApiVersion: this.options.extension.manifest.apiVersion,
            apiVersion: this.principal.apiVersion,
            lifecycleNonce: this.principal.lifecycleNonce,
            development: this.principal.development
          },
          extensionRoot,
          entrypoint: main,
          grantedPermissions: [...this.principal.grantedPermissions],
          workspaceRoots: [...this.principal.workspaceRoots],
          capabilities: [...new Set(this.options.capabilities ?? [])].sort(),
          ...(this.options.workspaceContext === undefined
            ? {}
            : { workspaceContext: this.options.workspaceContext }),
          limits: {
            maxMessageBytes: this.limits.maxMessageBytes,
            maxConcurrentRequests: this.limits.maxConcurrentRequests,
            requestTimeoutMs: this.limits.operationTimeoutMs,
            streamWindow: this.limits.streamWindow,
            maxStreamBufferBytes: this.limits.maxStreamBufferBytes
          }
        }, { timeoutMs: this.limits.activationTimeoutMs })
      )
      if (!initializationResponse.success) {
        throw extensionError(
          'EXTENSION_HOST_HANDSHAKE_INVALID',
          'Extension Host returned an invalid initialization handshake',
          {
            issues: initializationResponse.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message
            }))
          }
        )
      }
      const negotiatedRpcVersion = this.compatibilityReport.rpc.negotiated
      const expectedApiVersion = this.compatibilityReport.api.compatible
        ? this.compatibilityReport.api.negotiatedApiVersion
        : undefined
      if (
        negotiatedRpcVersion === undefined ||
        initializationResponse.data.rpcVersion !== negotiatedRpcVersion ||
        expectedApiVersion === undefined ||
        initializationResponse.data.apiVersion !== expectedApiVersion
      ) {
        throw extensionError(
          'EXTENSION_HOST_HANDSHAKE_MISMATCH',
          'Extension Host handshake does not match the admitted API and RPC versions',
          {
            expected: {
              rpcVersion: negotiatedRpcVersion,
              apiVersion: expectedApiVersion
            },
            received: initializationResponse.data
          }
        )
      }
      const loadResponse = HostLoadResponseSchema.safeParse(
        await peer.request('host.load', null, { timeoutMs: this.limits.activationTimeoutMs })
      )
      if (!loadResponse.success) {
        throw extensionError('EXTENSION_HOST_LOAD_INVALID', 'Extension Host returned an invalid load response', {
          issues: loadResponse.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        })
      }
      this._state = 'initialized'
      await this.log.write(
        'lifecycle',
        `initialized pid=${child.pid ?? 'unknown'} api=${expectedApiVersion} rpc=${negotiatedRpcVersion}`
      )
    } catch (error) {
      this.recordFatal(error)
      await this.terminate()
      throw asExtensionError(error, 'EXTENSION_ACTIVATION_FAILED', 'Extension host initialization failed')
    }
  }

  async activate(event: string): Promise<void> {
    if (this._state === 'active') return
    await this.start()
    if (this._state !== 'initialized') {
      throw extensionError('EXTENSION_HOST_UNAVAILABLE', 'Extension host is not initialized', {
        extensionId: this.principal.extensionId,
        state: this._state
      })
    }
    this._state = 'activating'
    try {
      await this.peer!.request('extension.activate', { event }, {
        timeoutMs: this.limits.activationTimeoutMs
      })
      this._state = 'active'
      await this.log.write('lifecycle', `activated event=${event}`)
    } catch (error) {
      this.recordFatal(error)
      await this.terminate()
      throw asExtensionError(error, 'EXTENSION_ACTIVATION_FAILED', 'Extension activation failed')
    }
  }

  async invoke(
    method: string,
    params: JsonValue,
    options: { signal?: AbortSignal; timeoutMs?: number; resetTimeoutOnStream?: boolean } = {}
  ): Promise<JsonValue> {
    if (this._state !== 'active') {
      throw extensionError('EXTENSION_NOT_ACTIVE', 'Extension is not active', {
        extensionId: this.principal.extensionId,
        state: this._state
      })
    }
    try {
      return await this.peer!.request('extension.invoke', { method, params }, {
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? this.limits.operationTimeoutMs,
        resetTimeoutOnStream: options.resetTimeoutOnStream
      })
    } catch (error) {
      if (
        this.exitPromise !== undefined &&
        this.child !== undefined &&
        (this.child.exitCode !== null || this.child.signalCode !== null)
      ) {
        await this.exitPromise
      }
      throw error
    }
  }

  async notify(method: string, params: JsonValue): Promise<void> {
    if (this._state !== 'active') {
      throw extensionError('EXTENSION_NOT_ACTIVE', 'Extension is not active', {
        extensionId: this.principal.extensionId,
        state: this._state
      })
    }
    await this.peer!.notify(method, params)
  }

  async migrateState(
    from: number,
    to: number,
    state: JsonValue,
    options: { scope: 'global' | 'workspace'; workspace?: JsonValue; signal?: AbortSignal }
  ): Promise<JsonValue> {
    await this.start()
    return this.peer!.request('extension.migrateState', {
      from,
      to,
      state,
      scope: options.scope,
      ...(options.workspace === undefined ? {} : { workspace: options.workspace })
    }, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      timeoutMs: this.limits.operationTimeoutMs
    })
  }

  async deactivate(): Promise<void> {
    if (this.child === undefined || this._state === 'stopped') return
    this._state = 'deactivating'
    this.stopRequested = true
    this.peer?.cancelPending(
      extensionError('EXTENSION_HOST_DEACTIVATING', 'Extension host is deactivating')
    )
    try {
      await this.peer?.request('extension.deactivate', null, {
        timeoutMs: this.limits.shutdownTimeoutMs
      })
    } catch (error) {
      await this.log.write('lifecycle', `deactivate failed: ${safeErrorMessage(error)}`)
    }
    await this.terminate()
  }

  async terminate(expected = true): Promise<void> {
    const child = this.child
    if (child === undefined) {
      this._state = 'stopped'
      return
    }
    this.stopRequested = expected
    this.peer?.close(extensionError('EXTENSION_HOST_CLOSED', 'Extension host was stopped'))
    if (child.connected) child.disconnect()
    const exited = await waitFor(this.exitPromise!, this.limits.shutdownTimeoutMs)
    if (!exited && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      const terminated = await waitFor(this.exitPromise!, this.limits.cancellationGraceMs)
      if (!terminated && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    await this.exitPromise
  }

  private async handleBrokerRequest(
    method: string,
    params: JsonValue,
    context: RpcRequestContext
  ): Promise<JsonValue> {
    const requiredPermission = this.options.requiredPermission?.(method, params)
    if (
      requiredPermission !== undefined &&
      !this.principal.grantedPermissions.includes(requiredPermission)
    ) {
      throw extensionError('EXTENSION_PERMISSION_DENIED', 'Extension broker permission is not granted', {
        method,
        permission: requiredPermission,
        extensionId: this.principal.extensionId
      })
    }
    if (this.options.broker === undefined) {
      throw extensionError('EXTENSION_HOST_METHOD_UNSUPPORTED', 'Extension broker method is unavailable', {
        method
      })
    }
    return this.options.broker({
      principal: this.principal,
      method,
      params,
      signal: context.signal,
      requestId: context.id
    })
  }

  private async handleNotification(method: string, params: JsonValue): Promise<void> {
    if (method === 'host.metrics') {
      const rss = isRecord(params) && typeof params.rss === 'number' ? params.rss : undefined
      if (rss !== undefined && rss > this.limits.maxMemoryBytes) {
        await this.protocolFailure(
          extensionError('EXTENSION_HOST_MEMORY_LIMIT', 'Extension host exceeded memory limit', {
            rss,
            maximum: this.limits.maxMemoryBytes
          })
        )
        return
      }
    }
    if (method === 'host.fatal') {
      this.recordFatal(extensionError(
        isRecord(params) && typeof params.code === 'string'
          ? params.code
          : 'EXTENSION_HOST_FATAL',
        isRecord(params) && typeof params.message === 'string'
          ? params.message
          : 'Extension host reported a fatal failure'
      ))
    }
    await this.options.onNotification?.(this.principal, method, params)
  }

  private recordEvent(): void {
    const now = Date.now()
    if (now - this.eventWindowStartedAt >= 1_000) {
      this.eventWindowStartedAt = now
      this.eventsInWindow = 0
    }
    this.eventsInWindow += 1
    if (this.eventsInWindow > this.limits.maxEventsPerSecond) {
      throw extensionError('EXTENSION_HOST_EVENT_RATE_LIMIT', 'Extension host event rate exceeded', {
        maximum: this.limits.maxEventsPerSecond
      })
    }
  }

  private async protocolFailure(error: unknown): Promise<void> {
    this.recordFatal(error)
    await this.log.write('lifecycle', `protocol failure: ${safeErrorMessage(error)}`)
    await this.terminate(false)
  }

  private recordFatal(error: unknown): void {
    this._lastError = serializeError(error)
  }

  private async handleExit(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    const expected = this.stopRequested
    this.peer?.close(extensionError(
      expected ? 'EXTENSION_HOST_CLOSED' : 'EXTENSION_HOST_CRASHED',
      expected ? 'Extension host stopped' : 'Extension host exited unexpectedly',
      { code, signal }
    ))
    this._state = expected ? 'stopped' : 'crashed'
    if (!expected && this._lastError === undefined) {
      this._lastError = serializeError(extensionError(
        'EXTENSION_HOST_CRASHED',
        'Extension host exited unexpectedly',
        { code, signal }
      ))
    }
    await this.log.write('lifecycle', `exited expected=${expected} code=${code} signal=${signal}`)
      .catch(() => undefined)
    await this.log.flush().catch(() => undefined)
    try {
      await this.options.onExit?.({
        extensionId: this.principal.extensionId,
        lifecycleNonce: this.lifecycleNonce,
        expected,
        code,
        signal,
        ...(this._lastError === undefined ? {} : { error: this._lastError })
      })
    } finally {
      this.resolveExit?.()
      this.resolveExit = undefined
    }
  }

  private send(envelope: RpcEnvelope): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const child = this.child
      if (child === undefined || !child.connected) {
        reject(extensionError('EXTENSION_HOST_CLOSED', 'Extension host IPC channel is closed'))
        return
      }
      child.send(envelope, (error) => {
        if (error !== null) reject(error)
        else resolvePromise()
      })
    })
  }
}

export function resolveHostLimits(overrides: Partial<ExtensionHostLimits> = {}): ExtensionHostLimits {
  const limits: ExtensionHostLimits = {
    activationTimeoutMs: overrides.activationTimeoutMs ?? DEFAULT_EXTENSION_ACTIVATION_TIMEOUT_MS,
    operationTimeoutMs: overrides.operationTimeoutMs ?? DEFAULT_EXTENSION_REQUEST_TIMEOUT_MS,
    cancellationGraceMs: overrides.cancellationGraceMs ?? DEFAULT_EXTENSION_CANCELLATION_GRACE_MS,
    shutdownTimeoutMs: overrides.shutdownTimeoutMs ?? DEFAULT_EXTENSION_SHUTDOWN_TIMEOUT_MS,
    maxMessageBytes: overrides.maxMessageBytes ?? DEFAULT_EXTENSION_MESSAGE_BYTES,
    maxConcurrentRequests:
      overrides.maxConcurrentRequests ?? DEFAULT_EXTENSION_CONCURRENT_REQUESTS,
    streamWindow: overrides.streamWindow ?? DEFAULT_EXTENSION_STREAM_WINDOW,
    maxStreamBufferBytes:
      overrides.maxStreamBufferBytes ?? DEFAULT_EXTENSION_STREAM_BUFFER_BYTES,
    maxMemoryBytes: overrides.maxMemoryBytes ?? DEFAULT_EXTENSION_MEMORY_BYTES,
    maxEventsPerSecond: overrides.maxEventsPerSecond ?? DEFAULT_EXTENSION_EVENTS_PER_SECOND,
    maxLogBytes: overrides.maxLogBytes ?? DEFAULT_EXTENSION_LOG_BYTES,
    logRetention: overrides.logRetention ?? DEFAULT_EXTENSION_LOG_RETENTION
  }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw extensionError('EXTENSION_HOST_LIMIT_INVALID', 'Extension host limit is invalid', {
        name,
        value
      })
    }
  }
  return limits
}

export function minimalExtensionEnvironment(
  additions: Record<string, string | undefined> = {}
): NodeJS.ProcessEnv {
  const allowed = [
    'HOME',
    'USERPROFILE',
    'PATH',
    'PATHEXT',
    'TMPDIR',
    'TMP',
    'TEMP',
    'SystemRoot',
    'WINDIR',
    'LANG',
    'LC_ALL',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR'
  ]
  const environment: NodeJS.ProcessEnv = {}
  for (const name of allowed) {
    const value = process.env[name]
    if (value !== undefined) environment[name] = value
  }
  if (environment.TMPDIR === undefined && process.platform !== 'win32') environment.TMPDIR = tmpdir()
  for (const [name, value] of Object.entries(additions)) {
    if (value !== undefined) environment[name] = value
  }
  return environment
}

function serializeError(error: unknown): {
  code: string
  message: string
  details: ExtensionErrorDetails
} {
  const normalized = asExtensionError(error)
  return {
    code: normalized.code,
    message: redactSecretText(normalized.message).slice(0, 2_000),
    details: redactSecrets(structuredClone(normalized.details))
  }
}

function safeErrorMessage(error: unknown): string {
  return redactSecretText(error instanceof Error ? error.message : String(error)).slice(0, 1_000)
}

function waitFor(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs)
    timer.unref?.()
    promise.then(
      () => {
        clearTimeout(timer)
        resolvePromise(true)
      },
      () => {
        clearTimeout(timer)
        resolvePromise(true)
      }
    )
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertHostAdmission(
  extension: ResolvedExtension,
  value: CompatibilityReport
): CompatibilityReport {
  const report = CompatibilityReportSchema.parse(value)
  const identityMatches =
    report.extensionVersion === extension.version &&
    report.extensionVersion === extension.manifest.version &&
    report.manifestVersion === extension.manifest.manifestVersion &&
    report.api.declaredApiVersion === extension.manifest.apiVersion &&
    report.kunEngine.declared === extension.manifest.engines.kun &&
    report.stateSchemaVersion === extension.manifest.stateSchemaVersion
  const compatible = report.api.compatible &&
    report.kunEngine.compatible &&
    report.rpc.compatible &&
    report.rpc.declared === EXTENSION_RPC_VERSION &&
    report.rpc.negotiated === EXTENSION_RPC_VERSION &&
    report.diagnostics.every((diagnostic) => diagnostic.compatible)
  if (!identityMatches || !compatible) {
    throw extensionError(
      'EXTENSION_HOST_ADMISSION_FAILED',
      'Extension Host cannot start without a matching compatible admission report',
      {
        extensionId: extension.id,
        version: extension.version,
        identityMatches,
        compatibility: report
      }
    )
  }
  return report
}
