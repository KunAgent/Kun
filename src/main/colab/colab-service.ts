import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SafeStorage } from 'electron'
import type { RuntimeUploadResult } from '../../shared/colab/runtime-upload'
import type { UploadOptions } from './runtime-file-upload'
import type { KunColabSettingsV1 } from '../../shared/app-settings-colab'
import type {
  ColabCliRuntimeStatus,
  ColabConnectionStatus,
  ColabLastRunSummary,
  ColabLoginOutcome,
  ColabOAuthPendingState,
  ColabSessionView,
  ColabStartRunRequest,
  ColabStateSnapshot,
  ColabUntrackedSession,
  ColabWorkspaceRunConfig
} from '../../shared/colab/colab-types'
import {
  applyColabAuthorizedIdentity,
  buildLastRunSummary,
  createColabSessionDraft,
  removeColabConnection
} from './colab-account-mutator'
import { ColabCliRuntime } from './colab-cli-runtime'
import { ColabCredentialStore, type StoredColabOAuthToken } from './colab-credential-store'
import { ColabOAuthCoordinator, type VerifiedColabIdentity } from './colab-oauth-flow'
import { ColabPythonIsolation } from './colab-python-isolation'
import { evaluateSessionCostGuard } from './colab-watchdog-guard'
import {
  downloadArtifactsFromColabSession,
  pollColabBalancesAndRemoteSessions,
  prepareColabTerminalCommand,
  resolveColabSessionBrowserUrl,
  stopRemoteUntrackedEndpoint,
  uploadFilesToColabSession
} from './colab-remote-reconciler'
import { ColabSessionExecutor } from './colab-session-executor'
import {
  buildAdoptedSessionView,
  buildColabConnectionView,
  isActiveColabSessionPhase,
  loadColabPersistedState,
  normalizeWorkspaceKey,
  type PersistedConnectionRecord,
  saveColabPersistedState
} from './colab-state-store'
import { inspectWorkspaceSyncCandidates, saveWorkspaceColabConfig } from './colab-workspace-sync'

export class ColabService {
  readonly cli: ColabCliRuntime
  readonly credentials: ColabCredentialStore
  readonly isolation: ColabPythonIsolation
  private readonly oauth: ColabOAuthCoordinator
  private readonly executor: ColabSessionExecutor
  private readonly statePath: string
  private readonly listeners = new Set<(snapshot: ColabStateSnapshot) => void>()
  private readonly mismatchedTokens = new Map<
    string,
    { email: string; token: StoredColabOAuthToken; createdAt: number }
  >()
  private connections: PersistedConnectionRecord[] = []
  private workspaceConnections: Record<string, string> = {}
  private lastRunsByWorkspace: Record<string, ColabLastRunSummary> = {}
  private ignoredUntrackedKeys = new Set<string>()
  private sessions = new Map<string, ColabSessionView>()
  private untrackedSessions: ColabUntrackedSession[] = []
  private lastLoginOutcome: ColabLoginOutcome | null = null
  private initialization: Promise<void> | null = null
  private refreshInterval: ReturnType<typeof setInterval> | null = null
  private clockInterval: ReturnType<typeof setInterval> | null = null
  private lowBalanceNotifiedIds = new Set<string>()

  constructor(
    private readonly options: {
      colabRootDir: string
      safeStorage: SafeStorage
      openExternal: (url: string) => Promise<void>
      getColabSettings: () => KunColabSettingsV1
      onLowBalanceNotice?: (connectionName: string, balanceCu: number) => void
      fetchImpl?: typeof fetch
    }
  ) {
    this.statePath = join(options.colabRootDir, 'state.v1.json')
    this.cli = new ColabCliRuntime(options.colabRootDir)
    this.credentials = new ColabCredentialStore(options.colabRootDir, options.safeStorage)
    this.isolation = new ColabPythonIsolation(options.colabRootDir)
    this.oauth = new ColabOAuthCoordinator({
      openExternal: options.openExternal,
      onAuthorized: async (flow, identity) => {
        await this.applyAuthorizedIdentity(flow, identity)
      },
      onFailed: (_flow, kind, message) => {
        this.lastLoginOutcome = { ok: false, kind, message }
        this.emit()
      },
      fetchImpl: options.fetchImpl
    })
    this.executor = new ColabSessionExecutor({
      cli: this.cli,
      credentials: this.credentials,
      isolation: this.isolation,
      openExternal: options.openExternal,
      getSession: (id) => this.sessions.get(id),
      patchSession: (id, patch) => this.patchSession(id, patch),
      appendLog: (id, line, metricPattern) => {
        const current = this.sessions.get(id)
        if (!current) return
        this.patchSession(
          id,
          ColabSessionExecutor.applyLogAndMetrics(current, line, metricPattern)
        )
      },
      onSessionAuthExpired: (connectionId) => {
        this.markConnectionStatus(connectionId, 'expired')
      },
      onSessionFinished: (finished) => {
        this.recordLastRun(finished)
      }
    })
  }

