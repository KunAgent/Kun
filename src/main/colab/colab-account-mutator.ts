import { randomUUID } from 'node:crypto'
import {
  COLAB_ACCELERATOR_SPECS,
  type ColabLastRunSummary,
  type ColabLoginOutcome,
  type ColabOAuthPendingState,
  type ColabSessionView,
  type ColabStartRunRequest
} from '../../shared/colab/colab-types'
import type { ColabCredentialStore, StoredColabOAuthToken } from './colab-credential-store'
import type { VerifiedColabIdentity } from './colab-oauth-flow'
import {
  buildColabConnectionView,
  isActiveColabSessionPhase,
  type PersistedConnectionRecord,
  pickAvatarColor,
  workspaceShortLabel
} from './colab-state-store'

export async function applyColabAuthorizedIdentity(options: {
  flow: ColabOAuthPendingState
  identity: VerifiedColabIdentity
  connections: PersistedConnectionRecord[]
  workspaceConnections: Record<string, string>
  sessions: Iterable<ColabSessionView>
  mismatchedTokens: Map<string, { email: string; token: StoredColabOAuthToken; createdAt: number }>
  credentials: ColabCredentialStore
  saveState: () => Promise<void>
  onRefreshConnection: (connectionId: string) => void
}): Promise<ColabLoginOutcome> {
  const { flow, identity, connections, workspaceConnections, credentials } = options
  const email = identity.email.toLowerCase()

  if (flow.reauthConnectionId) {
    const target = connections.find((c) => c.id === flow.reauthConnectionId)
    if (target && target.email.toLowerCase() !== email) {
      const pendingTokenId = `mismatch-${randomUUID().slice(0, 8)}`
      options.mismatchedTokens.set(pendingTokenId, {
        email,
        token: identity.token,
        createdAt: Date.now()
      })
      return {
        ok: false,
        kind: 'email_mismatch',
        message: `登录账号（${email}）与原连接「${target.name}」（${target.email}）不一致。`,
        actualEmail: email,
        expectedEmail: target.email,
        pendingTokenId
      }
    }
    if (target) {
      await credentials.writeToken(target.id, identity.token)
      target.status = 'connected'
      target.updatedAt = new Date().toISOString()
      await options.saveState()
      options.onRefreshConnection(target.id)
      return {
        ok: true,
        kind: 'reauthorized',
        connection: buildColabConnectionView(target, options.sessions)
      }
    }
  }

  const existing = connections.find((c) => c.email.toLowerCase() === email)
  if (existing) {
    await credentials.writeToken(existing.id, identity.token)
    existing.status = 'connected'
    existing.updatedAt = new Date().toISOString()
    if (flow.setAsCurrent && flow.workspaceRoot) {
      workspaceConnections[flow.workspaceRoot] = existing.id
    }
    await options.saveState()
    options.onRefreshConnection(existing.id)
    return {
      ok: true,
      kind: 'refreshed_existing',
      connection: buildColabConnectionView(existing, options.sessions),
      switchedWorkspace: Boolean(flow.setAsCurrent && flow.workspaceRoot)
    }
  }

  const now = new Date().toISOString()
  const defaultName = email.split('@')[0] || 'Colab'
  const newRecord: PersistedConnectionRecord = {
    id: `conn-${randomUUID().slice(0, 8)}`,
    name: flow.connectionName.trim() || defaultName,
    email,
    avatarColor: pickAvatarColor(connections.length),
    planLabel: 'Colab',
    balanceCu: null,
    burnRateCuPerHour: null,
    status: 'connected',
    createdAt: now,
    updatedAt: now
  }
  await credentials.writeToken(newRecord.id, identity.token)
  connections.push(newRecord)
  if ((flow.setAsCurrent || connections.length === 1) && flow.workspaceRoot) {
    workspaceConnections[flow.workspaceRoot] = newRecord.id
  }
  await options.saveState()
  options.onRefreshConnection(newRecord.id)
  return {
    ok: true,
    kind: 'created',
    connection: buildColabConnectionView(newRecord, options.sessions),
    switchedWorkspace: Boolean(flow.setAsCurrent && flow.workspaceRoot)
  }
}

