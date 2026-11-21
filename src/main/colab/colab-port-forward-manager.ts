import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import {
  COLAB_RESERVED_VM_PORT,
  type ColabPortForwardErrorKind,
  type ColabPortForwardStartRequest,
  type ColabPortForwardStartResult,
  type ColabPortForwardView
} from '../../shared/colab/colab-notebook-types'
import type { ColabService } from './colab-service'

export function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildColabProxyCommand(params: {
  pythonPath: string
  sessionsJsonPath: string
  sessionName: string
  platform?: NodeJS.Platform
}): string {
  if ((params.platform ?? process.platform) === 'win32') {
    const q = (s: string): string => `"${s.replace(/"/g, '\\"')}"`
    return `${q(params.pythonPath)} -m colab_cli.cli --config ${q(params.sessionsJsonPath)} ssh --proxy-mode -s ${q(params.sessionName)}`
  }
  return `${shellQuoteSingle(params.pythonPath)} -m colab_cli.cli --config ${shellQuoteSingle(params.sessionsJsonPath)} ssh --proxy-mode -s ${shellQuoteSingle(params.sessionName)}`
}

export function buildSshTunnelArgs(params: {
  pythonPath: string
  sessionsJsonPath: string
  sshKeyPath: string
  sessionName: string
  forwards: ReadonlyArray<{ localPort: number; remotePort: number }>
  platform?: NodeJS.Platform
}): string[] {
  const proxy = buildColabProxyCommand({
    pythonPath: params.pythonPath,
    sessionsJsonPath: params.sessionsJsonPath,
    sessionName: params.sessionName,
    platform: params.platform
  })
  const args = [
    '-N',
    '-T',
    '-F',
    '/dev/null',
    '-i',
    params.sshKeyPath,
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-o',
    'LogLevel=ERROR',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=60',
    '-o',
    `ProxyCommand=${proxy}`
  ]
  for (const fwd of params.forwards) {
    args.push('-L', `127.0.0.1:${fwd.localPort}:127.0.0.1:${fwd.remotePort}`)
  }
  args.push('root@colab-runtime')
  return args
}

/**
 * Verifies the CLI `sessions.json` still records `sessionName`.
 * `colab ssh --proxy-mode -s NAME` allocates a brand-new billed VM if `NAME` is
 * missing from its state file, so we NEVER connect without verifying this first.
 */
export function stateHasRecordedSession(stateJsonText: string, sessionName: string): boolean {
  try {
    const parsed = JSON.parse(stateJsonText) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    return Object.prototype.hasOwnProperty.call(parsed, sessionName)
  } catch {
    return false
  }
}

export function classifySshTunnelError(
  stderr: string,
  exitCode: number | null
): ColabPortForwardErrorKind | null {
  const lower = stderr.toLowerCase()
  if (stderr.includes('(HTTP 429)') || lower.includes('already-active ssh session')) {
    return 'ssh_busy'
  }
  if (
    lower.includes('address already in use') ||
    lower.includes('cannot listen to port') ||
    lower.includes('could not request local forwarding')
  ) {
    return 'port_in_use'
  }
  if (lower.includes('to authorize colab-cli') || lower.includes('401')) {
    return 'auth_required'
  }
  if (
    (lower.includes("session '") && lower.includes('not found')) ||
    lower.includes('appears to be lost') ||
    stderr.includes('(HTTP 404)')
  ) {
    return 'session_gone'
  }
  if (exitCode === 127 || lower.includes('ssh: command not found') || lower.includes('enoent')) {
    return 'ssh_missing'
  }
  return null
}

export function tunnelBackoffSeconds(attempt: number): number {
  const clamped = Math.max(0, Math.min(5, attempt - 1))
  return Math.min(30, 1 << clamped)
}

function validatePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

async function isLocalPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(true))
    })
  })
}

async function isLocalPortListening(port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: '127.0.0.1', port })
    const done = (ok: boolean): void => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

type SessionTunnelGroup = {
  sessionId: string
  child: ChildProcess | null
  probeTimer: ReturnType<typeof setInterval> | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  generation: number
  attempt: number
}

/**
 * Multiplexes all port forwards of a Colab session over a single `ssh -N`
 * connection so multiple local ports (`7860`, `6006`, `8000`, …) share the
 * runtime's single `colab ssh` slot without triggering HTTP 429.
 */
export class ColabPortForwardManager {
  private readonly forwards = new Map<string, ColabPortForwardView>()
  private readonly groups = new Map<string, SessionTunnelGroup>()
  private readonly listeners = new Set<(forwards: ColabPortForwardView[]) => void>()
  private readonly unsubService: () => void

  constructor(private readonly service: ColabService) {
    this.unsubService = service.subscribe((snapshot) => {
      const runningIds = new Set(
        snapshot.sessions.filter((s) => s.phase === 'running').map((s) => s.id)
      )
      for (const sessionId of [...this.groups.keys()]) {
        if (!runningIds.has(sessionId)) {
          this.closeSessionForwards(sessionId)
        }
      }
    })
  }

