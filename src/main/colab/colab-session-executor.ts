import type { ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join, posix, resolve, sep } from 'node:path'
import {
  type ColabSessionArtifact,
  type ColabSessionView,
  type ColabStartRunRequest
} from '../../shared/colab/colab-types'
import { classifyColabErrorOutput, type ColabCliRuntime } from './colab-cli-runtime'
import type { ColabCredentialStore } from './colab-credential-store'
import {
  buildArtifactListPython,
  isGoogleDriveRemotePath,
  parseArtifactListOutput,
  resolveColabRemoteDir,
  runSessionDriveFlushHelper,
  runSessionDriveMountHelper
} from './colab-drive-protocol'
import { provisionColabHardware } from './colab-hardware-provisioner'
import { colabUploadAccess } from './colab-upload-access'
import { uploadRuntimeFiles, type UploadAccess } from './runtime-file-upload'
import type { ColabPythonIsolation } from './colab-python-isolation'
import {
  buildExtendVmWatchdogPython,
  buildInstallVmWatchdogPython,
  parseWatchdogOutput
} from './colab-watchdog-guard'
import {
  collectSyncFileList,
  parseTrainingStdoutLine,
  readWorkspaceColabConfig,
  resolveWorkspaceOutputLocalDir
} from './colab-workspace-sync'
import { ColabResourceMonitor, startExclusivePoll } from './colab-session-telemetry'
import { listLiveArtifacts } from './colab-runtime-metadata'

function buildRemoteShellRunnerPython(
  command: string,
  envVars: Record<string, string> | undefined,
  setupScript: string | undefined
): string {
  const payload = JSON.stringify({
    command,
    env: envVars ?? {},
    setup: setupScript?.trim() || ''
  })
  return `import json, os, subprocess, sys
cfg = json.loads(${JSON.stringify(payload)})
os.makedirs("/content", exist_ok=True)
os.chdir("/content")
env = dict(os.environ)
for k, v in cfg["env"].items():
    env[str(k)] = str(v)
env["PYTHONUNBUFFERED"] = "1"
if cfg["setup"]:
    rc = subprocess.call(cfg["setup"], shell=True, env=env)
    if rc != 0:
        sys.exit(rc)
proc = subprocess.Popen(
    cfg["command"],
    shell=True,
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1,
)
for line in proc.stdout:
    sys.stdout.write(line)
    sys.stdout.flush()
sys.exit(proc.wait())
`
}

export type ActiveExecutionHandle = {
  abortController: AbortController
  child: ChildProcess | null
  maxRuntimeTimer: ReturnType<typeof setTimeout> | null
}

export class ColabSessionExecutor {
  private readonly handles = new Map<string, ActiveExecutionHandle>()

  private readonly resources: ColabResourceMonitor

  constructor(
    private readonly deps: {
      cli: ColabCliRuntime
      credentials: ColabCredentialStore
      isolation: ColabPythonIsolation
      openExternal?: (url: string) => Promise<void>
      getSession: (sessionId: string) => ColabSessionView | undefined
      patchSession: (sessionId: string, patch: Partial<ColabSessionView>) => void
      appendLog: (sessionId: string, line: string, metricPattern?: string) => void
      onSessionAuthExpired: (connectionId: string) => void
      onSessionFinished: (session: ColabSessionView) => void
    }
  ) {
    this.resources = new ColabResourceMonitor(deps.getSession, deps.patchSession)
  }

  isRunning(sessionId: string): boolean {
    return this.handles.has(sessionId)
  }

