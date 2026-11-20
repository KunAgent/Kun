import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import { shell } from 'electron'
import type { RuntimeUploadResult } from '../../shared/colab/runtime-upload'
import { uploadRuntimeFiles, type UploadOptions } from './runtime-file-upload'
import { NOTEBOOK_PULL_MAX_FILES } from '../../shared/colab/colab-notebook-types'
import type {
  ColabDriveNotebookEntry,
  ColabDriveNotebooksListResult,
  ColabNotebookExecEvent,
  ColabNotebookExecuteResult,
  ColabNotebookVariablesResult,
  ColabRemoteEntry,
  ColabRemoteListResult,
  JupyterConnectRequest,
  JupyterConnectResult,
  JupyterSaveServerRequest,
  JupyterSaveServerResult,
  NotebookPullImportResult,
  JupyterServerView,
  JupyterSessionView,
  JupyterStateSnapshot
} from '../../shared/colab/colab-notebook-types'
import type { ColabCredentialStore } from './colab-credential-store'
import { buildKernelVariablesPython, parseKernelVariablesOutput } from './colab-notebook-kernel'
import { normalizeWorkspaceKey } from './colab-state-store'
import { resolveNotebookImportRoot, writeNonCollidingNotebook } from './notebook-import-file'
import {
  authenticateJupyterServer,
  deleteJupyterKernel,
  encodeJupyterPath,
  executeJupyterKernelCode,
  parseJupyterServerUrl,
  postJupyterKernelAction,
  startJupyterKernel,
  type JupyterAuthHeaders,
  type JupyterWebSocketFactory
} from './jupyter-server-protocol'

const CRED_PREFIX = 'jpy-srv-'
const SESSION_PREFIX = 'jpy-'
const NOTEBOOK_SCAN_TIMEOUT_MS = 45_000

export function isJupyterSessionId(sessionId: string): boolean {
  return sessionId.startsWith(SESSION_PREFIX)
}

type ActiveJupyterSession = {
  view: JupyterSessionView
  headers: JupyterAuthHeaders
}

type RunningJupyterExec = {
  sessionId: string
  abortSocket: () => void
}

type JupyterContentsItem = {
  name?: string
  path?: string
  type?: 'directory' | 'file' | 'notebook'
  size?: number | null
  last_modified?: string
  format?: string | null
  content?: unknown
}

type FileAccess = { baseUrl: string; headers: JupyterAuthHeaders }

function notebookPath(path: string): boolean {
  return path.toLowerCase().endsWith('.ipynb') && !path.includes('\\') &&
    !path.split('/').some((part) => part === '.' || part === '..')
}

/** Manages standard Jupyter Server connections, kernel sessions, files, and notebooks. */
export class JupyterServerManager {
  private readonly statePath: string
  private servers: JupyterServerView[] = []
  private readonly sessions = new Map<string, ActiveJupyterSession>()
  private readonly runningExecs = new Map<string, RunningJupyterExec>()
  private readonly listeners = new Set<(snapshot: JupyterStateSnapshot) => void>()
  private initialized: Promise<void> | null = null

  constructor(
    private readonly options: {
      colabRootDir: string
      credentials: ColabCredentialStore
      emitNotebookEvent: (event: ColabNotebookExecEvent) => void
      fetchImpl?: typeof fetch
      createWebSocket?: JupyterWebSocketFactory
      openExternal?: (url: string) => Promise<void>
    }
  ) {
    this.statePath = join(options.colabRootDir, 'jupyter-servers.v1.json')
  }

  private get fetchFn(): typeof fetch {
    return this.options.fetchImpl ?? fetch
  }

  private ensureInit(): Promise<void> {
    this.initialized ??= this.loadState().catch(() => {
      this.servers = []
    })
    return this.initialized
  }

