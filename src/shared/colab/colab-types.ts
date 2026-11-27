export const COLAB_ACCELERATORS = [
  'T4',
  'L4',
  'G4',
  'A100',
  'H100',
  'V6E1',
  'V5E1',
  'CPU'
] as const
export type ColabAccelerator = (typeof COLAB_ACCELERATORS)[number]
export type ColabAcceleratorKind = 'gpu' | 'tpu' | 'cpu'

export type ColabAcceleratorSpec = {
  id: ColabAccelerator
  label: string
  fullLabel: string
  kind: ColabAcceleratorKind
  cliGpuFlag: string | null
  cliTpuFlag: string | null
  estimatedCuPerHour: number
  vramGb: number | null
  tpuHbmGb: number | null
  ramGb: number
  supportsHighMem: boolean
  tierRequirement?: 'pro' | 'ai_ultra'
}

export const COLAB_ACCELERATOR_SPECS: Record<ColabAccelerator, ColabAcceleratorSpec> = {
  T4: {
    id: 'T4',
    label: 'T4',
    fullLabel: 'T4 GPU',
    kind: 'gpu',
    cliGpuFlag: 'T4',
    cliTpuFlag: null,
    estimatedCuPerHour: 1.8,
    vramGb: 15,
    tpuHbmGb: null,
    ramGb: 12.7,
    supportsHighMem: true
  },
  L4: {
    id: 'L4',
    label: 'L4',
    fullLabel: 'L4 GPU',
    kind: 'gpu',
    cliGpuFlag: 'L4',
    cliTpuFlag: null,
    estimatedCuPerHour: 4.8,
    vramGb: 24,
    tpuHbmGb: null,
    ramGb: 53,
    supportsHighMem: false,
    tierRequirement: 'pro'
  },
  G4: {
    id: 'G4',
    label: 'G4',
    fullLabel: 'G4 GPU',
    kind: 'gpu',
    cliGpuFlag: 'G4',
    cliTpuFlag: null,
    estimatedCuPerHour: 8.8,
    vramGb: 96,
    tpuHbmGb: null,
    ramGb: 177,
    supportsHighMem: false,
    tierRequirement: 'pro'
  },
  A100: {
    id: 'A100',
    label: 'A100',
    fullLabel: 'A100 GPU',
    kind: 'gpu',
    cliGpuFlag: 'A100',
    cliTpuFlag: null,
    estimatedCuPerHour: 11.8,
    vramGb: 40,
    tpuHbmGb: null,
    ramGb: 83.5,
    supportsHighMem: true,
    tierRequirement: 'pro'
  },
  H100: {
    id: 'H100',
    label: 'H100',
    fullLabel: 'H100 GPU',
    kind: 'gpu',
    cliGpuFlag: 'H100',
    cliTpuFlag: null,
    estimatedCuPerHour: 18.1,
    vramGb: 80,
    tpuHbmGb: null,
    ramGb: 170,
    supportsHighMem: false,
    tierRequirement: 'ai_ultra'
  },
  V6E1: {
    id: 'V6E1',
    label: 'v6e-1',
    fullLabel: 'v6e-1 TPU',
    kind: 'tpu',
    cliGpuFlag: null,
    cliTpuFlag: 'v6e1',
    estimatedCuPerHour: 4.1,
    vramGb: null,
    tpuHbmGb: 32,
    ramGb: 32,
    supportsHighMem: false,
    tierRequirement: 'pro'
  },
  V5E1: {
    id: 'V5E1',
    label: 'v5e-1',
    fullLabel: 'v5e-1 TPU',
    kind: 'tpu',
    cliGpuFlag: null,
    cliTpuFlag: 'v5e1',
    estimatedCuPerHour: 2.9,
    vramGb: null,
    tpuHbmGb: 16,
    ramGb: 47,
    supportsHighMem: false
  },
  CPU: {
    id: 'CPU',
    label: 'CPU',
    fullLabel: 'CPU',
    kind: 'cpu',
    cliGpuFlag: null,
    cliTpuFlag: null,
    estimatedCuPerHour: 0.1,
    vramGb: null,
    tpuHbmGb: null,
    ramGb: 12.7,
    supportsHighMem: true
  }
}