  subscribe(listener: (forwards: ColabPortForwardView[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): ColabPortForwardView[] {
    return [...this.forwards.values()]
  }

  private emit(): void {
    const list = this.list()
    for (const listener of this.listeners) {
      try {
        listener(list)
      } catch {
        // Ignore subscriber error.
      }
    }
  }

  async startForward(input: ColabPortForwardStartRequest): Promise<ColabPortForwardStartResult> {
    const remotePort = Math.trunc(input.remotePort)
    const localPort = Math.trunc(input.localPort ?? remotePort)
    if (!validatePort(remotePort) || !validatePort(localPort)) {
      return { ok: false, errorKind: 'other', message: '端口号必须在 1–65535 之间。' }
    }
    if (remotePort === COLAB_RESERVED_VM_PORT) {
      return {
        ok: false,
        errorKind: 'port_reserved',
        message: '8080 为 Colab 内部保留端口，请改用 8000、7860 或 6006 等端口。'
      }
    }

    for (const existing of this.forwards.values()) {
      if (existing.state !== 'failed' && existing.localPort === localPort) {
        if (existing.sessionId === input.sessionId && existing.remotePort === remotePort) {
          return { ok: true, forward: existing }
        }
        return {
          ok: false,
          errorKind: 'port_in_use',
          message: `本地端口 ${localPort} 已在转发列表中。`
        }
      }
    }

    // Check host port availability only when not already held by our own group.
    const free = await isLocalPortAvailable(localPort)
    if (!free) {
      return {
        ok: false,
        errorKind: 'port_in_use',
        message: `本地端口 127.0.0.1:${localPort} 已被其他进程占用。`
      }
    }

    const snapshot = await this.service.getSnapshot()
    const session = snapshot.sessions.find((s) => s.id === input.sessionId)
    if (!session || session.phase !== 'running') {
      return {
        ok: false,
        errorKind: 'session_gone',
        message: '当前没有运行中的 Colab 会话，无法建立端口转发。'
      }
    }

    const forward: ColabPortForwardView = {
      id: `pf-${randomUUID().slice(0, 8)}`,
      sessionId: session.id,
      sessionName: session.sessionName,
      localPort,
      remotePort,
      localUrl: `http://127.0.0.1:${localPort}`,
      ...(input.label?.trim() ? { label: input.label.trim() } : {}),
      state: 'starting'
    }
    this.forwards.set(forward.id, forward)
    this.emit()
    void this.reconcileSessionGroup(session.id)
    return { ok: true, forward }
  }

  stopForward(forwardId: string): { ok: boolean } {
    const existing = this.forwards.get(forwardId)
    if (!existing) return { ok: false }
    this.forwards.delete(forwardId)
    this.emit()
    void this.reconcileSessionGroup(existing.sessionId)
    return { ok: true }
  }

  closeSessionForwards(sessionId: string): void {
    this.teardownGroup(sessionId)
    let removed = false
    for (const [id, item] of this.forwards.entries()) {
      if (item.sessionId === sessionId) {
        this.forwards.delete(id)
        removed = true
      }
    }
    if (removed) this.emit()
  }

  private teardownGroup(sessionId: string): void {
    const group = this.groups.get(sessionId)
    if (!group) return
    group.generation += 1
    if (group.probeTimer) clearInterval(group.probeTimer)
    if (group.reconnectTimer) clearTimeout(group.reconnectTimer)
    group.probeTimer = null
    group.reconnectTimer = null
    group.child?.kill('SIGTERM')
    group.child = null
    this.groups.delete(sessionId)
  }

  private sessionActiveForwards(sessionId: string): ColabPortForwardView[] {
    return [...this.forwards.values()].filter(
      (f) => f.sessionId === sessionId && f.state !== 'failed'
    )
  }

  private patchSessionForwards(
    sessionId: string,
    patch: Partial<ColabPortForwardView>
  ): void {
    let changed = false
    for (const fwd of this.forwards.values()) {
      if (fwd.sessionId !== sessionId || fwd.state === 'failed') continue
      Object.assign(fwd, patch)
      changed = true
    }
    if (changed) this.emit()
  }

  private async reconcileSessionGroup(sessionId: string): Promise<void> {
    const active = this.sessionActiveForwards(sessionId)
    if (active.length === 0) {
      this.teardownGroup(sessionId)
      return
    }

    let group = this.groups.get(sessionId)
    if (!group) {
      group = { sessionId, child: null, probeTimer: null, reconnectTimer: null, generation: 0, attempt: 0 }
      this.groups.set(sessionId, group)
    }
    group.generation += 1
    const gen = group.generation
    if (group.probeTimer) clearInterval(group.probeTimer)
    if (group.reconnectTimer) clearTimeout(group.reconnectTimer)
    group.probeTimer = null
    group.reconnectTimer = null
    if (group.child) {
      const prev = group.child
      group.child = null
      await new Promise<void>((resolve) => {
        prev.once('close', () => resolve())
        prev.kill('SIGTERM')
        setTimeout(resolve, 600)
      })
    }
    if (group.generation !== gen) return
    await this.spawnGroupTunnel(group, gen)
  }

  private async spawnGroupTunnel(group: SessionTunnelGroup, gen: number): Promise<void> {
    const active = this.sessionActiveForwards(group.sessionId)
    if (active.length === 0 || group.generation !== gen) return

    const snapshot = await this.service.getSnapshot()
    const session = snapshot.sessions.find((s) => s.id === group.sessionId)
    if (!session || session.phase !== 'running') {
      this.patchSessionForwards(group.sessionId, {
        state: 'failed',
        errorKind: 'session_gone',
        errorMessage: '运行时已停止。'
      })
      return
    }

    const credFile = await this.service.credentials.materializeRuntimeToken(session.connectionId)
    const { paths, env } = await this.service.isolation.prepareConnectionEnvironment(
      session.connectionId,
      credFile
    )
    if (group.generation !== gen) return

    // Guard against `colab ssh --proxy-mode` silently creating a new billed VM.
    const stateText = await readFile(paths.sessionsJsonPath, 'utf8').catch(() => '')
    if (!stateHasRecordedSession(stateText, session.sessionName)) {
      this.patchSessionForwards(group.sessionId, {
        state: 'failed',
        errorKind: 'session_gone',
        errorMessage: '本地会话记录已不存在，已拒绝重连以防误开新计费实例。'
      })
      return
    }

    const args = buildSshTunnelArgs({
      pythonPath: this.service.cli.venvPythonPath,
      sessionsJsonPath: paths.sessionsJsonPath,
      sshKeyPath: paths.sshKeyPath,
      sessionName: session.sessionName,
      forwards: active.map((f) => ({ localPort: f.localPort, remotePort: f.remotePort }))
    })

    const child = spawn('ssh', args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    group.child = child
    const startedAt = Date.now()
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 16_000) stderr += chunk.toString('utf8')
    })

    group.probeTimer = setInterval(() => {
      if (group.generation !== gen) return
      void Promise.all(
        this.sessionActiveForwards(group.sessionId).map(async (fwd) => {
          const listening = await isLocalPortListening(fwd.localPort)
          if (listening && fwd.state !== 'up') {
            fwd.state = 'up'
            fwd.errorKind = undefined
            fwd.errorMessage = undefined
            fwd.reconnectAttempt = undefined
            return true
          }
          return false
        })
      ).then((changes) => {
        if (changes.some(Boolean)) {
          group.attempt = 0
          this.emit()
        }
      })
    }, 600)

    child.once('error', (err) => {
      if (group.generation !== gen) return
      if (group.probeTimer) clearInterval(group.probeTimer)
      group.probeTimer = null
      this.patchSessionForwards(group.sessionId, {
        state: 'failed',
        errorKind: 'ssh_missing',
        errorMessage: `无法启动本机 ssh：${err.message}`
      })
    })

    child.once('close', (code) => {
      if (group.generation !== gen) return
      if (group.probeTimer) clearInterval(group.probeTimer)
      group.probeTimer = null
      group.child = null
      const kind = classifySshTunnelError(stderr, code)
      if (
        kind === 'port_in_use' ||
        kind === 'session_gone' ||
        kind === 'auth_required' ||
        kind === 'ssh_missing' ||
        (kind === 'ssh_busy' && group.attempt >= 4)
      ) {
        const msgMap: Record<ColabPortForwardErrorKind, string> = {
          port_reserved: '8080 为 Colab 保留端口。',
          port_in_use: '本地端口已被占用。',
          ssh_busy: '远端 SSH 通道正被终端或其他转发占用（HTTP 429）。',
          session_gone: '远端会话已结束。',
          auth_required: 'Colab 账号授权已过期，请重新授权。',
          ssh_missing: '未找到本机 ssh 客户端。',
          timeout: '连接超时。',
          other: stderr.trim().slice(-240) || 'SSH 隧道已断开。'
        }
        this.patchSessionForwards(group.sessionId, {
          state: 'failed',
          errorKind: kind,
          errorMessage: msgMap[kind]
        })
        return
      }
      if (Date.now() - startedAt > 15_000) group.attempt = 0
      group.attempt += 1
      if (group.attempt > 6) {
        this.patchSessionForwards(group.sessionId, {
          state: 'failed',
          errorKind: kind ?? 'other',
          errorMessage: stderr.trim().slice(-240) || '端口转发多次重连失败。'
        })
        return
      }
      const delaySec = tunnelBackoffSeconds(group.attempt)
      this.patchSessionForwards(group.sessionId, {
        state: 'reconnecting',
        reconnectAttempt: group.attempt
      })
      group.reconnectTimer = setTimeout(() => {
        if (group.generation === gen) void this.spawnGroupTunnel(group, gen)
      }, delaySec * 1000)
    })
  }

  shutdown(): void {
    this.unsubService()
    for (const sessionId of [...this.groups.keys()]) {
      this.teardownGroup(sessionId)
    }
    this.forwards.clear()
  }
}
