export const COLAB_ACCELERATORS = ['T4', 'L4', 'A100', 'CPU'] as const
export type ColabAccelerator = (typeof COLAB_ACCELERATORS)[number]

export type ColabAcceleratorSpec = {
  id: ColabAccelerator
  label: string
  cliGpuFlag: string | null
  estimatedCuPerHour: number
  vramGb: number | null
  ramGb: number
}

export const COLAB_ACCELERATOR_SPECS: Record<ColabAccelerator, ColabAcceleratorSpec> = {
  T4: { id: 'T4', label: 'T4', cliGpuFlag: 'T4', estimatedCuPerHour: 1.8, vramGb: 15, ramGb: 12.7 },
  L4: { id: 'L4', label: 'L4', cliGpuFlag: 'L4', estimatedCuPerHour: 4.8, vramGb: 24, ramGb: 53 },
  A100: { id: 'A100', label: 'A100', cliGpuFlag: 'A100', estimatedCuPerHour: 11.8, vramGb: 40, ramGb: 83.5 },
  CPU: { id: 'CPU', label: 'CPU', cliGpuFlag: null, estimatedCuPerHour: 0.1, vramGb: null, ramGb: 12.7 }
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
  variant: string
  detectedAt: string
}

export type ColabLastRunSummary = {
  entryCommand: string
  accelerator: ColabAccelerator
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