export function parseKnownColabAccelerator(raw: unknown): ColabAccelerator | null {
  if (typeof raw !== 'string') return null
  const compact = raw
    .trim()
    .toUpperCase()
    .replace(/\b(GPU|TPU)\b/g, '')
    .replace(/[^A-Z0-9]+/g, '')
  if (!compact) return null
  if (compact === 'CPU' || compact === 'NONE' || compact === 'DEFAULT') return 'CPU'
  if (compact === 'T4') return 'T4'
  if (compact === 'L4') return 'L4'
  if (compact === 'G4') return 'G4'
  if (compact === 'A100') return 'A100'
  if (compact === 'H100') return 'H100'
  if (compact === 'V6E1') return 'V6E1'
  if (compact === 'V5E1') return 'V5E1'
  return null
}

export function normalizeColabAccelerator(
  raw: unknown,
  fallback: ColabAccelerator = 'CPU'
): ColabAccelerator {
  return parseKnownColabAccelerator(raw) ?? fallback
}

export type ColabAcceleratorEligibilitySource = {
  eligibleAccelerators?: readonly ColabAccelerator[]
  ineligibleAccelerators?: readonly ColabAccelerator[]
}

export function isColabAcceleratorEligible(
  conn: ColabAcceleratorEligibilitySource | null | undefined,
  id: ColabAccelerator
): boolean {
  if (id === 'CPU' || !conn) return true
  if (conn.eligibleAccelerators?.includes(id)) return true
  if (conn.ineligibleAccelerators?.includes(id)) return false
  if (conn.eligibleAccelerators && conn.eligibleAccelerators.length > 0) {
    return conn.eligibleAccelerators.includes(id)
  }
  return true
}

export function resolveEligibleColabAccelerator(
  conn: ColabAcceleratorEligibilitySource | null | undefined,
  preferred: ColabAccelerator
): ColabAccelerator {
  if (isColabAcceleratorEligible(conn, preferred)) return preferred
  return COLAB_ACCELERATORS.find((id) => isColabAcceleratorEligible(conn, id)) ?? 'CPU'
}

export type ColabConnectionStatus = 'connected' | 'expired'

export type ColabConnectionOccupancy = {
  sessionId: string
  sessionName: string
  workspaceRoot: string
  workspaceLabel: string
  accelerator: ColabAccelerator
  phase: ColabSessionPhase
}

export type ColabConnectionView = {
  id: string
  name: string
  email: string
  avatarColor: string
  planLabel: string
  balanceCu: number | null
  burnRateCuPerHour: number | null
  eligibleAccelerators?: ColabAccelerator[]
  ineligibleAccelerators?: ColabAccelerator[]
  status: ColabConnectionStatus
  createdAt: string
  updatedAt: string
  activeSessions: ColabConnectionOccupancy[]
}

export type ColabOAuthPendingState = {
  flowId: string
  connectionName: string
  setAsCurrent: boolean
  workspaceRoot: string
  reauthConnectionId?: string
  reauthExpectedEmail?: string
  authUrl: string
  manualAuthUrl: string
  expiresAt: number
}

export type ColabLoginOutcome =
  | {
      ok: true
      kind: 'created' | 'refreshed_existing' | 'reauthorized'
      connection: ColabConnectionView
      switchedWorkspace?: boolean
    }
  | {
      ok: false
      kind: 'cancelled' | 'timeout' | 'email_mismatch' | 'error'
      message: string
      actualEmail?: string
      expectedEmail?: string
      pendingTokenId?: string
    }

export type ColabSessionPhase =
  | 'provisioning'
  | 'uploading'
  | 'installing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'disconnected'
  | 'stopped'

export type ColabProvisioningStep = 'assign' | 'upload' | 'install' | 'start'

export type ColabMetricPoint = {
  step: number
  value: number
}

export type ColabSessionArtifact = {
  name: string
  remotePath: string
  sizeBytes: number
}

export type ColabSessionErrorKind =
  | 'gpu_unavailable'
  | 'quota_insufficient'
  | 'auth_expired'
  | 'disconnected_billing'
  | 'command_failed'
  | 'cli_unavailable'
  | 'not_entitled'

export type ColabGuardWarningKind =
  | 'runtime_nearing'
  | 'spend_nearing'
  | 'balance_nearing'
  | 'balance_stale'

export type ColabGuardStopReason = 'max_runtime' | 'max_spend' | 'balance_floor'

export const COLAB_RESOURCE_INTERVAL_MS = 5_000
export const COLAB_RESOURCE_WINDOW_MS = 5 * 60_000

export type ColabResourceSample = {
  at: number // Unix epoch milliseconds
  gpuPct: number | null
  vramUsedGiB: number | null
  vramTotalGiB: number | null
  ramUsedGiB: number | null
  ramTotalGiB: number | null
  diskPct: number | null
}