  async startSessionRun(session: ColabSessionView, request: ColabStartRunRequest): Promise<void> {
    const controller = new AbortController()
    const handle: ActiveExecutionHandle = {
      abortController: controller,
      child: null,
      maxRuntimeTimer: null
    }
    this.handles.set(session.id, handle)

    let keepTerminalHandle = false
    const savedConfig = await readWorkspaceColabConfig(request.workspaceRoot)
    const metricPattern = savedConfig?.metricPattern

    try {
      const credFile = await this.deps.credentials.materializeRuntimeToken(session.connectionId)
      const { paths, env } = await this.deps.isolation.prepareConnectionEnvironment(
        session.connectionId,
        credFile
      )

      // Step 1: Provision session (`colab new` with optional `--high-mem` & min VRAM targeting)
      const provRes = await provisionColabHardware({
        baseSessionName: session.sessionName,
        accelerator: session.accelerator,
        highMem: request.highMem,
        minVramGb: request.minVramGb,
        maxAttempts: request.maxProvisionAttempts,
        onExhausted: request.onProvisionExhausted,
        sessionsJsonPath: paths.sessionsJsonPath,
        env,
        runCli: (p) => this.deps.cli.runCommand(p),
        upgradeCli: async () => (await this.deps.cli.ensureInstalled({ upgrade: true })).state === 'ready',
        syncTokenBack: () => this.deps.credentials.syncRuntimeTokenBack(session.connectionId),
        onAttempt: (attempt, maxAttempts, sessionName) => {
          session.sessionName = sessionName
          this.deps.patchSession(session.id, {
            phase: 'provisioning',
            provisioningStep: 'assign',
            provisioningAttempt: attempt,
            provisioningMaxAttempts: maxAttempts,
            sessionName
          })
        },
        onLog: (msg) => this.deps.appendLog(session.id, msg),
        signal: controller.signal
      })
      if (!provRes.ok) {
        if (provRes.aborted) return
        if (provRes.errorKind === 'auth_expired') {
          this.deps.onSessionAuthExpired(session.connectionId)
        }
        this.deps.patchSession(session.id, {
          phase: 'failed',
          finishedAt: new Date().toISOString(),
          errorKind: provRes.errorKind,
          errorMessage: provRes.errorMessage
        })
        return
      }
      session.sessionName = provRes.sessionName
      if (provRes.ramGb !== null || provRes.vramGb !== null) {
        this.deps.patchSession(session.id, {
          ...(provRes.ramGb !== null ? { ramGb: provRes.ramGb } : {}),
          ...(provRes.vramGb !== null ? { vramGb: provRes.vramGb } : {})
        })
      }

      await this.installVmWatchdog(
        session.id,
        session.sessionName,
        request,
        paths.sessionsJsonPath,
        env
      )
      if (controller.signal.aborted) return
      this.scheduleMaxRuntimeTimer(session.id, handle, request.maxRuntimeHours)

      if (request.terminalOnly) {
        this.deps.patchSession(session.id, {
          phase: 'running',
          provisioningStep: 'start'
        })
        this.deps.appendLog(session.id, `[colab] Runtime '${session.sessionName}' ready.`)
        this.startRunMonitoring(session, paths.sessionsJsonPath, env, handle)
        keepTerminalHandle = true
        return
      }

      // Step 2: Sync workspace files
      const syncFiles = await collectSyncFileList(request.workspaceRoot, request.syncPaths)
      const totalBytes = syncFiles.reduce((acc, f) => acc + f.sizeBytes, 0)
      this.deps.patchSession(session.id, {
        phase: 'uploading',
        provisioningStep: 'upload',
        uploadTotalBytes: totalBytes,
        uploadTransferredBytes: 0
      })

      const syncStarted = Date.now()
      let prefix = 0
      const files = syncFiles.map((file) => {
        const start = prefix
        prefix += file.sizeBytes
        return { localPath: file.absPath, remotePath: posix.join('content', file.remoteRelPath), start }
      })
      const access = colabUploadAccess({ pythonPath: this.deps.cli.venvPythonPath,
        sessionsJsonPath: paths.sessionsJsonPath, sessionName: session.sessionName, env })
      const synced = await uploadRuntimeFiles(files, access, {
        signal: controller.signal,
        onProgress: ({ fileIndex, transferredBytes }) => this.deps.patchSession(session.id, {
          uploadTransferredBytes: files[fileIndex - 1].start + transferredBytes
        })
      })
      if (!synced.ok) {
        if (synced.canceled) return
        throw new Error(synced.message)
      }
      if (syncFiles.length > 0) {
        const elapsedSec = Math.max(1, Math.round((Date.now() - syncStarted) / 1000))
        const mb = (totalBytes / (1024 * 1024)).toFixed(1)
        this.deps.appendLog(
          session.id,
          `[sync] uploaded ${syncFiles.length} files (${mb} MB) in ${elapsedSec}s`
        )
      }

      // Step 3: Install requirements & optional Drive mount
      this.deps.patchSession(session.id, {
        phase: 'installing',
        provisioningStep: 'install'
      })
      if (request.mountDrive) {
        const mounted = await runSessionDriveMountHelper({
          pythonPath: this.deps.cli.venvPythonPath,
          sessionsJsonPath: paths.sessionsJsonPath,
          sessionName: session.sessionName,
          env,
          expectedEmail: session.connectionEmail,
          signal: controller.signal,
          openExternal: this.deps.openExternal,
          onLog: (line) => this.deps.appendLog(session.id, line)
        })
        await this.deps.credentials.syncRuntimeTokenBack(session.connectionId)
        if (!mounted.ok) {
          if (controller.signal.aborted) return
          throw new Error(mounted.message)
        }
        this.deps.appendLog(session.id, `[colab] Google Drive mounted at ${mounted.mountPath}.`)
      }
      const hasRequirements = syncFiles.some((f) => f.remoteRelPath === 'requirements.txt')
      if (hasRequirements) {
        this.deps.appendLog(session.id, '$ colab install -r requirements.txt')
        const instRes = await this.deps.cli.runCommand({
          sessionsJsonPath: paths.sessionsJsonPath,
          args: ['install', '-s', session.sessionName, '-r', join(request.workspaceRoot, 'requirements.txt')],
          env,
          timeoutMs: 600_000,
          signal: controller.signal
        })
        if (instRes.exitCode !== 0) {
          throw new Error(`安装 requirements.txt 失败：${instRes.stderr || instRes.stdout}`)
        }
      }

      if (controller.signal.aborted) return
      // Step 4: Stream training command execution
      this.deps.patchSession(session.id, {
        phase: 'running',
        provisioningStep: 'start'
      })
      this.deps.appendLog(session.id, `$ ${request.entryCommand}`)
      this.startRunMonitoring(session, paths.sessionsJsonPath, env, handle)

      const runnerPy = buildRemoteShellRunnerPython(
        request.entryCommand,
        request.envVars,
        request.setupScript
      )
      const child = this.deps.cli.spawnStreamingCommand({
        sessionsJsonPath: paths.sessionsJsonPath,
        args: ['exec', '-s', session.sessionName, '--timeout', '0'],
        env,
        stdinText: runnerPy
      })
      handle.child = child

      let lineBuf = ''
      const onChunk = (chunk: Buffer): void => {
        lineBuf += chunk.toString('utf8')
        const parts = lineBuf.split(/\r?\n|\r/)
        lineBuf = parts.pop() ?? ''
        for (const line of parts) {
          if (line.trim()) this.deps.appendLog(session.id, line, metricPattern)
        }
      }
      child.stdout?.on('data', onChunk)
      child.stderr?.on('data', onChunk)

      const exitCode = await new Promise<number>((resolve) => {
        child.once('close', (code) => resolve(code ?? 1))
        child.once('error', () => resolve(1))
      })
      if (lineBuf.trim()) this.deps.appendLog(session.id, lineBuf, metricPattern)
      await this.deps.credentials.syncRuntimeTokenBack(session.connectionId)

      if (controller.signal.aborted) return

      // Refresh & auto-download output artifacts (skip bulk local download only when truly persisted on mounted Drive)
      const scan = await this.scanRemoteArtifacts(
        session.sessionName,
        request.outputRemoteDir,
        paths.sessionsJsonPath,
        env
      )
      this.deps.patchSession(session.id, { artifacts: scan.items })
      const persistedOnDrive =
        (isGoogleDriveRemotePath(request.outputRemoteDir) && scan.driveMounted) || scan.rootMounted
      if (persistedOnDrive) {
        this.deps.appendLog(
          session.id,
          `[colab] Checkpoints & outputs saved in Google Drive: ${resolveColabRemoteDir(request.outputRemoteDir)}`
        )
      } else {
        if (isGoogleDriveRemotePath(request.outputRemoteDir) && !scan.driveMounted) {
          this.deps.appendLog(
            session.id,
            `[colab] Warning: ${resolveColabRemoteDir(request.outputRemoteDir)} is not mounted to Google Drive; downloading outputs locally before shutdown.`
          )
        }
        if (scan.items.length > 0 && request.outputLocalDir.trim()) {
          await this.downloadArtifactsToWorkspace(
            session.sessionName,
            scan.items,
            resolveWorkspaceOutputLocalDir(request.workspaceRoot, request.outputLocalDir),
            paths.sessionsJsonPath,
            env
          )
        }
      }

      if (exitCode !== 0) {
        const isDisconnect = lineBuf.toLowerCase().includes('websocket') || exitCode === 255
        if (isDisconnect && !request.autoStop) {
          this.deps.patchSession(session.id, {
            phase: 'disconnected',
            errorKind: 'disconnected_billing',
            errorMessage: '与远端会话的连接已中断，远端可能仍在计费。'
          })
          return
        }
      }

      if (request.autoStop) {
        await this.flushMountedDriveBestEffort(session.sessionName, paths.sessionsJsonPath, env, session.id)
        await this.deps.cli.runCommand({
          sessionsJsonPath: paths.sessionsJsonPath,
          args: ['stop', '-s', session.sessionName],
          env,
          timeoutMs: 30_000
        })
        this.deps.appendLog(session.id, `[colab] 已自动停机（${session.sessionName}）。`)
      }

      this.deps.patchSession(
        session.id,
        exitCode !== 0
          ? {
              phase: 'failed',
              finishedAt: new Date().toISOString(),
              errorKind: 'command_failed',
              errorMessage: `训练命令退出码 ${exitCode}。`
            }
          : {
              phase: 'completed',
              finishedAt: new Date().toISOString()
            }
      )
    } catch (error) {
      if (!controller.signal.aborted) {
        const msg = error instanceof Error ? error.message : String(error)
        if (request.autoStop) {
          await this.bestEffortRemoteStop(session.connectionId, session.sessionName, session.id)
        }
        this.deps.patchSession(session.id, {
          phase: 'failed',
          finishedAt: new Date().toISOString(),
          errorKind: classifyColabErrorOutput(msg),
          errorMessage: msg
        })
      }
    } finally {
      if (!keepTerminalHandle && this.handles.get(session.id) === handle) {
        this.resources.stop(session.id)
        this.cleanupHandle(session.id)
        const latest = this.deps.getSession(session.id)
        if (latest) this.deps.onSessionFinished(latest)
      }
    }
  }

