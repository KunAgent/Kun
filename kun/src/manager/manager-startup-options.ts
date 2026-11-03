import type { RuntimeFlavor } from '../contracts/runtime-flavor.js'
import type { ManagerLaunchOverride } from './manager-launch.js'
import type { StartupAttempt, StartupProgress } from './startup-attempt.js'

export type EnsureServiceManagerInput = {
  flavor: RuntimeFlavor
  controlDir?: string
  fetch?: typeof fetch
  timeoutMs?: number
  signal?: AbortSignal
  startupAttempt?: StartupAttempt
  onStartupProgress?: (progress: StartupProgress) => void
  allowDevelopmentBootstrap?: boolean
  buildId?: string
  dataDir: string
  settingsPath?: string
  launch?: ManagerLaunchOverride
  /** Progress sink for the legacy production Runtime handover wait. */
  onLegacyHandoverStatus?: (status: LegacyRuntimeHandoverStatus) => void
}

export type LegacyRuntimeHandoverStatus =
  | { kind: 'idle' }
  | { kind: 'waiting'; activeTurnCount: number }
  | { kind: 'shutdown-requested' }
  | { kind: 'released' }
