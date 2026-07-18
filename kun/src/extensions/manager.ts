import { join, resolve } from 'node:path'
import type { CompatibilityReport, ExtensionManifest, WorkspaceContext } from '@kun/extension-api'
import { AtomicJsonFile } from './atomic-json.js'
import { asExtensionError, extensionError, type ExtensionErrorDetails } from './errors.js'
import { redactSecrets, redactSecretText } from '../config/secret-redaction.js'
import {
  ExtensionHostProcess,
  type ExtensionBrokerRequest,
  type ExtensionHostExit,
  type ExtensionHostLimits,
  type ExtensionPrincipal
} from './host-process.js'
import type { ExtensionPackageLifecycle, ExtensionPackageManager } from './package-manager.js'
import type { ExtensionPaths } from './paths.js'
import type { JsonValue, ResolvedExtension } from './types.js'

export const DEFAULT_EXTENSION_CRASH_THRESHOLD = 3
export const DEFAULT_EXTENSION_RESTART_BACKOFF_MS = 250
export const DEFAULT_EXTENSION_RESTART_BACKOFF_MAX_MS = 10_000
export const DEFAULT_EXTENSION_HEALTHY_RESET_MS = 60_000
export const DEFAULT_EXTENSION_VIEW_IDLE_TIMEOUT_MS = 30_000

type PersistedHostHealth = {
  extensionId: string
  version?: string
  lifecycleState: string
  activationEvent?: string
  processId?: number
  restartCount: number
  consecutiveFailures: number
  circuitOpen: boolean
  nextRetryAt?: string
  lastError?: { code: string; message: string; details: ExtensionErrorDetails }
  logPath?: string
  updatedAt: string
}

type HostHealthDocument = {
  schemaVersion: 1
  revision: number
  extensions: Record<string, PersistedHostHealth>
}

export type ExtensionHostDiagnostic = PersistedHostHealth & {
  active: boolean
  compatibility?: CompatibilityReport
  negotiatedApiVersion?: string
  negotiatedRpcVersion?: number
}

export type ExtensionHostWorkspaceScope = {
  workspaceRoot?: string
  workspaceRoots?: string[]
  workspaceContext?: WorkspaceContext
}

export type ExtensionHostNotificationScope =
  | ExtensionHostWorkspaceScope
  | { workspaceKey: string }

export type ExtensionManagerOptions = {
  packageManager: ExtensionPackageManager
  paths: ExtensionPaths
  runnerPath?: string
  capabilitiesForExtension?(extension: ResolvedExtension): string[]
  hostLimits?: Partial<ExtensionHostLimits>
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
  /** Dispose broker-owned registrations before a crashed host can reactivate. */
  onHostExit?(exit: ExtensionHostExit, principal: ExtensionPrincipal): void | Promise<void>
  /** Bind retained Views to the exact Host process generation that activated. */
  onHostActivated?(principal: ExtensionPrincipal): void | Promise<void>
  crashThreshold?: number
  restartBackoffMs?: number
  restartBackoffMaxMs?: number
  healthyResetMs?: number
  /** Grace period after the last View closes for extensions with no background contribution. */
  viewIdleTimeoutMs?: number
  now?: () => Date
}

export class ExtensionManager {
  /** Host lifecycle state is isolated by extension identity plus normalized workspace ownership. */
  private readonly hosts = new Map<string, ExtensionHostProcess>()
  private readonly activationEpochs = new Map<string, number>()
  private readonly workspaceActivationEpochs = new Map<string, number>()
  private readonly activations = new Map<string, {
    extensionId: string
    epoch: string
    event: string
    workspaceRoots: string[]
    workspaceContextSignature: string
    promise: Promise<ExtensionHostProcess | undefined>
  }>()
  private readonly healthyTimers = new Map<string, NodeJS.Timeout>()
  private readonly idleTimers = new Map<string, NodeJS.Timeout>()
  private readonly viewReferences = new Map<string, number>()
  private readonly idleEligibleExtensions = new Set<string>()
  private readonly stops = new Map<string, Promise<void>>()
  private readonly hostExitCleanups = new Map<string, Promise<void>>()
  private readonly recordedFailures = new WeakSet<ExtensionHostProcess>()
  private readonly healthFile: AtomicJsonFile<HostHealthDocument>
  private readonly crashThreshold: number
  private readonly restartBackoffMs: number
  private readonly restartBackoffMaxMs: number
  private readonly healthyResetMs: number
  private readonly viewIdleTimeoutMs: number
  private shuttingDown = false

