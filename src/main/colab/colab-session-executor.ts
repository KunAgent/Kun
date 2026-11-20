import type { ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join, posix } from 'node:path'
import type {
  ColabSessionArtifact,
  ColabSessionView,
  ColabStartRunRequest
} from '../../shared/colab/colab-types'
import { classifyColabErrorOutput, type ColabCliRuntime } from './colab-cli-runtime'
import type { ColabCredentialStore } from './colab-credential-store'
import { provisionColabHardware } from './colab-hardware-provisioner'
import { colabUploadAccess } from './colab-upload-access'
import { uploadRuntimeFiles } from './runtime-file-upload'
import type { ColabPythonIsolation } from './colab-python-isolation'
import {
  buildExtendVmWatchdogPython,
  buildInstallVmWatchdogPython,
  parseWatchdogOutput
} from './colab-watchdog-guard'
import {
  collectSyncFileList,
  parseTrainingStdoutLine,
  readWorkspaceColabConfig
} from './colab-workspace-sync'

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

const RUNTIME_PROBE_PYTHON = (includeGpu: boolean): string => `import shutil, subprocess
try:
    mt = ma = 0
    with open("/proc/meminfo") as f:
        for ln in f:
            if ln.startswith("MemTotal:"): mt = int(ln.split()[1])
            elif ln.startswith("MemAvailable:"): ma = int(ln.split()[1])
    du = shutil.disk_usage("/content")
    ram_used = max(0.0, (mt - ma) / 1048576.0) if mt else 0.0
    disk_pct = round(du.used * 100.0 / du.total) if du.total else 0
    print(f"KUN_SYS:{ram_used:.1f},{disk_pct}")
except Exception:
    pass
${
  includeGpu
    ? `try:
    out = subprocess.check_output(
        ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
        text=True,
        timeout=5,
    ).strip().splitlines()[0]
    print("KUN_GPU:" + out)
except Exception:
    pass`
    : ''
}
`

const ARTIFACT_LIST_PYTHON = (remoteDir: string): string => `import json, os
root = os.path.join("/content", ${JSON.stringify(remoteDir.replace(/^\/+|\/+$/g, ''))})
items = []
if os.path.isdir(root):
    for name in sorted(os.listdir(root))[:40]:
        full = os.path.join(root, name)
        if os.path.isfile(full):
            items.append({"name": name, "remotePath": os.path.relpath(full, "/"), "sizeBytes": os.path.getsize(full)})
print("KUN_ARTIFACTS:" + json.dumps(items))
`

export type ActiveExecutionHandle = {
  abortController: AbortController
  child: ChildProcess | null
  telemetryTimer: ReturnType<typeof setInterval> | null
  maxRuntimeTimer: ReturnType<typeof setTimeout> | null
}

export class ColabSessionExecutor {
  private readonly handles = new Map<string, ActiveExecutionHandle>()

  constructor(
    private readonly deps: {
      cli: ColabCliRuntime
      credentials: ColabCredentialStore
      isolation: ColabPythonIsolation
      getSession: (sessionId: string) => ColabSessionView | undefined
      patchSession: (sessionId: string, patch: Partial<ColabSessionView>) => void
      appendLog: (sessionId: string, line: string, metricPattern?: string) => void
      onSessionAuthExpired: (connectionId: string) => void
      onSessionFinished: (session: ColabSessionView) => void
    }
  ) {}

  isRunning(sessionId: string): boolean {
    return this.handles.has(sessionId)
  }