  private async loadState(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.statePath, 'utf8')) as { servers?: JupyterServerView[] }
      if (Array.isArray(raw?.servers)) this.servers = raw.servers
    } catch {
      this.servers = []
    }
  }

  private async saveState(): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 })
    const temp = `${this.statePath}.${randomUUID().slice(0, 8)}.tmp`
    try {
      await writeFile(temp, JSON.stringify({ servers: this.servers }, null, 2), { mode: 0o600 })
      await rename(temp, this.statePath)
    } finally {
      await rm(temp, { force: true }).catch(() => undefined)
    }
  }

  subscribe(listener: (snapshot: JupyterStateSnapshot) => void): () => void {
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

  getSnapshotSync(): JupyterStateSnapshot {
    return {
      servers: [...this.servers],
      sessions: [...this.sessions.values()].map((s) => ({ ...s.view }))
    }
  }

  async getSnapshot(): Promise<JupyterStateSnapshot> {
    await this.ensureInit()
    return this.getSnapshotSync()
  }

  private async readSecret(serverId: string): Promise<string> {
    const stored = await this.options.credentials.readToken(`${CRED_PREFIX}${serverId}`).catch(() => null)
    return stored?.token ?? ''
  }

  private async writeSecret(serverId: string, baseUrl: string, secret: string): Promise<void> {
    if (!secret) {
      await this.options.credentials.removeConnection(`${CRED_PREFIX}${serverId}`)
      return
    }
    await this.options.credentials.writeToken(`${CRED_PREFIX}${serverId}`, {
      token: secret,
      refresh_token: secret,
      token_uri: baseUrl,
      client_id: 'jupyter',
      client_secret: '',
      scopes: []
    })
  }

  private async resolveServer(input: JupyterSaveServerRequest) {
    await this.ensureInit()
    const existing = input.serverId ? this.servers.find((s) => s.id === input.serverId) : undefined
    if (input.serverId && !existing) throw new Error('This Jupyter connection was removed.')
    const rawUrl = input.url?.trim() || existing?.baseUrl || ''
    const explicit = input.tokenOrPassword ?? (!input.url && existing ? await this.readSecret(existing.id) : '')
    const { baseUrl, secret, defaultName } = parseJupyterServerUrl(rawUrl, explicit)
    const known = existing ?? this.servers.find((server) => server.baseUrl === baseUrl)
    return { baseUrl, secret, known, name: input.name?.trim() || known?.name || defaultName }
  }

  private async persistServer(
    resolved: Awaited<ReturnType<JupyterServerManager['resolveServer']>>,
    authMode: JupyterServerView['authMode'],
    kernelName: string,
    availableKernels: string[]
  ): Promise<JupyterServerView> {
    const { known, baseUrl, secret, name } = resolved
    const server = {
      id: known?.id ?? `jsrv-${randomUUID().slice(0, 8)}`,
      name, baseUrl, hasAuth: Boolean(secret), authMode, kernelName, availableKernels,
      updatedAt: new Date().toISOString()
    }
    await this.writeSecret(server.id, baseUrl, secret)
    this.servers = [server, ...this.servers.filter((item) => item.id !== server.id)]
    await this.saveState()
    return server
  }

  async saveServer(input: JupyterSaveServerRequest): Promise<JupyterSaveServerResult> {
    try {
      const resolved = await this.resolveServer(input)
      const auth = await authenticateJupyterServer(resolved.baseUrl, resolved.secret, this.fetchFn, 'files')
      if (!auth.ok) return auth
      const { known, baseUrl } = resolved
      const unchanged = known?.baseUrl === baseUrl
      const server = await this.persistServer(resolved, auth.authMode,
        unchanged ? known.kernelName : auth.defaultKernel, unchanged ? known.availableKernels : [])
      this.emit()
      return { ok: true, server }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Could not save the Jupyter connection.' }
    }
  }

  async connect(input: JupyterConnectRequest): Promise<JupyterConnectResult> {
    const wsKey = normalizeWorkspaceKey(input.workspaceRoot)
    if (!wsKey) return { ok: false, message: 'Select a project workspace first.' }
    try {
      const resolved = await this.resolveServer(input)
      const { baseUrl, secret, known } = resolved
      const auth = await authenticateJupyterServer(baseUrl, secret, this.fetchFn)
      if (!auth.ok) return auth

      const desiredKernel = input.kernelName?.trim() ||
        (known && auth.kernels.includes(known.kernelName) ? known.kernelName : auth.defaultKernel)
      const kernel = await startJupyterKernel(baseUrl, auth.headers, desiredKernel, this.fetchFn)
      if (!kernel.ok) return kernel
      let server: JupyterServerView
      try {
        server = await this.persistServer(resolved, auth.authMode, kernel.kernelName, auth.kernels)
      } catch (error) {
        await deleteJupyterKernel(baseUrl, auth.headers, kernel.kernelId, this.fetchFn)
        throw error
      }
      // Only an explicit execution connection replaces the existing workspace kernel.
      for (const [sid, active] of [...this.sessions.entries()]) {
        if (active.view.workspaceRoot === wsKey) await this.disconnect(sid)
      }
      const now = new Date().toISOString()
      const sessionView: JupyterSessionView = {
      id: `${SESSION_PREFIX}${randomUUID().slice(0, 10)}`,
      serverId: server.id,
      serverName: server.name,
      baseUrl: server.baseUrl,
      workspaceRoot: wsKey,
      kernelId: kernel.kernelId,
      kernelName: kernel.kernelName,
      startedAt: now
    }
      this.sessions.set(sessionView.id, { view: sessionView, headers: auth.headers })
      this.emit()
      return { ok: true, server: { ...server }, session: { ...sessionView } }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Could not start the Jupyter kernel.' }
    }
  }

  async disconnect(sessionId: string): Promise<{ ok: boolean }> {
    const active = this.sessions.get(sessionId)
    if (!active) return { ok: false }
    for (const [execId, exec] of [...this.runningExecs.entries()]) {
      if (exec.sessionId === sessionId) this.interruptExec(execId)
    }
    this.sessions.delete(sessionId)
    await deleteJupyterKernel(active.view.baseUrl, active.headers, active.view.kernelId, this.fetchFn)
    this.emit()
    return { ok: true }
  }

  async removeServer(serverId: string): Promise<{ ok: boolean }> {
    await this.ensureInit()
    for (const [sid, active] of [...this.sessions.entries()]) {
      if (active.view.serverId === serverId) await this.disconnect(sid)
    }
    const before = this.servers.length
    this.servers = this.servers.filter((s) => s.id !== serverId)
    await this.options.credentials.removeConnection(`${CRED_PREFIX}${serverId}`)
    if (this.servers.length !== before) {
      await this.saveState()
      this.emit()
    }
    return { ok: this.servers.length !== before }
  }

  async openBrowser(serverId: string): Promise<{ ok: boolean }> {
    await this.ensureInit()
    const server = this.servers.find((s) => s.id === serverId)
    if (!server) return { ok: false }
    const secret = await this.readSecret(serverId)
    const url =
      secret && server.authMode !== 'password' && !server.baseUrl.includes('?')
        ? `${server.baseUrl}/lab?token=${encodeURIComponent(secret)}`
        : `${server.baseUrl}/lab`
    await (this.options.openExternal ?? ((u) => shell.openExternal(u)))(url)
    return { ok: true }
  }

  async execute(input: { sessionId: string; execId: string; code: string }): Promise<ColabNotebookExecuteResult> {
    const active = this.sessions.get(input.sessionId)
    if (!active) {
      this.options.emitNotebookEvent({
        execId: input.execId,
        kind: 'done',
        ok: false,
        interrupted: false,
        message: 'Jupyter kernel is not connected.'
      })
      return { ok: false, message: 'Jupyter kernel is not connected.' }
    }
    if (this.runningExecs.has(input.execId)) return { ok: false, message: 'Execution already running.' }

    void executeJupyterKernelCode({
      baseUrl: active.view.baseUrl,
      kernelId: active.view.kernelId,
      headers: active.headers,
      code: input.code,
      createWebSocket: this.options.createWebSocket,
      onOutput: (output) => {
        this.options.emitNotebookEvent({ execId: input.execId, kind: 'output', output })
      },
      onClear: () => {
        this.options.emitNotebookEvent({ execId: input.execId, kind: 'clear' })
      },
      onSocketReady: (abortSocket) => {
        this.runningExecs.set(input.execId, { sessionId: input.sessionId, abortSocket })
      }
    }).then((done) => {
      this.runningExecs.delete(input.execId)
      this.options.emitNotebookEvent({
        execId: input.execId,
        kind: 'done',
        ok: done.ok,
        interrupted: done.interrupted,
        message: done.message
      })
    })
    return { ok: true }
  }

  hasRunningExec(execId: string): boolean {
    return this.runningExecs.has(execId)
  }

  interruptExec(execId: string): { ok: boolean } {
    const exec = this.runningExecs.get(execId)
    if (!exec) return { ok: false }
    this.runningExecs.delete(execId)
    const active = this.sessions.get(exec.sessionId)
    if (active) {
      void postJupyterKernelAction(active.view.baseUrl, active.headers, active.view.kernelId, 'interrupt', this.fetchFn)
    }
    exec.abortSocket()
    return { ok: true }
  }

  async restartKernel(sessionId: string): Promise<{ ok: boolean; message?: string }> {
    const active = this.sessions.get(sessionId)
    if (!active) return { ok: false, message: 'Jupyter session not found.' }
    for (const [execId, exec] of [...this.runningExecs.entries()]) {
      if (exec.sessionId === sessionId) this.interruptExec(execId)
    }
    return postJupyterKernelAction(active.view.baseUrl, active.headers, active.view.kernelId, 'restart', this.fetchFn)
  }

  private async fileAccess(serverId: string): Promise<({ ok: true } & FileAccess) | { ok: false; message: string }> {
    try {
      const { baseUrl, secret } = await this.resolveServer({ serverId })
      const auth = await authenticateJupyterServer(baseUrl, secret, this.fetchFn, 'files')
      return auth.ok ? { ok: true, baseUrl, headers: auth.headers } : auth
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Jupyter connection unavailable.' }
    }
  }

  private async fetchContents(source: string | FileAccess, remotePath: string, query = 'content=1', signal?: AbortSignal): Promise<
    | { ok: true; data: JupyterContentsItem }
    | { ok: false; message: string }
  > {
    const active = typeof source === 'string' ? this.sessions.get(source) : undefined
    const access = typeof source === 'string' ? active && { baseUrl: active.view.baseUrl, headers: active.headers } : source
    if (!access) return { ok: false, message: 'Jupyter session not connected.' }
    const encoded = encodeJupyterPath(remotePath)
    const url = `${access.baseUrl}/api/contents${encoded ? `/${encoded}` : ''}?${query}`
    try {
      const timeout = AbortSignal.timeout(20_000)
      const res = await this.fetchFn(url, {
        headers: { Accept: 'application/json', ...access.headers },
        redirect: 'manual',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      })
      if (!res.ok) return { ok: false, message: `Jupyter files could not be read (HTTP ${res.status}).` }
      return { ok: true, data: (await res.json()) as JupyterContentsItem }
    } catch {
      return { ok: false, message: 'Could not read files from the Jupyter server.' }
    }
  }

  async listFiles(input: { sessionId: string; path: string }): Promise<ColabRemoteListResult> {
    const normPath = input.path === '/content' ? '/' : input.path || '/'
    const fetched = await this.fetchContents(input.sessionId, normPath, 'content=1')
    if (!fetched.ok) return fetched
    const rawItems = Array.isArray(fetched.data.content) ? (fetched.data.content as JupyterContentsItem[]) : []
    const entries: ColabRemoteEntry[] = rawItems
      .map((item) => {
        const name = String(item.name ?? '')
        const itemPath = '/' + String(item.path ?? name).replace(/^\/+/, '')
        const isDir = item.type === 'directory'
        return { name, path: itemPath, isDir, size: isDir ? 0 : Number(item.size ?? 0) }
      })
      .filter((e) => Boolean(e.name))
      .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)))
    return { ok: true, path: normPath, entries }
  }

  async listVariables(input: { sessionId: string }): Promise<ColabNotebookVariablesResult> {
    const active = this.sessions.get(input.sessionId)
    if (!active) return { ok: false, message: 'Jupyter kernel not connected.' }
    let stdout = ''
    await executeJupyterKernelCode({
      baseUrl: active.view.baseUrl,
      kernelId: active.view.kernelId,
      headers: active.headers,
      code: buildKernelVariablesPython(),
      storeHistory: false,
      createWebSocket: this.options.createWebSocket,
      onOutput: (out) => {
        if (out.type === 'stream' && out.name === 'stdout') stdout += out.text
      }
    })
    const parsed = parseKernelVariablesOutput(stdout)
    return parsed ? { ok: true, variables: parsed } : { ok: true, variables: [] }
  }

  async listNotebooks(input: { serverId: string }): Promise<ColabDriveNotebooksListResult> {
    const access = await this.fileAccess(input.serverId)
    if (!access.ok) return access
    const skip = new Set(['node_modules', 'venv', '__pycache__'])
    const found = new Map<string, ColabDriveNotebookEntry>()
    const queue = [{ path: '/', depth: 0 }]
    const visited = new Set<string>()
    const signal = AbortSignal.timeout(NOTEBOOK_SCAN_TIMEOUT_MS)
    let directoryError: string | undefined
    for (const dir of queue) {
      if (visited.size >= 60) break
      if (visited.has(dir.path)) continue
      visited.add(dir.path)
      const fetched = await this.fetchContents(access, dir.path, 'content=1', signal)
      if (!fetched.ok || !Array.isArray(fetched.data?.content)) {
        const message = fetched.ok ? 'The Jupyter server did not return a directory.' : fetched.message
        if (dir.depth === 0 || signal.aborted) return { ok: false, message }
        directoryError ??= message
        continue
      }
      for (const item of fetched.data.content as JupyterContentsItem[]) {
        const name = String(item?.name ?? '')
        if (!name || name.startsWith('.') || skip.has(name) || /[\\/]/.test(name)) continue
        const rel = String(item.path ?? (dir.path.replace(/^\//, '') + '/' + name)).replace(/^\/+/, '')
        const path = '/' + rel
        if (posix.dirname(path) !== dir.path || rel.includes('\\') || rel.split('/').some((part) => part === '..' || part === '.')) continue
        if (item.type === 'directory' && dir.depth < 3) {
          if (queue.length < 60) queue.push({ path, depth: dir.depth + 1 })
        } else if (item.type !== 'directory' && notebookPath(path)) {
          const mtime = item.last_modified ? Date.parse(item.last_modified) : 0
          found.set(path, { name, remotePath: path, relativePath: rel, sizeBytes: Number(item.size) || 0,
            modifiedAtMs: Number.isFinite(mtime) ? mtime : 0 })
        }
      }
    }
    if (directoryError && found.size === 0) return { ok: false, message: directoryError }
    const entries = [...found.values()].sort((a, b) => b.modifiedAtMs - a.modifiedAtMs).slice(0, NOTEBOOK_PULL_MAX_FILES)
    return { ok: true, status: 'ready', entries }
  }

  async importNotebook(input: {
    serverId: string
    remotePath: string
    workspaceRoot: string
  }): Promise<NotebookPullImportResult> {
    if (!notebookPath(input.remotePath)) return { ok: false, message: 'Select a .ipynb on this Jupyter server.' }
    const root = await resolveNotebookImportRoot(input.workspaceRoot).catch(() => null)
    if (!root) return { ok: false, message: 'The target project is not available.' }
    const access = await this.fileAccess(input.serverId)
    if (!access.ok) return access
    const fetched = await this.fetchContents(access, input.remotePath)
    if (!fetched.ok) return fetched
    let bytes: Buffer
    const contentObj =
      fetched.data.content && typeof fetched.data.content === 'object'
        ? (fetched.data.content as { cells?: unknown })
        : null
    if (contentObj && (fetched.data.format === 'json' || Array.isArray(contentObj.cells))) {
      bytes = Buffer.from(JSON.stringify(contentObj, null, 2) + '\n', 'utf8')
    } else if (fetched.data.format === 'base64' && typeof fetched.data.content === 'string') {
      bytes = Buffer.from(fetched.data.content, 'base64')
    } else if (typeof fetched.data.content === 'string') {
      bytes = Buffer.from(fetched.data.content, 'utf8')
    } else {
      return { ok: false, message: 'Unsupported notebook payload from Jupyter server.' }
    }
    try {
      const file = await writeNonCollidingNotebook(root, basename(input.remotePath), bytes, 'Jupyter')
      return { ok: true, file: { ...file, remotePath: input.remotePath } }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Could not save the notebook.' }
    }
  }

  uploadFiles(sessionId: string, localPaths: string[], transfer: UploadOptions): Promise<RuntimeUploadResult> {
    return uploadRuntimeFiles(localPaths.map((localPath) => ({ localPath, remotePath: basename(localPath) })), async () => {
      const active = this.sessions.get(sessionId)
      if (!active) throw new Error('Jupyter session not connected.')
      return { baseUrl: active.view.baseUrl, headers: active.headers }
    }, transfer, this.fetchFn)
  }

  async downloadFile(
    sessionId: string,
    remotePath?: string
  ): Promise<{ ok: boolean; localPath?: string; message?: string }> {
    const active = this.sessions.get(sessionId)
    if (!active || !remotePath) return { ok: false, message: 'Invalid download request.' }
    const asRawFile = await this.fetchContents(sessionId, remotePath, 'type=file&format=base64&content=1')
    const fetched = asRawFile.ok ? asRawFile : await this.fetchContents(sessionId, remotePath, 'content=1')
    if (!fetched.ok) return fetched
    const outDir = join(active.view.workspaceRoot || process.cwd(), 'outputs')
    await mkdir(outDir, { recursive: true })
    const dest = join(outDir, basename(remotePath))
    const bytes =
      fetched.data.format === 'base64' && typeof fetched.data.content === 'string'
        ? Buffer.from(fetched.data.content, 'base64')
        : fetched.data.format === 'json' || (fetched.data.content && typeof fetched.data.content === 'object')
          ? Buffer.from(JSON.stringify(fetched.data.content, null, 2), 'utf8')
          : Buffer.from(String(fetched.data.content ?? ''), 'utf8')
    await writeFile(dest, bytes)
    return { ok: true, localPath: dest }
  }

  async shutdown(): Promise<void> {
    for (const sid of [...this.sessions.keys()]) {
      await this.disconnect(sid)
    }
  }
}