  constructor(private readonly options: ExtensionManagerOptions) {
    this.crashThreshold = positiveInteger(
      options.crashThreshold,
      DEFAULT_EXTENSION_CRASH_THRESHOLD,
      'crashThreshold'
    )
    this.restartBackoffMs = positiveInteger(
      options.restartBackoffMs,
      DEFAULT_EXTENSION_RESTART_BACKOFF_MS,
      'restartBackoffMs'
    )
    this.restartBackoffMaxMs = positiveInteger(
      options.restartBackoffMaxMs,
      DEFAULT_EXTENSION_RESTART_BACKOFF_MAX_MS,
      'restartBackoffMaxMs'
    )
    this.healthyResetMs = positiveInteger(
      options.healthyResetMs,
      DEFAULT_EXTENSION_HEALTHY_RESET_MS,
      'healthyResetMs'
    )
    this.viewIdleTimeoutMs = positiveInteger(
      options.viewIdleTimeoutMs,
      DEFAULT_EXTENSION_VIEW_IDLE_TIMEOUT_MS,
      'viewIdleTimeoutMs'
    )
    this.healthFile = new AtomicJsonFile(
      join(options.paths.dataRoot, 'host-health.json'),
      validateHealthDocument
    )
  }

  async activate(
    extensionId: string,
    event: string,
    options: ExtensionHostWorkspaceScope = {}
  ): Promise<ExtensionHostProcess | undefined> {
    const workspaceRoots = normalizedWorkspaceRoots(options)
    const instanceKey = extensionHostInstanceKey(extensionId, { workspaceRoots })
    this.cancelIdleDeactivation(instanceKey)
    await this.waitForLifecycleTransition(instanceKey)
    const workspaceContextSignature = JSON.stringify(options.workspaceContext ?? null)
    const epoch = this.activationEpoch(extensionId, workspaceRoots)
    const existing = this.activations.get(instanceKey)
    if (existing !== undefined) {
      if (
        existing.epoch === epoch &&
        existing.event === event &&
        existing.workspaceContextSignature === workspaceContextSignature &&
        sameWorkspaceRoots(existing.workspaceRoots, workspaceRoots)
      ) return existing.promise
      // A pending activation is bound to its own admitted workspace scope.
      // Wait for it to settle, then run normal admission for this distinct
      // scope/event; never reuse its promise across a trust boundary.
      await existing.promise.catch(() => undefined)
      return this.activate(extensionId, event, options)
    }
    const activation = this.activateInternal(extensionId, event, options, epoch, instanceKey)
    this.activations.set(instanceKey, {
      extensionId,
      epoch,
      event,
      workspaceRoots,
      workspaceContextSignature,
      promise: activation
    })
    try {
      return await activation
    } finally {
      if (this.activations.get(instanceKey)?.promise === activation) this.activations.delete(instanceKey)
      this.scheduleIdleDeactivation(instanceKey, extensionId)
    }
  }

  /** Retain a Node Host synchronously before a View begins asynchronous activation. */
  retainView(extensionId: string, options: ExtensionHostWorkspaceScope = {}): void {
    const instanceKey = extensionHostInstanceKey(extensionId, options)
    this.viewReferences.set(instanceKey, (this.viewReferences.get(instanceKey) ?? 0) + 1)
    this.cancelIdleDeactivation(instanceKey)
  }

  activeHostGeneration(
    extensionId: string,
    options: ExtensionHostWorkspaceScope = {}
  ): string | undefined {
    const host = this.hosts.get(extensionHostInstanceKey(extensionId, options))
    return host?.state === 'active' ? host.lifecycleNonce : undefined
  }

  /** Release one View reference and start the bounded grace period at zero. */
  releaseView(extensionId: string, options: ExtensionHostWorkspaceScope = {}): void {
    const instanceKey = extensionHostInstanceKey(extensionId, options)
    const current = this.viewReferences.get(instanceKey) ?? 0
    if (current <= 1) this.viewReferences.delete(instanceKey)
    else this.viewReferences.set(instanceKey, current - 1)
    if (current > 0) this.scheduleIdleDeactivation(instanceKey, extensionId)
  }

  get pendingIdleDeactivationCount(): number {
    return this.idleTimers.size
  }

  async invoke(
    extensionId: string,
    activationEvent: string,
    method: string,
    params: JsonValue,
    options: ExtensionHostWorkspaceScope & {
      signal?: AbortSignal
      timeoutMs?: number
      resetTimeoutOnStream?: boolean
    } = {}
  ): Promise<JsonValue> {
    // New broker work is rejected while teardown owns this Host scope. View
    // activation may wait and reopen after cleanup, but an old provider/tool
    // registration must not reactivate itself from its own dispose callback.
    const instanceKey = extensionHostInstanceKey(extensionId, options)
    if (this.stops.has(instanceKey) || this.hostExitCleanups.has(instanceKey)) {
      throw extensionError(
        'EXTENSION_HOST_DEACTIVATING',
        'Extension host is deactivating',
        { extensionId, method }
      )
    }
    const host = await this.activate(extensionId, activationEvent, options)
    if (host === undefined) {
      throw extensionError('EXTENSION_HEADLESS_ENTRYPOINT_REQUIRED', 'Browser-only extension has no Node host', {
        extensionId
      })
    }
    return host.invoke(method, params, options)
  }