export function createColabSessionDraft(
  conn: PersistedConnectionRecord,
  wsKey: string,
  input: ColabStartRunRequest
): ColabSessionView {
  const spec = COLAB_ACCELERATOR_SPECS[input.accelerator]
  const slug =
    workspaceShortLabel(wsKey)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 16) || 'colab'
  const stamp = new Date().toISOString().slice(11, 16).replace(':', '')
  const sessionName = `${slug}-${stamp}-${randomUUID().slice(0, 3)}`
  const sessionId = `csess-${randomUUID().slice(0, 8)}`
  const estHours = Math.min(input.maxRuntimeHours || 1.5, 1.5)
  const estimatedTotalCu = Number((spec.estimatedCuPerHour * estHours).toFixed(1))

  return {
    id: sessionId,
    sessionName,
    connectionId: conn.id,
    connectionName: conn.name,
    connectionEmail: conn.email,
    connectionAvatarColor: conn.avatarColor,
    workspaceRoot: wsKey,
    accelerator: input.accelerator,
    highMem: Boolean(input.highMem && spec.supportsHighMem),
    minVramGb: spec.kind === 'gpu' ? (input.minVramGb ?? null) : null,
    vramGb: spec.vramGb,
    ramGb: spec.ramGb,
    phase: 'provisioning',
    provisioningStep: 'assign',
    startedAt: new Date().toISOString(),
    elapsedSeconds: 0,
    entryCommand: input.entryCommand,
    syncPaths: [...input.syncPaths],
    outputRemoteDir: input.outputRemoteDir || 'outputs/',
    outputLocalDir: input.outputLocalDir || './outputs',
    maxRuntimeHours: input.maxRuntimeHours,
    idleAutoStopMinutes: input.idleAutoStopMinutes ?? 0,
    maxSpendCu: input.maxSpendCu ?? null,
    minBalanceCu: input.minBalanceCu ?? null,
    watchdogActive: false,
    autoStopAt: null,
    guardWarnings: [],
    autoStop: input.autoStop,
    mountDrive: Boolean(input.mountDrive),
    consumedCu: 0,
    burnRateCuPerHour: spec.estimatedCuPerHour,
    estimatedTotalCu,
    uploadTransferredBytes: 0,
    uploadTotalBytes: 0,
    gpuUtilizationPct: null,
    vramUsedGb: null,
    gpuHistory: [],
    metrics: {},
    logTail: [],
    artifacts: []
  }
}

export function buildLastRunSummary(session: ColabSessionView): ColabLastRunSummary {
  return {
    entryCommand: session.entryCommand,
    accelerator: session.accelerator,
    ...(session.highMem ? { highMem: true } : {}),
    syncPaths: session.syncPaths,
    outputRemoteDir: session.outputRemoteDir,
    outputLocalDir: session.outputLocalDir,
    maxRuntimeHours: session.maxRuntimeHours,
    autoStop: session.autoStop,
    mountDrive: session.mountDrive,
    envVars: {},
    setupScript: '',
    durationSeconds: session.elapsedSeconds,
    consumedCu: session.consumedCu,
    connectionId: session.connectionId,
    finishedAt: session.finishedAt || new Date().toISOString()
  }
}

export async function removeColabConnection(options: {
  connectionId: string
  stopRunningSessions: boolean
  connections: PersistedConnectionRecord[]
  workspaceConnections: Record<string, string>
  sessions: Map<string, ColabSessionView>
  credentials: ColabCredentialStore
  stopSession: (sessionId: string, remoteStop: boolean) => Promise<void>
}): Promise<{ ok: boolean; switchedToConnectionId: string | null; message?: string }> {
  const idx = options.connections.findIndex((c) => c.id === options.connectionId)
  if (idx === -1) return { ok: false, switchedToConnectionId: null, message: '连接不存在。' }

  const activeForConn = [...options.sessions.values()].filter(
    (s) => s.connectionId === options.connectionId && isActiveColabSessionPhase(s.phase)
  )
  for (const s of activeForConn) {
    await options.stopSession(s.id, options.stopRunningSessions)
    options.sessions.delete(s.id)
  }

  options.connections.splice(idx, 1)
  await options.credentials.removeConnection(options.connectionId)

  const fallback = options.connections.find((c) => c.status === 'connected')?.id ?? null
  for (const [ws, cid] of Object.entries(options.workspaceConnections)) {
    if (cid === options.connectionId) {
      if (fallback) options.workspaceConnections[ws] = fallback
      else delete options.workspaceConnections[ws]
    }
  }
  return { ok: true, switchedToConnectionId: fallback }
}
