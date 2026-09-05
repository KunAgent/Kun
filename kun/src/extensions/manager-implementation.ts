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

import { ExtensionManagerCore } from './manager-core.js'
import {
  emptyHealth,
  extensionHostInstanceKey,
  normalizedWorkspaceRoots,
  sameWorkspaceRoots,
  workspaceActivationEpochKey
} from './manager-contracts.js'
import type {
  ExtensionHostDiagnostic,
  ExtensionHostNotificationScope,
  ExtensionHostWorkspaceScope
} from './manager-contracts.js'

export class ExtensionManager extends ExtensionManagerCore {
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
    const existing = this.activations.get(instanceKey)
    if (existing !== undefined) {
      if (
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
    const activation = this.activateInternal(extensionId, event, options, instanceKey)
    this.activations.set(instanceKey, {
      extensionId,
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

}