  async notify(
    extensionId: string,
    method: string,
    params: JsonValue,
    options?: ExtensionHostNotificationScope
  ): Promise<void> {
    const hosts = options === undefined
      ? [...this.hosts.values()].filter((host) =>
          host.principal.extensionId === extensionId && host.state === 'active')
      : 'workspaceKey' in options
        ? [...this.hosts.values()].filter((host) =>
            host.principal.extensionId === extensionId &&
            host.state === 'active' &&
            host.principal.workspaceRoots.some(
              (root) => this.options.paths.workspaceKey(root) === options.workspaceKey
            ))
        : [this.hosts.get(extensionHostInstanceKey(extensionId, options))]
            .filter((host): host is ExtensionHostProcess => host?.state === 'active')
    if (hosts.length === 0) {
      throw extensionError('EXTENSION_NOT_ACTIVE', 'Cannot notify an inactive extension host', {
        extensionId,
        method
      })
    }
    await Promise.all(hosts.map((host) => host.notify(method, params)))
  }

  async deactivate(extensionId: string): Promise<void> {
    this.activationEpochs.set(extensionId, (this.activationEpochs.get(extensionId) ?? 0) + 1)
    const instanceKeys = this.instanceKeys(extensionId)
    for (const instanceKey of instanceKeys) this.cancelIdleDeactivation(instanceKey)
    try {
      await Promise.all(instanceKeys.map((instanceKey) => this.stopHost(instanceKey, extensionId)))
    } finally {
      for (const instanceKey of instanceKeys) this.idleEligibleExtensions.delete(instanceKey)
    }
  }

  /** Stop only Host instances whose admitted scope contains one workspace. */
  async deactivateWorkspace(extensionId: string, workspaceKey: string): Promise<void> {
    const epochKey = workspaceActivationEpochKey(extensionId, workspaceKey)
    this.workspaceActivationEpochs.set(
      epochKey,
      (this.workspaceActivationEpochs.get(epochKey) ?? 0) + 1
    )
    const instanceKeys = this.instanceKeys(extensionId, workspaceKey)
    for (const instanceKey of instanceKeys) this.cancelIdleDeactivation(instanceKey)
    try {
      await Promise.all(instanceKeys.map((instanceKey) => this.stopHost(instanceKey, extensionId)))
    } finally {
      for (const instanceKey of instanceKeys) this.idleEligibleExtensions.delete(instanceKey)
    }
  }

  private async stopHost(instanceKey: string, extensionId: string): Promise<void> {
    const existing = this.stops.get(instanceKey)
    if (existing !== undefined) return existing
    const stopping = this.stopHostInternal(instanceKey, extensionId)
    this.stops.set(instanceKey, stopping)
    try {
      await stopping
    } finally {
      if (this.stops.get(instanceKey) === stopping) this.stops.delete(instanceKey)
    }
  }

  private async stopHostInternal(instanceKey: string, extensionId: string): Promise<void> {
    this.cancelIdleDeactivation(instanceKey)
    this.idleEligibleExtensions.delete(instanceKey)
    const timer = this.healthyTimers.get(instanceKey)
    if (timer !== undefined) clearTimeout(timer)
    this.healthyTimers.delete(instanceKey)
    const host = this.hosts.get(instanceKey)
    if (host === undefined) {
      await this.waitForHostExitCleanup(instanceKey)
      return
    }
    this.hosts.delete(instanceKey)
    await host.deactivate()
    await this.waitForHostExitCleanup(instanceKey)
    await this.updateHealth(extensionId, (health) => ({
      ...health,
      lifecycleState: 'stopped',
      processId: undefined,
      updatedAt: this.now().toISOString()
    }))
  }

  private activationEpoch(extensionId: string, workspaceRoots: readonly string[]): string {
    return JSON.stringify([
      this.activationEpochs.get(extensionId) ?? 0,
      workspaceRoots.map((root) => {
        const workspaceKey = this.options.paths.workspaceKey(root)
        return [
          workspaceKey,
          this.workspaceActivationEpochs.get(
            workspaceActivationEpochKey(extensionId, workspaceKey)
          ) ?? 0
        ]
      })
    ])
  }

  private instanceKeys(extensionId: string, workspaceKey?: string): string[] {
    const keys = new Set<string>()
    for (const [instanceKey, host] of this.hosts) {
      if (
        host.principal.extensionId === extensionId &&
        (workspaceKey === undefined || host.principal.workspaceRoots.some(
          (root) => this.options.paths.workspaceKey(root) === workspaceKey
        ))
      ) keys.add(instanceKey)
    }
    for (const [instanceKey, activation] of this.activations) {
      if (
        activation.extensionId === extensionId &&
        (workspaceKey === undefined || activation.workspaceRoots.some(
          (root) => this.options.paths.workspaceKey(root) === workspaceKey
        ))
      ) keys.add(instanceKey)
    }
    for (const instanceKey of [...this.stops.keys(), ...this.hostExitCleanups.keys()]) {
      const identity = identityFromInstanceKey(instanceKey)
      if (
        identity?.extensionId === extensionId &&
        (workspaceKey === undefined || identity.workspaceRoots.some(
          (root) => this.options.paths.workspaceKey(root) === workspaceKey
        ))
      ) keys.add(instanceKey)
    }
    return [...keys]
  }

