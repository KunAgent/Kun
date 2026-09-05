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

export type PersistedHostHealth = {
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

export type HostHealthDocument = {
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

export function emptyHealth(extensionId: string, now: Date): PersistedHostHealth {
  return {
    extensionId,
    lifecycleState: 'inactive',
    restartCount: 0,
    consecutiveFailures: 0,
    circuitOpen: false,
    updatedAt: now.toISOString()
  }
}

export function validateHealthDocument(value: unknown): HostHealthDocument {
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

export function activationMatches(declared: string[], event: string): boolean {
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

export function assertWorkspaceScope(principal: ExtensionPrincipal, requestedRoots: string[]): void {
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

export function identityFromInstanceKey(
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

export function workspaceActivationEpochKey(extensionId: string, workspaceKey: string): string {
  return `${extensionId}\0${workspaceKey}`
}

export function normalizedWorkspaceRoots(options: {
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

export function sameWorkspaceRoots(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((root, index) => root === right[index])
}

export function intersectWorkspaceResolutions(scopes: readonly ResolvedExtension[]): ResolvedExtension {
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

export function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw extensionError('EXTENSION_HOST_LIMIT_INVALID', 'Extension manager limit is invalid', {
      name,
      value: resolved
    })
  }
  return resolved
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isCompatibilityError(code: string): boolean {
  return /(?:MANIFEST_VERSION|API_(?:VERSION|MINOR|CAPABILITY)|ENGINE|RPC_VERSION).*?(?:UNSUPPORTED|INCOMPATIBLE|REQUIRED)/.test(code)
}
