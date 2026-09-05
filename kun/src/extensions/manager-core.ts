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

import {
  DEFAULT_EXTENSION_CRASH_THRESHOLD,
  DEFAULT_EXTENSION_HEALTHY_RESET_MS,
  DEFAULT_EXTENSION_RESTART_BACKOFF_MAX_MS,
  DEFAULT_EXTENSION_RESTART_BACKOFF_MS,
  DEFAULT_EXTENSION_VIEW_IDLE_TIMEOUT_MS,
  activationMatches,
  assertWorkspaceScope,
  emptyHealth,
  extensionHostInstanceKey,
  identityFromInstanceKey,
  intersectWorkspaceResolutions,
  isCompatibilityError,
  isViewIdleDeactivationEligible,
  normalizedWorkspaceRoots,
  positiveInteger,
  validateHealthDocument,
  workspaceActivationEpochKey
} from './manager-contracts.js'
import type {
  ExtensionHostWorkspaceScope,
  ExtensionManagerOptions,
  HostHealthDocument,
  PersistedHostHealth
} from './manager-contracts.js'

export class ExtensionManagerCore {
  /** Host lifecycle state is isolated by extension identity plus normalized workspace ownership. */
  protected readonly hosts = new Map<string, ExtensionHostProcess>()
  protected readonly activationEpochs = new Map<string, number>()
  protected readonly workspaceActivationEpochs = new Map<string, number>()
  protected readonly activations = new Map<string, {
    extensionId: string
    event: string
    workspaceRoots: string[]
    workspaceContextSignature: string
    promise: Promise<ExtensionHostProcess | undefined>
  }>()
  protected readonly healthyTimers = new Map<string, NodeJS.Timeout>()
  protected readonly idleTimers = new Map<string, NodeJS.Timeout>()
  protected readonly viewReferences = new Map<string, number>()
  protected readonly idleEligibleExtensions = new Set<string>()
  protected readonly stops = new Map<string, Promise<void>>()
  protected readonly hostExitCleanups = new Map<string, Promise<void>>()
  protected readonly recordedFailures = new WeakSet<ExtensionHostProcess>()
  protected readonly healthFile: AtomicJsonFile<HostHealthDocument>
  protected readonly crashThreshold: number
  protected readonly restartBackoffMs: number
  protected readonly restartBackoffMaxMs: number
  protected readonly healthyResetMs: number
  protected readonly viewIdleTimeoutMs: number
  protected shuttingDown = false

  constructor(protected readonly options: ExtensionManagerOptions) {
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

  protected async stopHost(instanceKey: string, extensionId: string): Promise<void> {
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

  protected async stopHostInternal(instanceKey: string, extensionId: string): Promise<void> {
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

  protected activationEpoch(extensionId: string, workspaceRoots: readonly string[]): string {
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

  protected instanceKeys(extensionId: string, workspaceKey?: string): string[] {
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

  protected assertActivationCurrent(
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

  protected async activateInternal(
    extensionId: string,
    event: string,
    options: ExtensionHostWorkspaceScope,
    instanceKey: string
  ): Promise<ExtensionHostProcess | undefined> {
    const workspaceRoots = normalizedWorkspaceRoots(options)
    const workspaceKeys = workspaceRoots.map((root) => this.options.paths.workspaceKey(root))
    let extension: ResolvedExtension
    let activationEpoch: string
    try {
      const admission = await this.options.packageManager.resolveActivation(
        extensionId,
        workspaceKeys,
        () => this.activationEpoch(extensionId, workspaceRoots)
      )
      extension = intersectWorkspaceResolutions(admission.resolvedScopes)
      activationEpoch = admission.fence
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

  protected createHost(
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

  protected handleHostExit(host: ExtensionHostProcess, exit: ExtensionHostExit): Promise<void> {
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

  protected async handleHostExitInternal(
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

  protected async waitForLifecycleTransition(instanceKey: string): Promise<void> {
    while (true) {
      const pending = this.stops.get(instanceKey) ?? this.hostExitCleanups.get(instanceKey)
      if (pending === undefined) return
      await pending
    }
  }

  protected async waitForHostExitCleanup(instanceKey: string): Promise<void> {
    while (true) {
      const cleanup = this.hostExitCleanups.get(instanceKey)
      if (cleanup === undefined) return
      await cleanup
    }
  }

  protected setIdleEligibility(
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

  protected scheduleIdleDeactivation(instanceKey: string, extensionId: string): void {
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

  protected cancelIdleDeactivation(instanceKey: string): void {
    const timer = this.idleTimers.get(instanceKey)
    if (timer !== undefined) clearTimeout(timer)
    this.idleTimers.delete(instanceKey)
  }

  protected async recordFailure(
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

  protected async recordHostFailure(
    extensionId: string,
    version: string,
    host: ExtensionHostProcess,
    error: unknown
  ): Promise<void> {
    if (this.recordedFailures.has(host)) return
    this.recordedFailures.add(host)
    await this.recordFailure(extensionId, version, host, error)
  }

  protected scheduleHealthyReset(
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

  protected readHealth(): Promise<HostHealthDocument> {
    return this.healthFile.read(() => ({ schemaVersion: 1, revision: 0, extensions: {} }))
  }

  protected updateHealth(
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

  protected now(): Date {
    return this.options.now?.() ?? new Date()
  }
}