  private assertActivationCurrent(
    extensionId: string,
    workspaceRoots: readonly string[],
    expectedEpoch: string
  ): void {
    if (this.activationEpoch(extensionId, workspaceRoots) !== expectedEpoch) {
      throw extensionError(
        'EXTENSION_ACTIVATION_CANCELLED',
        'Extension activation was invalidated by a lifecycle or permission change',
        { extensionId }
      )
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    for (const timer of this.idleTimers.values()) clearTimeout(timer)
    this.idleTimers.clear()
    const extensionIds = [...new Set([
      ...[...this.hosts.values()].map((host) => host.principal.extensionId),
      ...[...this.activations.values()].map((activation) => activation.extensionId)
    ])]
    await Promise.allSettled(extensionIds.map((extensionId) => this.deactivate(extensionId)))
    await Promise.allSettled([
      ...[...this.activations.values()].map((activation) => activation.promise),
      ...this.stops.values(),
      ...this.hostExitCleanups.values()
    ])
    for (const timer of this.healthyTimers.values()) clearTimeout(timer)
    this.healthyTimers.clear()
    this.idleEligibleExtensions.clear()
    this.viewReferences.clear()
  }

  async retry(extensionId: string): Promise<void> {
    await this.deactivate(extensionId)
    await this.updateHealth(extensionId, (health) => ({
      ...health,
      lifecycleState: 'inactive',
      circuitOpen: false,
      consecutiveFailures: 0,
      nextRetryAt: undefined,
      lastError: undefined,
      updatedAt: this.now().toISOString()
    }))
  }

  async diagnostic(extensionId: string): Promise<ExtensionHostDiagnostic> {
    const [document, selectedCompatibility] = await Promise.all([
      this.readHealth(),
      this.options.packageManager.compatibilityReportForExtension(extensionId)
    ])
    const persisted = document.extensions[extensionId] ?? emptyHealth(extensionId, this.now())
    const host = [...this.hosts.values()].find((candidate) =>
      candidate.principal.extensionId === extensionId && candidate.state === 'active') ??
      [...this.hosts.values()].find((candidate) => candidate.principal.extensionId === extensionId)
    const compatibility = host?.compatibilityReport ?? selectedCompatibility
    const negotiatedApiVersion = compatibility?.api.compatible
      ? compatibility.api.negotiatedApiVersion
      : undefined
    return {
      ...structuredClone(persisted),
      active: host?.state === 'active',
      processId: host?.pid,
      lifecycleState: host === undefined && persisted.lifecycleState === 'active'
        ? 'inactive'
        : host?.state ?? persisted.lifecycleState,
      ...(host === undefined ? {} : { logPath: host.logPath }),
      ...(compatibility === undefined ? {} : { compatibility: structuredClone(compatibility) }),
      ...(negotiatedApiVersion === undefined ? {} : { negotiatedApiVersion }),
      ...(compatibility?.rpc.negotiated === undefined
        ? {}
        : { negotiatedRpcVersion: compatibility.rpc.negotiated })
    }
  }

  async listDiagnostics(): Promise<ExtensionHostDiagnostic[]> {
    const document = await this.readHealth()
    const extensionIds = new Set([
      ...Object.keys(document.extensions),
      ...[...this.hosts.values()].map((host) => host.principal.extensionId)
    ])
    return Promise.all([...extensionIds].sort().map((extensionId) => this.diagnostic(extensionId)))
  }

  async migrateState(
    extension: ResolvedExtension,
    from: number,
    to: number,
    state: JsonValue,
    options: { scope: 'global' | 'workspace'; workspace?: JsonValue; signal?: AbortSignal }
  ): Promise<JsonValue> {
    const host = this.createHost(extension, [])
    try {
      return await host.migrateState(from, to, state, options)
    } finally {
      await host.deactivate().catch(() => host.terminate())
    }
  }

  packageLifecycle(): ExtensionPackageLifecycle {
    return {
      beforeVersionSwitch: async ({ extensionId }) => this.deactivate(extensionId),
      beforeDisable: async (extensionId, workspaceKey) => workspaceKey === undefined
        ? this.deactivate(extensionId)
        : this.deactivateWorkspace(extensionId, workspaceKey),
      beforePermissionChange: async (extensionId, workspaceKey) =>
        this.deactivateWorkspace(extensionId, workspaceKey),
      beforeUninstall: async (extensionId) => this.deactivate(extensionId)
    }
  }

  private async activateInternal(
    extensionId: string,
    event: string,
    options: ExtensionHostWorkspaceScope,
    activationEpoch: string,
    instanceKey: string
  ): Promise<ExtensionHostProcess | undefined> {
    const workspaceRoots = normalizedWorkspaceRoots(options)
    const workspaceKeys = workspaceRoots.map((root) => this.options.paths.workspaceKey(root))
    let extension: ResolvedExtension
    try {
      const resolvedScopes: ResolvedExtension[] = []
      if (workspaceKeys.length === 0) {
        resolvedScopes.push(await this.options.packageManager.resolveForActivation(extensionId))
      } else {
        // Every root is an independent trust/enablement boundary. Resolving
        // only `workspaceRoot` while passing additional `workspaceRoots` to
        // the Host would let callers smuggle an unreviewed root into the
        // principal. The Host receives the intersection of all grants.
        for (const workspaceKey of workspaceKeys) {
          resolvedScopes.push(await this.options.packageManager.resolveForActivation(
            extensionId,
            workspaceKey
          ))
        }
      }
      extension = intersectWorkspaceResolutions(resolvedScopes)
      this.assertActivationCurrent(extensionId, workspaceRoots, activationEpoch)
    } catch (error) {
      if ((error as { code?: string }).code === 'EXTENSION_ACTIVATION_CANCELLED') throw error
      const normalized = asExtensionError(
        error,
        'EXTENSION_ACTIVATION_ADMISSION_FAILED',
        'Extension activation admission failed'
      )
      await this.updateHealth(extensionId, (prior) => ({
        ...prior,
        lifecycleState: isCompatibilityError(normalized.code) ? 'incompatible' : 'unavailable',
        processId: undefined,
        lastError: {
          code: normalized.code,
          message: redactSecretText(normalized.message).slice(0, 2_000),
          details: redactSecrets(structuredClone(normalized.details))
        },
        updatedAt: this.now().toISOString()
      }))
      throw error
    }
    if (!activationMatches(extension.manifest.activationEvents, event)) {
      throw extensionError(
        'EXTENSION_ACTIVATION_EVENT_NOT_DECLARED',
        'Activation event is not declared by the extension',
        { extensionId, event }
      )
    }
    if (extension.manifest.main === undefined) {
      this.idleEligibleExtensions.delete(instanceKey)
      this.cancelIdleDeactivation(instanceKey)
      this.assertActivationCurrent(extensionId, workspaceRoots, activationEpoch)
      await this.updateHealth(extensionId, (health) => ({
        ...health,
        version: extension.version,
        lifecycleState: 'browser-only',
        activationEvent: event,
        updatedAt: this.now().toISOString()
      }))
      if (this.activationEpoch(extensionId, workspaceRoots) !== activationEpoch) {
        await this.updateHealth(extensionId, (health) => ({
          ...health,
          lifecycleState: 'stopped',
          processId: undefined,
          updatedAt: this.now().toISOString()
        }))
        this.assertActivationCurrent(extensionId, workspaceRoots, activationEpoch)
      }
      return undefined
    }

    const current = this.hosts.get(instanceKey)
    if (
      current !== undefined &&
      current.principal.version === extension.version &&
      current.principal.development === extension.development &&
      current.state === 'active'
    ) {
      this.setIdleEligibility(instanceKey, extension.manifest)
      assertWorkspaceScope(
        current.principal,
        workspaceRoots
      )
      this.assertActivationCurrent(extensionId, workspaceRoots, activationEpoch)
      return current
    }
    if (current !== undefined) await this.stopHost(instanceKey, extensionId)

    const health = (await this.readHealth()).extensions[extensionId] ?? emptyHealth(extensionId, this.now())
    if (health.circuitOpen) {
      throw extensionError('EXTENSION_HOST_CIRCUIT_OPEN', 'Extension host circuit is open', {
        extensionId,
        consecutiveFailures: health.consecutiveFailures,
        lastError: health.lastError
      })
    }
    if (health.nextRetryAt !== undefined && Date.parse(health.nextRetryAt) > this.now().getTime()) {
      throw extensionError('EXTENSION_HOST_RESTART_BACKOFF', 'Extension host is in restart backoff', {
        extensionId,
        retryAt: health.nextRetryAt
      })
    }
    this.assertActivationCurrent(extensionId, workspaceRoots, activationEpoch)

    const host = this.createHost(extension, workspaceRoots, options.workspaceContext)
    this.hosts.set(instanceKey, host)
    try {
      await this.updateHealth(extensionId, (prior) => ({
        ...prior,
        version: extension.version,
        lifecycleState: 'activating',
        activationEvent: event,
        restartCount: prior.restartCount + (prior.consecutiveFailures > 0 ? 1 : 0),
        processId: undefined,
        logPath: host.logPath,
        updatedAt: this.now().toISOString()
      }))
      this.assertActivationCurrent(extensionId, workspaceRoots, activationEpoch)
      await host.activate(event)
      this.assertActivationCurrent(extensionId, workspaceRoots, activationEpoch)
      await this.updateHealth(extensionId, (prior) => ({
        ...prior,
        version: extension.version,
        lifecycleState: 'active',
        activationEvent: event,
        processId: host.pid,
        nextRetryAt: undefined,
        logPath: host.logPath,
        updatedAt: this.now().toISOString()
      }))
      this.assertActivationCurrent(extensionId, workspaceRoots, activationEpoch)
      this.scheduleHealthyReset(instanceKey, extensionId, host)
      this.setIdleEligibility(instanceKey, extension.manifest)
      await this.options.onHostActivated?.(host.principal)
      return host
    } catch (error) {
      if (this.hosts.get(instanceKey) === host) this.hosts.delete(instanceKey)
      if ((error as { code?: string }).code === 'EXTENSION_ACTIVATION_CANCELLED') {
        await host.deactivate().catch(() => host.terminate())
        await this.updateHealth(extensionId, (health) => ({
          ...health,
          lifecycleState: 'stopped',
          processId: undefined,
          updatedAt: this.now().toISOString()
        }))
        throw error
      }
      await this.recordHostFailure(extensionId, extension.version, host, error)
      throw error
    }
  }

  private createHost(
    extension: ResolvedExtension,
    workspaceRoots: string[],
    workspaceContext?: WorkspaceContext
  ): ExtensionHostProcess {
    const compatibilityReport = this.options.packageManager.admitManifest(extension.manifest)
    const negotiatedCapabilities = new Set(
      compatibilityReport.api.compatible ? compatibilityReport.api.capabilities : []
    )
    let host: ExtensionHostProcess
    host = new ExtensionHostProcess({
      extension,
      compatibilityReport,
      paths: this.options.paths,
      workspaceRoots,
      workspaceContext,
      capabilities: (this.options.capabilitiesForExtension?.(extension) ?? [])
        .filter((capability) => negotiatedCapabilities.has(capability)),
      runnerPath: this.options.runnerPath,
      limits: this.options.hostLimits,
      broker: this.options.broker,
      requiredPermission: this.options.requiredPermission,
      onNotification: this.options.onNotification,
      onStream: this.options.onStream,
      onExit: (exit) => this.handleHostExit(host, exit)
    })
    return host
  }

  private handleHostExit(host: ExtensionHostProcess, exit: ExtensionHostExit): Promise<void> {
    const instanceKey = extensionHostInstanceKey(exit.extensionId, {
      workspaceRoots: [...host.principal.workspaceRoots]
    })
    const prior = this.hostExitCleanups.get(instanceKey)
    const cleanup = (async () => {
      if (prior !== undefined) await prior
      await this.handleHostExitInternal(instanceKey, host, exit)
    })()
    this.hostExitCleanups.set(instanceKey, cleanup)
    cleanup.then(
      () => {
        if (this.hostExitCleanups.get(instanceKey) === cleanup) {
          this.hostExitCleanups.delete(instanceKey)
        }
      },
      () => {
        if (this.hostExitCleanups.get(instanceKey) === cleanup) {
          this.hostExitCleanups.delete(instanceKey)
        }
      }
    )
    return cleanup
  }

  private async handleHostExitInternal(
    instanceKey: string,
    host: ExtensionHostProcess,
    exit: ExtensionHostExit
  ): Promise<void> {
    if (this.hosts.get(instanceKey) === host) this.hosts.delete(instanceKey)
    this.cancelIdleDeactivation(instanceKey)
    this.idleEligibleExtensions.delete(instanceKey)
    const timer = this.healthyTimers.get(instanceKey)
    if (timer !== undefined) clearTimeout(timer)
    this.healthyTimers.delete(instanceKey)
    await this.options.onHostExit?.(exit, host.principal)
    if (!exit.expected) {
      await this.recordHostFailure(
        exit.extensionId,
        host.principal.version,
        host,
        exit.error === undefined
          ? extensionError('EXTENSION_HOST_CRASHED', 'Extension host crashed')
          : extensionError(exit.error.code, exit.error.message, exit.error.details)
      )
    }
  }

  private async waitForLifecycleTransition(instanceKey: string): Promise<void> {
    while (true) {
      const pending = this.stops.get(instanceKey) ?? this.hostExitCleanups.get(instanceKey)
      if (pending === undefined) return
      await pending
    }
  }

  private async waitForHostExitCleanup(instanceKey: string): Promise<void> {
    while (true) {
      const cleanup = this.hostExitCleanups.get(instanceKey)
      if (cleanup === undefined) return
      await cleanup
    }
  }

  private setIdleEligibility(
    instanceKey: string,
    manifest: ExtensionManifest
  ): void {
    if (isViewIdleDeactivationEligible(manifest)) {
      this.idleEligibleExtensions.add(instanceKey)
      return
    }
    this.idleEligibleExtensions.delete(instanceKey)
    this.cancelIdleDeactivation(instanceKey)
  }

  private scheduleIdleDeactivation(instanceKey: string, extensionId: string): void {
    if (
      this.shuttingDown ||
      this.idleTimers.has(instanceKey) ||
      (this.viewReferences.get(instanceKey) ?? 0) > 0 ||
      !this.idleEligibleExtensions.has(instanceKey)
    ) return
    const host = this.hosts.get(instanceKey)
    if (host === undefined || host.state !== 'active') return
    const timer = setTimeout(() => {
      if (this.idleTimers.get(instanceKey) !== timer) return
      this.idleTimers.delete(instanceKey)
      if (
        this.shuttingDown ||
        (this.viewReferences.get(instanceKey) ?? 0) > 0 ||
        !this.idleEligibleExtensions.has(instanceKey) ||
        this.hosts.get(instanceKey) !== host ||
        host.state !== 'active'
      ) return
      void this.stopHost(instanceKey, extensionId).catch(() => undefined)
    }, this.viewIdleTimeoutMs)
    timer.unref?.()
    this.idleTimers.set(instanceKey, timer)
  }

  private cancelIdleDeactivation(instanceKey: string): void {
    const timer = this.idleTimers.get(instanceKey)
    if (timer !== undefined) clearTimeout(timer)
    this.idleTimers.delete(instanceKey)
  }

  private async recordFailure(
    extensionId: string,
    version: string,
    host: ExtensionHostProcess,
    error: unknown
  ): Promise<void> {
    const normalized = asExtensionError(error)
    await this.updateHealth(extensionId, (prior) => {
      const consecutiveFailures = prior.consecutiveFailures + 1
      const circuitOpen = consecutiveFailures >= this.crashThreshold
      const backoff = Math.min(
        this.restartBackoffMaxMs,
        this.restartBackoffMs * 2 ** Math.max(0, consecutiveFailures - 1)
      )
      return {
        ...prior,
        version,
        lifecycleState: circuitOpen ? 'circuit-open' : 'crashed',
        processId: undefined,
        consecutiveFailures,
        circuitOpen,
        nextRetryAt: circuitOpen
          ? undefined
          : new Date(this.now().getTime() + backoff).toISOString(),
        lastError: {
          code: normalized.code,
          message: redactSecretText(normalized.message).slice(0, 2_000),
          details: redactSecrets(structuredClone(normalized.details))
        },
        logPath: host.logPath,
        updatedAt: this.now().toISOString()
      }
    })
  }

  private async recordHostFailure(
    extensionId: string,
    version: string,
    host: ExtensionHostProcess,
    error: unknown
  ): Promise<void> {
    if (this.recordedFailures.has(host)) return
    this.recordedFailures.add(host)
    await this.recordFailure(extensionId, version, host, error)
  }

  private scheduleHealthyReset(
    instanceKey: string,
    extensionId: string,
    host: ExtensionHostProcess
  ): void {
    const prior = this.healthyTimers.get(instanceKey)
    if (prior !== undefined) clearTimeout(prior)
    const timer = setTimeout(() => {
      this.healthyTimers.delete(instanceKey)
      if (this.hosts.get(instanceKey) !== host || host.state !== 'active') return
      void this.updateHealth(extensionId, (health) => ({
        ...health,
        consecutiveFailures: 0,
        circuitOpen: false,
        nextRetryAt: undefined,
        updatedAt: this.now().toISOString()
      }))
    }, this.healthyResetMs)
    timer.unref?.()
    this.healthyTimers.set(instanceKey, timer)
  }

  private readHealth(): Promise<HostHealthDocument> {
    return this.healthFile.read(() => ({ schemaVersion: 1, revision: 0, extensions: {} }))
  }

  private updateHealth(
    extensionId: string,
    update: (health: PersistedHostHealth) => PersistedHostHealth
  ): Promise<HostHealthDocument> {
    return this.healthFile.update(
      () => ({ schemaVersion: 1, revision: 0, extensions: {} }),
      (document) => {
        const next = structuredClone(document)
        next.revision += 1
        next.extensions[extensionId] = update(
          next.extensions[extensionId] ?? emptyHealth(extensionId, this.now())
        )
        return next
      }
    )
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }
}

function emptyHealth(extensionId: string, now: Date): PersistedHostHealth {
  return {
    extensionId,
    lifecycleState: 'inactive',
    restartCount: 0,
    consecutiveFailures: 0,
    circuitOpen: false,
    updatedAt: now.toISOString()
  }
}

function validateHealthDocument(value: unknown): HostHealthDocument {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    !isRecord(value.extensions)
  ) {
    throw extensionError('EXTENSION_HOST_HEALTH_INVALID', 'Extension host health file is invalid')
  }
  for (const [extensionId, health] of Object.entries(value.extensions)) {
    if (
      !isRecord(health) ||
      health.extensionId !== extensionId ||
      typeof health.lifecycleState !== 'string' ||
      !Number.isSafeInteger(health.restartCount) ||
      !Number.isSafeInteger(health.consecutiveFailures) ||
      typeof health.circuitOpen !== 'boolean' ||
      typeof health.updatedAt !== 'string'
    ) {
      throw extensionError('EXTENSION_HOST_HEALTH_INVALID', 'Extension host health record is invalid', {
        extensionId
      })
    }
  }
  return value as unknown as HostHealthDocument
}