  private scheduleMaxRuntimeTimer(
    sessionId: string,
    handle: ActiveExecutionHandle,
    maxRuntimeHours: number
  ): void {
    if (handle.maxRuntimeTimer) {
      clearTimeout(handle.maxRuntimeTimer)
      handle.maxRuntimeTimer = null
    }
    if (maxRuntimeHours <= 0) return
    const current = this.deps.getSession(sessionId)
    const elapsedMs = (current?.elapsedSeconds ?? 0) * 1000
    const remainingMs = Math.max(1_000, maxRuntimeHours * 3_600_000 - elapsedMs)
    handle.maxRuntimeTimer = setTimeout(() => {
      this.deps.appendLog(
        sessionId,
        `[colab] 已达到最长运行时长 ${maxRuntimeHours} 小时，正在自动停机…`
      )
      void this.stopSession(sessionId, true)
    }, remainingMs)
  }

  private async installVmWatchdog(
    sessionId: string,
    sessionName: string,
    request: ColabStartRunRequest,
    sessionsJsonPath: string,
    env: Record<string, string>
  ): Promise<void> {
    const maxSec = request.maxRuntimeHours > 0 ? Math.round(request.maxRuntimeHours * 3600) : null
    const idleSec =
      request.idleAutoStopMinutes && request.idleAutoStopMinutes > 0
        ? Math.round(request.idleAutoStopMinutes * 60)
        : null
    if (!maxSec && !idleSec) return
    const fallbackAutoStopAt = maxSec ? new Date(Date.now() + maxSec * 1000).toISOString() : null
    try {
      const res = await this.deps.cli.runCommand({
        sessionsJsonPath,
        args: ['exec', '-s', sessionName, '--timeout', '15'],
        env,
        stdinText: buildInstallVmWatchdogPython({
          maxRuntimeSeconds: maxSec,
          idleTimeoutSeconds: idleSec
        }),
        timeoutMs: 20_000
      })
      const parsed = parseWatchdogOutput(res.stdout)
      this.deps.patchSession(sessionId, {
        watchdogActive: parsed.ok,
        autoStopAt: parsed.autoStopAt ?? fallbackAutoStopAt
      })
    } catch {
      this.deps.patchSession(sessionId, {
        watchdogActive: false,
        autoStopAt: fallbackAutoStopAt
      })
    }
  }