export type ColabSessionView = {
  id: string
  sessionName: string
  endpoint?: string
  connectionId: string
  connectionName: string
  connectionEmail: string
  connectionAvatarColor: string
  workspaceRoot: string
  accelerator: ColabAccelerator
  highMem?: boolean
  minVramGb?: number | null
  vramGb: number | null
  ramGb: number
  phase: ColabSessionPhase
  provisioningStep: ColabProvisioningStep
  provisioningAttempt?: number
  provisioningMaxAttempts?: number
  startedAt: string
  finishedAt?: string
  elapsedSeconds: number
  entryCommand: string
  syncPaths: string[]
  outputRemoteDir: string
  outputLocalDir: string
  maxRuntimeHours: number
  idleAutoStopMinutes?: number
  maxSpendCu?: number | null
  minBalanceCu?: number | null
  watchdogActive?: boolean
  autoStopAt?: string | null
  guardWarnings?: ColabGuardWarningKind[]
  guardStoppedReason?: ColabGuardStopReason
  autoStop: boolean
  mountDrive: boolean
  consumedCu: number
  burnRateCuPerHour: number
  estimatedTotalCu: number
  uploadTransferredBytes: number
  uploadTotalBytes: number
  gpuUtilizationPct: number | null
  vramUsedGb: number | null
  ramUsedGb?: number | null
  diskUsedPct?: number | null
  gpuHistory: number[]
  resourceHistory?: ColabResourceSample[]
  metrics: Record<string, ColabMetricPoint[]>
  progressSummary?: string
  logTail: string[]
  artifacts: ColabSessionArtifact[]
  errorKind?: ColabSessionErrorKind
  errorMessage?: string
}

export type ColabUntrackedSession = {
  connectionId: string
  connectionName: string
  connectionEmail: string
  endpoint: string
  remoteLabel: string
  accelerator: ColabAccelerator
  highMem?: boolean
  variant: string
  detectedAt: string
}

export type ColabLastRunSummary = {
  entryCommand: string
  accelerator: ColabAccelerator
  highMem?: boolean
  syncPaths: string[]
  outputRemoteDir: string
  outputLocalDir: string
  maxRuntimeHours: number
  autoStop: boolean
  mountDrive: boolean
  envVars: Record<string, string>
  setupScript: string
  durationSeconds: number
  consumedCu: number
  connectionId: string
  finishedAt: string
}

export type ColabWorkspaceRunConfig = {
  entryCommand: string
  accelerator: ColabAccelerator
  highMem?: boolean
  syncPaths: string[]
  outputRemoteDir: string
  outputLocalDir: string
  maxRuntimeHours: number
  autoStop: boolean
  mountDrive?: boolean
  envVars?: Record<string, string>
  setupScript?: string
  metricPattern?: string
}

export type ColabSyncCandidate = {
  relativePath: string
  label: string
  isDirectory: boolean
  fileCount: number
  totalBytes: number
  defaultSelected: boolean
  isRequirements?: boolean
  suggestDriveMount?: boolean
}

export type ColabCliRuntimeStatus = {
  state: 'ready' | 'missing' | 'installing' | 'error'
  version: string | null
  pythonVersion: string | null
  venvPath: string
  message?: string
}

export type ColabStartRunRequest = {
  workspaceRoot: string
  connectionId: string
  setAsWorkspaceCurrent?: boolean
  entryCommand: string
  accelerator: ColabAccelerator
  highMem?: boolean
  minVramGb?: number | null
  maxProvisionAttempts?: number
  onProvisionExhausted?: 'stop_and_fail' | 'keep_last'
  syncPaths: string[]
  outputRemoteDir: string
  outputLocalDir: string
  maxRuntimeHours: number
  idleAutoStopMinutes?: number
  maxSpendCu?: number | null
  minBalanceCu?: number | null
  autoStop: boolean
  saveWorkspaceConfig?: boolean
  mountDrive?: boolean
  envVars?: Record<string, string>
  setupScript?: string
  terminalOnly?: boolean
}

export type ColabStateSnapshot = {
  cli: ColabCliRuntimeStatus
  connections: ColabConnectionView[]
  workspaceConnections: Record<string, string>
  oauthPending: ColabOAuthPendingState | null
  lastLoginOutcome: ColabLoginOutcome | null
  sessions: ColabSessionView[]
  untrackedSessions: ColabUntrackedSession[]
  lastRunsByWorkspace: Record<string, ColabLastRunSummary>
}