function activationMatches(declared: string[], event: string): boolean {
  return declared.includes('*') || declared.includes(event)
}

/**
 * A Node Host is idle-disposable only when every executable contribution is
 * View-scoped. Declarative layout/settings contributions do not keep it alive.
 */
export function isViewIdleDeactivationEligible(manifest: ExtensionManifest): boolean {
  if (
    manifest.main === undefined ||
    manifest.activationEvents.length === 0 ||
    manifest.activationEvents.some((event) => !event.startsWith('onView:'))
  ) return false
  const contributions = manifest.contributes
  return contributions.commands.length === 0 &&
    contributions.tools.length === 0 &&
    contributions.modelProviders.length === 0 &&
    contributions.authentication.length === 0 &&
    contributions.agentProfiles.length === 0 &&
    contributions.hostContentScripts.length === 0
}

function assertWorkspaceScope(principal: ExtensionPrincipal, requestedRoots: string[]): void {
  const granted = new Set(principal.workspaceRoots)
  const missing = requestedRoots.map((root) => root).filter((root) => !granted.has(root))
  if (missing.length > 0) {
    throw extensionError(
      'EXTENSION_WORKSPACE_SCOPE_MISMATCH',
      'Active extension host is not bound to the requested workspace roots',
      { missing }
    )
  }
}