  async extendSession(sessionId: string, addMinutes: number): Promise<boolean> {
    const session = this.deps.getSession(sessionId)
    if (!session || session.phase !== 'running') return false
    const clampedMinutes = Math.max(5, Math.min(720, Math.round(addMinutes)))
    const baseRemainingSec =
      session.maxRuntimeHours > 0
        ? Math.max(0, session.maxRuntimeHours * 3600 - session.elapsedSeconds)
        : 0
    const nextTotalSec = session.elapsedSeconds + baseRemainingSec + clampedMinutes * 60
    const nextMaxHours = Number((nextTotalSec / 3600).toFixed(2))
    const nextAutoStopAt = new Date(
      Date.now() + (baseRemainingSec + clampedMinutes * 60) * 1000
    ).toISOString()

    let watchdogActive = session.watchdogActive ?? false
    try {
      const credFile = await this.deps.credentials.materializeRuntimeToken(session.connectionId)
      const { paths, env } = await this.deps.isolation.prepareConnectionEnvironment(
        session.connectionId,
        credFile
      )
      const res = await this.deps.cli.runCommand({
        sessionsJsonPath: paths.sessionsJsonPath,
        args: ['exec', '-s', session.sessionName, '--timeout', '15'],
        env,
        stdinText: buildExtendVmWatchdogPython((baseRemainingSec + clampedMinutes * 60)),
        timeoutMs: 20_000
      })
      const parsed = parseWatchdogOutput(res.stdout)
      if (parsed.ok) watchdogActive = true
    } catch {
      // App-side timer still enforces the extended deadline.
    }

    this.deps.patchSession(sessionId, {
      maxRuntimeHours: nextMaxHours,
      autoStopAt: nextAutoStopAt,
      watchdogActive,
      guardWarnings: (session.guardWarnings ?? []).filter((w) => w !== 'runtime_nearing')
    })
    const handle = this.handles.get(sessionId)
    if (handle) {
      this.scheduleMaxRuntimeTimer(sessionId, handle, nextMaxHours)
    }
    return true
  }