  async startSessionRun(session: ColabSessionView, request: ColabStartRunRequest): Promise<void> {
    const controller = new AbortController()
    const handle: ActiveExecutionHandle = {
      abortController: controller,
      child: null,
      telemetryTimer: null,
      maxRuntimeTimer: null
    }
    this.handles.set(session.id, handle)

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
      this.scheduleMaxRuntimeTimer(session.id, handle, request.maxRuntimeHours)

      if (request.terminalOnly) {
        this.deps.patchSession(session.id, {
          phase: 'running',
          provisioningStep: 'start'
        })
        this.deps.appendLog(session.id, `[colab] Runtime '${session.sessionName}' ready.`)
        this.startTelemetryLoop(session.id, paths.sessionsJsonPath, env, handle)
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
        await this.deps.cli.runCommand({
          sessionsJsonPath: paths.sessionsJsonPath,
          args: ['drivemount', '-s', session.sessionName, '/content/drive'],
          env,
          timeoutMs: 180_000,
          signal: controller.signal
        })
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

      // Step 4: Stream training command execution
      this.deps.patchSession(session.id, {
        phase: 'running',
        provisioningStep: 'start'
      })
      this.deps.appendLog(session.id, `$ ${request.entryCommand}`)
      this.startTelemetryLoop(session.id, paths.sessionsJsonPath, env, handle)

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

      // Refresh & auto-download output artifacts
      const artifacts = await this.listRemoteArtifacts(
        session.sessionName,
        request.outputRemoteDir,
        paths.sessionsJsonPath,
        env
      )
      this.deps.patchSession(session.id, { artifacts })
      if (artifacts.length > 0 && request.outputLocalDir.trim()) {
        await this.downloadArtifactsToWorkspace(
          session.sessionName,
          artifacts,
          join(request.workspaceRoot, request.outputLocalDir),
          paths.sessionsJsonPath,
          env
        )
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
        this.deps.patchSession(session.id, {
          phase: 'failed',
          finishedAt: new Date().toISOString(),
          errorKind: 'command_failed',
          errorMessage: `训练命令退出码 ${exitCode}。`
        })
      } else {
        this.deps.patchSession(session.id, {
          phase: 'completed',
          finishedAt: new Date().toISOString()
        })
      }

      if (request.autoStop) {
        await this.deps.cli.runCommand({
          sessionsJsonPath: paths.sessionsJsonPath,
          args: ['stop', '-s', session.sessionName],
          env,
          timeoutMs: 30_000
        })
        this.deps.appendLog(session.id, `[colab] 已自动停机（${session.sessionName}）。`)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const msg = error instanceof Error ? error.message : String(error)
        this.deps.patchSession(session.id, {
          phase: 'failed',
          finishedAt: new Date().toISOString(),
          errorKind: classifyColabErrorOutput(msg),
          errorMessage: msg
        })
        if (request.autoStop) {
          await this.bestEffortRemoteStop(session.connectionId, session.sessionName)
        }
      }
    } finally {
      this.cleanupHandle(session.id)
      const latest = this.deps.getSession(session.id)
      if (latest) this.deps.onSessionFinished(latest)
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

  private startTelemetryLoop(
    sessionId: string,
    sessionsJsonPath: string,
    env: Record<string, string>,
    handle: ActiveExecutionHandle
  ): void {
    const poll = async (): Promise<void> => {
      const current = this.deps.getSession(sessionId)
      if (!current || current.phase !== 'running') return
      const res = await this.deps.cli.runCommand({
        sessionsJsonPath,
        args: ['exec', '-s', current.sessionName, '--timeout', '10'],
        env,
        stdinText: RUNTIME_PROBE_PYTHON(current.accelerator !== 'CPU'),
        timeoutMs: 15_000
      })
      const lines = res.stdout.split(/\r?\n/)
      const patch: Partial<ColabSessionView> = {}
      const sysLine = lines.find((l) => l.startsWith('KUN_SYS:'))
      if (sysLine) {
        const [ramRaw, diskRaw] = sysLine.slice('KUN_SYS:'.length).split(',')
        const ramUsed = Number(ramRaw?.trim())
        const diskPct = Number(diskRaw?.trim())
        if (Number.isFinite(ramUsed)) patch.ramUsedGb = Number(ramUsed.toFixed(1))
        if (Number.isFinite(diskPct)) patch.diskUsedPct = Math.round(diskPct)
      }
      const gpuLine = lines.find((l) => l.startsWith('KUN_GPU:'))
      if (gpuLine) {
        const [utilRaw, usedMbRaw] = gpuLine.slice('KUN_GPU:'.length).split(',')
        const util = Number(utilRaw?.trim())
        const usedGb = Number(usedMbRaw?.trim()) / 1024
        if (Number.isFinite(util)) {
          patch.gpuUtilizationPct = Math.round(util)
          patch.vramUsedGb = Number.isFinite(usedGb) ? Number(usedGb.toFixed(1)) : current.vramUsedGb
          patch.gpuHistory = [...current.gpuHistory, util].slice(-24)
        }
      }
      if (Object.keys(patch).length > 0) this.deps.patchSession(sessionId, patch)
      if (current.outputRemoteDir.trim()) {
        const artifacts = await this.listRemoteArtifacts(
          current.sessionName,
          current.outputRemoteDir,
          sessionsJsonPath,
          env
        )
        if (artifacts.length > 0) {
          this.deps.patchSession(sessionId, { artifacts })
        }
      }
    }
    void poll()
    handle.telemetryTimer = setInterval(() => {
      void poll()
    }, 20_000)
  }

  async listRemoteArtifacts(
    sessionName: string,
    outputRemoteDir: string,
    sessionsJsonPath: string,
    env: Record<string, string>
  ): Promise<ColabSessionArtifact[]> {
    const res = await this.deps.cli.runCommand({
      sessionsJsonPath,
      args: ['exec', '-s', sessionName, '--timeout', '10'],
      env,
      stdinText: ARTIFACT_LIST_PYTHON(outputRemoteDir),
      timeoutMs: 15_000
    })
    const line = res.stdout.split(/\r?\n/).find((l) => l.startsWith('KUN_ARTIFACTS:'))
    if (!line) return []
    try {
      return JSON.parse(line.slice('KUN_ARTIFACTS:'.length)) as ColabSessionArtifact[]
    } catch {
      return []
    }
  }

  async downloadArtifactsToWorkspace(
    sessionName: string,
    artifacts: readonly ColabSessionArtifact[],
    localDir: string,
    sessionsJsonPath: string,
    env: Record<string, string>
  ): Promise<void> {
    await mkdir(localDir, { recursive: true })
    for (const item of artifacts) {
      await this.deps.cli.runCommand({
        sessionsJsonPath,
        args: ['download', '-s', sessionName, item.remotePath, join(localDir, item.name)],
        env,
        timeoutMs: 180_000
      })
    }
  }

  async stopSession(sessionId: string, remoteStop = true): Promise<void> {
    const session = this.deps.getSession(sessionId)
    const handle = this.handles.get(sessionId)
    if (handle) {
      handle.abortController.abort()
      handle.child?.kill('SIGTERM')
      this.cleanupHandle(sessionId)
    }
    if (session) {
      if (remoteStop) {
        await this.bestEffortRemoteStop(session.connectionId, session.sessionName)
      }
      this.deps.patchSession(sessionId, {
        phase: 'stopped',
        finishedAt: new Date().toISOString()
      })
    }
  }

  async bestEffortRemoteStop(connectionId: string, sessionName: string): Promise<void> {
    try {
      const credFile = await this.deps.credentials.materializeRuntimeToken(connectionId)
      const { paths, env } = await this.deps.isolation.prepareConnectionEnvironment(
        connectionId,
        credFile
      )
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
    if (handle.telemetryTimer) clearInterval(handle.telemetryTimer)
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