export function extensionHostInstanceKey(
  extensionId: string,
  options: Pick<ExtensionHostWorkspaceScope, 'workspaceRoot' | 'workspaceRoots'> = {}
): string {
  return JSON.stringify([extensionId, normalizedWorkspaceRoots(options)])
}

function identityFromInstanceKey(
  instanceKey: string
): { extensionId: string; workspaceRoots: string[] } | undefined {
  try {
    const parsed = JSON.parse(instanceKey)
    if (
      !Array.isArray(parsed) ||
      typeof parsed[0] !== 'string' ||
      !Array.isArray(parsed[1]) ||
      parsed[1].some((root) => typeof root !== 'string')
    ) return undefined
    return { extensionId: parsed[0], workspaceRoots: parsed[1] }
  } catch {
    return undefined
  }
}

function workspaceActivationEpochKey(extensionId: string, workspaceKey: string): string {
  return `${extensionId}\0${workspaceKey}`
}

function normalizedWorkspaceRoots(options: {
  workspaceRoot?: string
  workspaceRoots?: string[]
}): string[] {
  const roots = [...new Set([
    ...(options.workspaceRoots ?? []),
    ...(options.workspaceRoot === undefined ? [] : [options.workspaceRoot])
  ].map((root) => resolve(root)))].sort()
  if (roots.length > 32) {
    throw extensionError(
      'EXTENSION_WORKSPACE_SCOPE_INVALID',
      'Extension activation cannot bind more than 32 workspace roots',
      { count: roots.length }
    )
  }
  return roots
}