  private startRunMonitoring(session: ColabSessionView, sessionsJsonPath: string,
    env: Record<string, string>, handle: ActiveExecutionHandle): void {
    const access = colabUploadAccess({ pythonPath: this.deps.cli.venvPythonPath,
      sessionsJsonPath, env, sessionName: session.sessionName })
    if (handle.abortController.signal.aborted) return
    this.resources.start(session.id, access)
    if (!session.outputRemoteDir.trim()) return
    startExclusivePoll(20_000, handle.abortController.signal, async () => {
      const signal = AbortSignal.any([handle.abortController.signal, AbortSignal.timeout(15_000)])
      const artifacts = await listLiveArtifacts(access, session.outputRemoteDir, signal)
      if (!signal.aborted && this.deps.getSession(session.id)?.phase === 'running' && artifacts.length) {
        this.deps.patchSession(session.id, { artifacts })
      }
    }, false)
  }

  resumeResourceMonitoring(session: ColabSessionView): void {
    let access: UploadAccess | undefined
    this.resources.start(session.id, async (signal) => {
      if (!access) {
        const token = await this.deps.credentials.materializeRuntimeToken(session.connectionId)
        signal.throwIfAborted()
        const { paths, env } = await this.deps.isolation.prepareConnectionEnvironment(session.connectionId, token)
        signal.throwIfAborted()
        access = colabUploadAccess({ pythonPath: this.deps.cli.venvPythonPath,
          sessionsJsonPath: paths.sessionsJsonPath, env, sessionName: session.sessionName, endpoint: session.endpoint })
      }
      return access(signal)
    })
  }

  stopMonitoring(): void {
    this.resources.stopAll()
  }