  initialize(): Promise<void> {
    this.initialization ??= this.loadStateAndStartTimers().catch((error) => {
      this.initialization = null
      throw error
    })
    return this.initialization
  }

  private async loadStateAndStartTimers(): Promise<void> {
    await mkdir(this.options.colabRootDir, { recursive: true, mode: 0o700 })
    const loaded = await loadColabPersistedState(this.statePath)
    this.connections = loaded.connections
    this.workspaceConnections = loaded.workspaceConnections
    this.lastRunsByWorkspace = loaded.lastRunsByWorkspace
    this.ignoredUntrackedKeys = loaded.ignoredUntrackedKeys
    await this.cli.probe()
    this.clockInterval = setInterval(() => this.tickActiveSessions(), 2_000)
    this.refreshInterval = setInterval(() => {
      if (this.connections.length > 0 && this.cli.status.state === 'ready') {
        void this.refreshBalances()
      }
    }, 60_000)
  }

  subscribe(listener: (snapshot: ColabStateSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const snap = this.getSnapshotSync()
    for (const listener of this.listeners) {
      try {
        listener(snap)
      } catch {
        // Ignore subscriber error.
      }
    }
  }

  private async saveState(): Promise<void> {
    await saveColabPersistedState(this.statePath, {
      connections: this.connections,
      workspaceConnections: this.workspaceConnections,
      lastRunsByWorkspace: this.lastRunsByWorkspace,
      ignoredUntrackedKeys: this.ignoredUntrackedKeys
    })
  }

  getSnapshotSync(): ColabStateSnapshot {
    const sessionList = [...this.sessions.values()]
    return {
      cli: this.cli.status,
      connections: this.connections.map((c) => buildColabConnectionView(c, sessionList)),
      workspaceConnections: { ...this.workspaceConnections },
      oauthPending: this.oauth.pendingState,
      lastLoginOutcome: this.lastLoginOutcome,
      sessions: sessionList.sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      untrackedSessions: [...this.untrackedSessions],
      lastRunsByWorkspace: { ...this.lastRunsByWorkspace }
    }
  }

  async getSnapshot(): Promise<ColabStateSnapshot> {
    await this.initialize()
    return this.getSnapshotSync()
  }

  resolveConnectionForWorkspace(workspaceRoot: string): PersistedConnectionRecord | null {
    const key = normalizeWorkspaceKey(workspaceRoot)
    const explicitId = key ? this.workspaceConnections[key] : undefined
    if (explicitId) {
      const found = this.connections.find((c) => c.id === explicitId && c.status === 'connected')
      if (found) return found
    }
    return this.connections.find((c) => c.status === 'connected') ?? this.connections[0] ?? null
  }

  async ensureCliRuntime(options?: { upgrade?: boolean }): Promise<ColabCliRuntimeStatus> {
    await this.initialize()
    const res = await this.cli.ensureInstalled({
      upgrade: options?.upgrade,
      onStatusChange: () => this.emit()
    })
    this.emit()
    return res
  }

  async startOAuthLogin(input: {
    name?: string
    setAsCurrent?: boolean
    workspaceRoot?: string
    reauthConnectionId?: string
  }): Promise<{ ok: true; flow: ColabOAuthPendingState } | { ok: false; message: string }> {
    await this.initialize()
    this.lastLoginOutcome = null
    const reauthTarget = input.reauthConnectionId
      ? this.connections.find((c) => c.id === input.reauthConnectionId)
      : undefined
    try {
      const flow = await this.oauth.startFlow({
        flowId: `oauth-${randomUUID().slice(0, 8)}`,
        connectionName: input.name?.trim() || reauthTarget?.name || '',
        setAsCurrent: input.setAsCurrent ?? true,
        workspaceRoot: normalizeWorkspaceKey(input.workspaceRoot ?? ''),
        ...(reauthTarget
          ? { reauthConnectionId: reauthTarget.id, reauthExpectedEmail: reauthTarget.email }
          : {})
      })
      this.emit()
      return { ok: true, flow }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  async submitManualCode(flowId: string, code: string): Promise<ColabLoginOutcome> {
    await this.initialize()
    const flow = this.oauth.pendingState
    if (!flow || flow.flowId !== flowId) {
      return { ok: false, kind: 'error', message: '登录流程不存在或已过期。' }
    }
    try {
      const identity = await this.oauth.submitManualCode(flowId, code)
      return await this.applyAuthorizedIdentity(flow, identity)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const outcome: ColabLoginOutcome = { ok: false, kind: 'error', message }
      this.lastLoginOutcome = outcome
      this.emit()
      return outcome
    }
  }

  private async applyAuthorizedIdentity(
    flow: ColabOAuthPendingState,
    identity: VerifiedColabIdentity
  ): Promise<ColabLoginOutcome> {
    const outcome = await applyColabAuthorizedIdentity({
      flow,
      identity,
      connections: this.connections,
      workspaceConnections: this.workspaceConnections,
      sessions: this.sessions.values(),
      mismatchedTokens: this.mismatchedTokens,
      credentials: this.credentials,
      saveState: () => this.saveState(),
      onRefreshConnection: (connectionId) => {
        void this.refreshBalances({ connectionId })
      }
    })
    this.lastLoginOutcome = outcome
    this.emit()
    return outcome
  }

  async promoteMismatchedToken(input: {
    pendingTokenId: string
    name?: string
    workspaceRoot?: string
    setAsCurrent?: boolean
  }): Promise<ColabLoginOutcome> {
    await this.initialize()
    const cached = this.mismatchedTokens.get(input.pendingTokenId)
    if (!cached) {
      return { ok: false, kind: 'error', message: '待添加凭据已过期，请重新登录。' }
    }
    this.mismatchedTokens.delete(input.pendingTokenId)
    return this.applyAuthorizedIdentity(
      {
        flowId: input.pendingTokenId,
        connectionName: input.name?.trim() || '',
        setAsCurrent: input.setAsCurrent ?? true,
        workspaceRoot: normalizeWorkspaceKey(input.workspaceRoot ?? ''),
        authUrl: '',
        manualAuthUrl: '',
        expiresAt: Date.now()
      },
      { email: cached.email, token: cached.token }
    )
  }

  async cancelOAuthLogin(_flowId: string): Promise<{ ok: boolean }> {
    const ok = await this.oauth.cancelCurrent('user')
    this.emit()
    return { ok }
  }

  async reopenOAuthUrl(flowId: string): Promise<{ ok: boolean }> {
    return { ok: await this.oauth.reopenUrl(flowId) }
  }

  clearLastLoginOutcome(): { ok: boolean } {
    this.lastLoginOutcome = null
    this.emit()
    return { ok: true }
  }

  async selectWorkspaceConnection(
    workspaceRoot: string,
    connectionId: string
  ): Promise<{ ok: boolean; previousConnectionId: string | null }> {
    await this.initialize()
    const target = this.connections.find((c) => c.id === connectionId)
    if (!target || target.status !== 'connected') {
      return { ok: false, previousConnectionId: null }
    }
    const key = normalizeWorkspaceKey(workspaceRoot)
    const previous = (key && this.workspaceConnections[key]) || null
    if (key) {
      this.workspaceConnections[key] = connectionId
      await this.saveState()
    }
    this.emit()
    return { ok: true, previousConnectionId: previous }
  }

  async renameConnection(connectionId: string, name: string): Promise<{ ok: boolean }> {
    await this.initialize()
    const trimmed = name.trim().slice(0, 48)
    const target = this.connections.find((c) => c.id === connectionId)
    if (!target || !trimmed) return { ok: false }
    target.name = trimmed
    target.updatedAt = new Date().toISOString()
    for (const s of this.sessions.values()) {
      if (s.connectionId === connectionId) s.connectionName = trimmed
    }
    await this.saveState()
    this.emit()
    return { ok: true }
  }

  async signOutConnection(
    connectionId: string,
    stopRunningSessions: boolean
  ): Promise<{ ok: boolean; switchedToConnectionId: string | null; message?: string }> {
    await this.initialize()
    const res = await removeColabConnection({
      connectionId,
      stopRunningSessions,
      connections: this.connections,
      workspaceConnections: this.workspaceConnections,
      sessions: this.sessions,
      credentials: this.credentials,
      stopSession: (id, remoteStop) => this.executor.stopSession(id, remoteStop)
    })
    if (!res.ok) return res
    this.untrackedSessions = this.untrackedSessions.filter((u) => u.connectionId !== connectionId)
    await this.saveState()
    this.emit()
    return res
  }

  async refreshBalances(input?: { connectionId?: string }): Promise<ColabStateSnapshot> {
    await this.initialize()
    if (this.cli.status.state !== 'ready') {
      const probed = await this.cli.probe()
      if (probed.state !== 'ready') return this.getSnapshotSync()
    }
    const targets = input?.connectionId
      ? this.connections.filter((c) => c.id === input.connectionId)
      : this.connections.filter((c) => c.status === 'connected')

    const discovered = await pollColabBalancesAndRemoteSessions({
      targets,
      cli: this.cli,
      credentials: this.credentials,
      isolation: this.isolation,
      sessions: this.sessions.values(),
      ignoredUntrackedKeys: this.ignoredUntrackedKeys,
      settings: this.options.getColabSettings(),
      lowBalanceNotifiedIds: this.lowBalanceNotifiedIds,
      onLowBalanceNotice: this.options.onLowBalanceNotice
    })

    if (!input?.connectionId) {
      this.untrackedSessions = discovered
    }
    await this.saveState()
    this.emit()
    return this.getSnapshotSync()
  }

  async inspectWorkspaceSync(workspaceRoot: string) {
    return inspectWorkspaceSyncCandidates(workspaceRoot)
  }

  async saveWorkspaceConfig(workspaceRoot: string, config: ColabWorkspaceRunConfig) {
    await saveWorkspaceColabConfig(workspaceRoot, config)
    return { ok: true }
  }

  async startRun(
    input: ColabStartRunRequest
  ): Promise<{ ok: true; session: ColabSessionView } | { ok: false; code?: string; message: string }> {
    await this.initialize()
    const conn = this.connections.find((c) => c.id === input.connectionId)
    if (!conn) return { ok: false, code: 'no_connection', message: '请先选择有效的 Google 账号连接。' }
    if (conn.status !== 'connected') {
      return { ok: false, code: 'auth_expired', message: `「${conn.name}」授权已过期，请先重新登录。` }
    }

    const wsKey = normalizeWorkspaceKey(input.workspaceRoot)
    if (input.setAsWorkspaceCurrent && wsKey) {
      this.workspaceConnections[wsKey] = conn.id
      await this.saveState()
    }
    if (input.saveWorkspaceConfig && wsKey) {
      await saveWorkspaceColabConfig(wsKey, {
        entryCommand: input.entryCommand,
        accelerator: input.accelerator,
        ...(input.highMem ? { highMem: true } : {}),
        syncPaths: input.syncPaths,
        outputRemoteDir: input.outputRemoteDir,
        outputLocalDir: input.outputLocalDir,
        maxRuntimeHours: input.maxRuntimeHours,
        autoStop: input.autoStop,
        mountDrive: input.mountDrive,
        envVars: input.envVars,
        setupScript: input.setupScript
      })
    }

    const session = createColabSessionDraft(conn, wsKey, input)
    this.sessions.set(session.id, session)
    this.emit()
    void this.executor.startSessionRun(session, input)
    return { ok: true, session }
  }

  async stopSession(sessionId: string): Promise<{ ok: boolean; message?: string }> {
    await this.executor.stopSession(sessionId, true)
    this.emit()
    return { ok: true }
  }

  async extendSession(
    sessionId: string,
    addMinutes: number
  ): Promise<{ ok: boolean; session?: ColabSessionView; message?: string }> {
    await this.initialize()
    const ok = await this.executor.extendSession(sessionId, addMinutes)
    if (!ok) return { ok: false, message: '无法延长当前未运行的会话。' }
    return { ok: true, session: this.sessions.get(sessionId) }
  }

  async reconnectSession(sessionId: string): Promise<{ ok: boolean; message?: string }> {
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, message: '会话不存在。' }
    if (session.phase !== 'disconnected' && session.phase !== 'running') return { ok: false, message: '运行时不可恢复。' }
    this.patchSession(sessionId, {
      phase: 'running',
      errorKind: undefined,
      errorMessage: undefined
    })
    this.executor.resumeResourceMonitoring(session)
    return { ok: true }
  }

  async uploadToSession(sessionId: string, localPaths: string[], transfer: UploadOptions, targetRemoteDir?: string): Promise<RuntimeUploadResult> {
    const s = this.sessions.get(sessionId)
    if (!s || s.phase !== 'running') return { ok: false, uploadedCount: 0, message: '运行时未连接。' }
    const res = await uploadFilesToColabSession({
      session: s,
      localPaths, targetRemoteDir, transfer,
      cli: this.cli,
      credentials: this.credentials,
      isolation: this.isolation
    })
    if (res.uploadedCount) {
      this.patchSession(sessionId, {
        logTail: [...(this.sessions.get(sessionId)?.logTail ?? []), `[sync] uploaded ${res.uploadedCount} file(s)`].slice(-250)
      })
    }
    return res
  }

  async downloadFromSession(
    sessionId: string,
    remotePath?: string
  ): Promise<{ ok: boolean; localPath?: string; message?: string }> {
    const s = this.sessions.get(sessionId)
    if (!s) return { ok: false, message: '会话不存在。' }
    return downloadArtifactsFromColabSession({
      session: s,
      remotePath,
      cli: this.cli,
      credentials: this.credentials,
      isolation: this.isolation,
      executor: this.executor
    })
  }

  async openBrowser(input: {
    connectionId: string
    sessionId?: string
  }): Promise<{ ok: boolean; url?: string; message?: string }> {
    const sess = input.sessionId ? this.sessions.get(input.sessionId) : undefined
    const url = await resolveColabSessionBrowserUrl({
      session: sess,
      cli: this.cli,
      credentials: this.credentials,
      isolation: this.isolation
    })
    await this.options.openExternal(url)
    return { ok: true, url }
  }

  async prepareTerminalLaunch(input: {
    sessionId?: string
    connectionId?: string
    workspaceRoot?: string
  }): Promise<
    | { ok: true; title: string; command: string; cwd?: string; env: Record<string, string> }
    | { ok: false; message: string }
  > {
    await this.initialize()
    const status = await this.cli.ensureInstalled()
    if (status.state !== 'ready') {
      return { ok: false, message: status.message || 'Colab CLI 运行时未就绪。' }
    }
    const sess = input.sessionId ? this.sessions.get(input.sessionId) : undefined
    const conn = sess
      ? this.connections.find((c) => c.id === sess.connectionId)
      : input.connectionId
        ? this.connections.find((c) => c.id === input.connectionId)
        : this.resolveConnectionForWorkspace(input.workspaceRoot ?? '')
    if (!conn) return { ok: false, message: '请先连接 Google 账号。' }

    const prepared = await prepareColabTerminalCommand({
      connection: conn,
      session: sess,
      workspaceRoot: input.workspaceRoot,
      cli: this.cli,
      credentials: this.credentials,
      isolation: this.isolation
    })
    return { ok: true, ...prepared }
  }

  async adoptUntrackedSession(input: {
    connectionId: string
    endpoint: string
    workspaceRoot: string
  }): Promise<{ ok: boolean; session?: ColabSessionView; message?: string }> {
    const item = this.untrackedSessions.find(
      (u) => u.connectionId === input.connectionId && u.endpoint === input.endpoint
    )
    const conn = this.connections.find((c) => c.id === input.connectionId)
    if (!item || !conn) return { ok: false, message: '未找到该远端会话。' }
    const adopted = buildAdoptedSessionView(item, conn, input.workspaceRoot)
    this.sessions.set(adopted.id, adopted)
    this.executor.resumeResourceMonitoring(adopted)
    this.untrackedSessions = this.untrackedSessions.filter(
      (u) => !(u.connectionId === input.connectionId && u.endpoint === input.endpoint)
    )
    this.emit()
    return { ok: true, session: adopted }
  }

  async stopUntrackedSession(input: {
    connectionId: string
    endpoint: string
  }): Promise<{ ok: boolean; message?: string }> {
    const res = await stopRemoteUntrackedEndpoint({
      connectionId: input.connectionId,
      endpoint: input.endpoint,
      cli: this.cli,
      credentials: this.credentials,
      isolation: this.isolation
    })
    if (res.ok) {
      this.untrackedSessions = this.untrackedSessions.filter(
        (u) => !(u.connectionId === input.connectionId && u.endpoint === input.endpoint)
      )
      this.emit()
    }
    return res
  }

  async ignoreUntrackedSession(input: {
    connectionId: string
    endpoint: string
  }): Promise<{ ok: boolean }> {
    this.ignoredUntrackedKeys.add(`${input.connectionId}:${input.endpoint}`)
    this.untrackedSessions = this.untrackedSessions.filter(
      (u) => !(u.connectionId === input.connectionId && u.endpoint === input.endpoint)
    )
    await this.saveState()
    this.emit()
    return { ok: true }
  }

  private patchSession(sessionId: string, patch: Partial<ColabSessionView>): void {
    const existing = this.sessions.get(sessionId)
    if (!existing) return
    Object.assign(existing, patch)
    this.emit()
  }

  private markConnectionStatus(connectionId: string, status: ColabConnectionStatus): void {
    const target = this.connections.find((c) => c.id === connectionId)
    if (!target || target.status === status) return
    target.status = status
    target.updatedAt = new Date().toISOString()
    void this.saveState()
    this.emit()
  }

  private recordLastRun(session: ColabSessionView): void {
    if (!session.workspaceRoot) return
    this.lastRunsByWorkspace[session.workspaceRoot] = buildLastRunSummary(session)
    void this.saveState()
  }

  private tickActiveSessions(): void {
    const settings = this.options.getColabSettings()
    let changed = false
    const now = Date.now()
    for (const s of this.sessions.values()) {
      if (!isActiveColabSessionPhase(s.phase)) continue
      const startedMs = Date.parse(s.startedAt)
      if (!Number.isFinite(startedMs)) continue
      const elapsed = Math.max(0, Math.floor((now - startedMs) / 1000))
      if (elapsed !== s.elapsedSeconds) {
        s.elapsedSeconds = elapsed
        s.consumedCu = Number(((elapsed / 3600) * s.burnRateCuPerHour).toFixed(2))
        changed = true
      }
      if (s.phase === 'running') {
        const conn = this.connections.find((c) => c.id === s.connectionId) ?? null
        const guard = evaluateSessionCostGuard({ session: s, connection: conn, nowMs: now })
        const prevWarn = (s.guardWarnings ?? []).join(',')
        if (guard.warnings.join(',') !== prevWarn) {
          s.guardWarnings = guard.warnings
          changed = true
        }
        if (guard.stopReason) {
          s.guardStoppedReason = guard.stopReason
          changed = true
          void this.executor.stopSession(s.id, true)
          continue
        }
      }
      if (
        settings.idleAutoStopEnabled &&
        s.entryCommand === '(adopted remote session)' &&
        elapsed >= settings.idleAutoStopMinutes * 60
      ) {
        void this.executor.stopSession(s.id, true)
      }
    }
    if (changed) this.emit()
  }

  async shutdown(): Promise<void> {
    await this.initialization?.catch(() => undefined)
    if (this.clockInterval) clearInterval(this.clockInterval)
    if (this.refreshInterval) clearInterval(this.refreshInterval)
    this.clockInterval = null
    this.refreshInterval = null
    this.executor.stopMonitoring()
    await this.oauth.cancelCurrent('shutdown')

    const stopRemote = this.options.getColabSettings().stopSessionsOnQuit
    for (const s of this.sessions.values()) {
      if (['provisioning', 'uploading', 'installing', 'running'].includes(s.phase)) {
        await this.executor.stopSession(s.id, stopRemote)
      }
    }
    if (stopRemote) {
      await this.credentials.cleanupRuntimeFiles()
    }
  }
}