function sameWorkspaceRoots(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((root, index) => root === right[index])
}

function intersectWorkspaceResolutions(scopes: ResolvedExtension[]): ResolvedExtension {
  const first = scopes[0]
  if (first === undefined) {
    throw extensionError(
      'EXTENSION_ACTIVATION_ADMISSION_FAILED',
      'Extension activation produced no admitted scope'
    )
  }
  for (const scope of scopes.slice(1)) {
    if (
      scope.id !== first.id ||
      scope.version !== first.version ||
      resolve(scope.packagePath) !== resolve(first.packagePath) ||
      scope.development !== first.development ||
      scope.generation !== first.generation
    ) {
      throw extensionError(
        'EXTENSION_WORKSPACE_SELECTION_MISMATCH',
        'Workspace scopes resolved to different extension packages',
        { extensionId: first.id }
      )
    }
  }
  return {
    ...first,
    grantedPermissions: first.grantedPermissions.filter((permission) =>
      scopes.every((scope) => scope.grantedPermissions.includes(permission)))
  }
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw extensionError('EXTENSION_HOST_LIMIT_INVALID', 'Extension manager limit is invalid', {
      name,
      value: resolved
    })
  }
  return resolved
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCompatibilityError(code: string): boolean {
  return /(?:MANIFEST_VERSION|API_(?:VERSION|MINOR|CAPABILITY)|ENGINE|RPC_VERSION).*?(?:UNSUPPORTED|INCOMPATIBLE|REQUIRED)/.test(code)
}