  private async scanRemoteArtifacts(
    sessionName: string,
    outputRemoteDir: string,
    sessionsJsonPath: string,
    env: Record<string, string>
  ): Promise<{ items: ColabSessionArtifact[]; driveMounted: boolean; rootMounted: boolean }> {
    const res = await this.deps.cli.runCommand({
      sessionsJsonPath,
      args: ['exec', '-s', sessionName, '--timeout', '10'],
      env,
      stdinText: buildArtifactListPython(outputRemoteDir),
      timeoutMs: 15_000
    })
    return parseArtifactListOutput<ColabSessionArtifact>(res.stdout)
  }

  async downloadArtifactsToWorkspace(
    sessionName: string,
    artifacts: readonly ColabSessionArtifact[],
    localDir: string,
    sessionsJsonPath: string,
    env: Record<string, string>
  ): Promise<void> {
    const baseDir = resolve(localDir)
    await mkdir(baseDir, { recursive: true })
    for (const item of artifacts) {
      const dest = resolve(baseDir, item.name)
      if (dest === baseDir || !dest.startsWith(baseDir + sep)) continue
      const remoteRel = item.remotePath.trim().replaceAll('\\', '/').replace(/^\/+/, '')
      if (!remoteRel || remoteRel.split('/').some((seg) => seg === '..')) continue
      await mkdir(dirname(dest), { recursive: true })
      await this.deps.cli.runCommand({
        sessionsJsonPath,
        args: ['download', '-s', sessionName, remoteRel, dest],
        env,
        timeoutMs: 180_000
      })
    }
  }

  private async flushMountedDriveBestEffort(
    sessionName: string,
    sessionsJsonPath: string,
    env: Record<string, string>,
    sessionId?: string
  ): Promise<void> {
    try {
      const flushed = await runSessionDriveFlushHelper({
        pythonPath: this.deps.cli.venvPythonPath,
        sessionsJsonPath,
        sessionName,
        env
      })
      if (flushed && sessionId) {
        this.deps.appendLog(sessionId, '[colab] Flushed Google Drive (/content/drive) before stopping.')
      }
    } catch {
      // Never block VM shutdown if the runtime is already unreachable.
    }
  }

  async stopSession(sessionId: string, remoteStop = true): Promise<void> {
    this.resources.stop(sessionId)
    const session = this.deps.getSession(sessionId)
    const handle = this.handles.get(sessionId)
    if (handle) {
      handle.child?.kill('SIGTERM')
      this.cleanupHandle(sessionId)
    }
    if (session) {
      if (remoteStop) {
        await this.bestEffortRemoteStop(session.connectionId, session.sessionName, session.id)
      }
      this.resources.stop(sessionId)
      this.deps.patchSession(sessionId, {
        phase: 'stopped',
        finishedAt: new Date().toISOString()
      })
      if (handle) this.deps.onSessionFinished(session)
    }
  }

  async bestEffortRemoteStop(
    connectionId: string,
    sessionName: string,
    sessionId?: string
  ): Promise<void> {
    try {
      const credFile = await this.deps.credentials.materializeRuntimeToken(connectionId)
      const { paths, env } = await this.deps.isolation.prepareConnectionEnvironment(
        connectionId,
        credFile
      )
      await this.flushMountedDriveBestEffort(sessionName, paths.sessionsJsonPath, env, sessionId)
      await this.deps.cli.runCommand({
        sessionsJsonPath: paths.sessionsJsonPath,
        args: ['stop', '-s', sessionName],
        env,
        timeoutMs: 30_000
      })
      await this.deps.credentials.syncRuntimeTokenBack(connectionId)
    } catch {
      // Ignore best-effort cleanup errors.
    }
  }

  private cleanupHandle(sessionId: string): void {
    const handle = this.handles.get(sessionId)
    if (!handle) return
    handle.abortController.abort()
    if (handle.maxRuntimeTimer) clearTimeout(handle.maxRuntimeTimer)
    this.handles.delete(sessionId)
  }

  static applyLogAndMetrics(
    session: ColabSessionView,
    line: string,
    metricPattern?: string
  ): Partial<ColabSessionView> {
    const parsed = parseTrainingStdoutLine(line, session.metrics, metricPattern)
    return {
      logTail: [...session.logTail, line].slice(-250),
      ...(parsed.updatedMetrics ? { metrics: parsed.updatedMetrics } : {}),
      ...(parsed.progressSummary ? { progressSummary: parsed.progressSummary } : {})
    }
  }
}
