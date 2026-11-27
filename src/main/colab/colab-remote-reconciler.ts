import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join, posix } from 'node:path'
import type { KunColabSettingsV1 } from '../../shared/app-settings-colab'
import type { RuntimeUploadResult } from '../../shared/colab/runtime-upload'
import { runSessionDriveProbeHelper } from './colab-drive-protocol'
import { colabUploadAccess } from './colab-upload-access'
import { uploadRuntimeFiles, type UploadOptions } from './runtime-file-upload'
import { activeDrivePullSessions } from './colab-drive-notebooks'
import type { ColabSessionView, ColabUntrackedSession } from '../../shared/colab/colab-types'
import {
  buildColabCcuInfoPython,
  classifyColabErrorOutput,
  type ColabCliRuntime,
  type ParsedColabUsage,
  parseColabCcuInfoOutput,
  parseColabSessionsOutput,
  parseColabUsageOutput
} from './colab-cli-runtime'
import type { ColabCredentialStore } from './colab-credential-store'
import type { ColabPythonIsolation } from './colab-python-isolation'
import type { ColabSessionExecutor } from './colab-session-executor'
import type { PersistedConnectionRecord } from './colab-state-store'
import { resolveWorkspaceOutputLocalDir } from './colab-workspace-sync'

export function deriveColabPlanLabel(parsed: ParsedColabUsage): string {
  const tier = parsed.subscriptionTier ?? ''
  if (/ultra/i.test(tier) || parsed.eligibleAccelerators?.includes('H100')) {
    return 'Google AI Ultra'
  }
  if (
    /pro_plus|pro\+/i.test(tier) ||
    parsed.balanceCu >= 300 ||
    parsed.eligibleAccelerators?.includes('G4')
  ) {
    return 'Colab Pro+'
  }
  if (
    /\bpro\b/i.test(tier) ||
    parsed.balanceCu > 0 ||
    parsed.eligibleAccelerators?.some((acc) => acc === 'A100' || acc === 'L4' || acc === 'V6E1')
  ) {
    return 'Colab Pro'
  }
  return 'Colab'
}

export async function pollColabBalancesAndRemoteSessions(options: {
  targets: PersistedConnectionRecord[]
  cli: ColabCliRuntime
  credentials: ColabCredentialStore
  isolation: ColabPythonIsolation
  sessions: Iterable<ColabSessionView>
  ignoredUntrackedKeys: ReadonlySet<string>
  settings: KunColabSettingsV1
  lowBalanceNotifiedIds: Set<string>
  onLowBalanceNotice?: (connectionName: string, balanceCu: number) => void
}): Promise<ColabUntrackedSession[]> {
  const discoveredUntracked: ColabUntrackedSession[] = []
  const trackedList = [...options.sessions]

  for (const conn of options.targets) {
    try {
      const credFile = await options.credentials.materializeRuntimeToken(conn.id)
      const { paths, env } = await options.isolation.prepareConnectionEnvironment(conn.id, credFile)

      let parsed: ParsedColabUsage | null = null
      if (typeof options.cli.runPythonScript === 'function') {
        const ccuRes = await options.cli.runPythonScript({
          script: buildColabCcuInfoPython(paths.sessionsJsonPath),
          env,
          timeoutMs: 20_000
        })
        await options.credentials.syncRuntimeTokenBack(conn.id)
        if (ccuRes.exitCode === 0) {
          parsed = parseColabCcuInfoOutput(ccuRes.stdout)
        } else if (classifyColabErrorOutput(`${ccuRes.stdout}\n${ccuRes.stderr}`) === 'auth_expired') {
          conn.status = 'expired'
          continue
        }
      }

      if (!parsed) {
        const usageRes = await options.cli.runCommand({
          sessionsJsonPath: paths.sessionsJsonPath,
          args: ['usage'],
          env,
          timeoutMs: 20_000
        })
        await options.credentials.syncRuntimeTokenBack(conn.id)

        if (usageRes.exitCode !== 0) {
          if (classifyColabErrorOutput(`${usageRes.stdout}\n${usageRes.stderr}`) === 'auth_expired') {
            conn.status = 'expired'
          }
          continue
        }
        parsed = parseColabUsageOutput(usageRes.stdout)
      }

      if (parsed) {
        conn.balanceCu = Number(parsed.balanceCu.toFixed(1))
        conn.burnRateCuPerHour = Number(parsed.burnRateCuPerHour.toFixed(2))
        if (parsed.eligibleAccelerators) {
          conn.eligibleAccelerators = parsed.eligibleAccelerators
          conn.ineligibleAccelerators = parsed.ineligibleAccelerators ?? []
        }
        conn.planLabel = deriveColabPlanLabel(parsed)
        conn.updatedAt = new Date().toISOString()

        if (
          options.settings.lowBalanceReminderEnabled &&
          conn.balanceCu > 0 &&
          conn.balanceCu < options.settings.lowBalanceThresholdCu &&
          !options.lowBalanceNotifiedIds.has(conn.id)
        ) {
          options.lowBalanceNotifiedIds.add(conn.id)
          options.onLowBalanceNotice?.(conn.name, conn.balanceCu)
        } else if (conn.balanceCu >= options.settings.lowBalanceThresholdCu) {
          options.lowBalanceNotifiedIds.delete(conn.id)
        }
      }

      const sessRes = await options.cli.runCommand({
        sessionsJsonPath: paths.sessionsJsonPath,
        args: ['sessions'],
        env,
        timeoutMs: 20_000
      })
      if (sessRes.exitCode === 0) {
        const remoteList = parseColabSessionsOutput(sessRes.stdout)
        for (const item of remoteList) {
          const key = `${conn.id}:${item.endpoint}`
          const tracked = trackedList.some(
            (s) =>
              s.connectionId === conn.id &&
              (s.sessionName === item.name || s.endpoint === item.endpoint)
          )
          if (!tracked && !activeDrivePullSessions.has(item.name) && !options.ignoredUntrackedKeys.has(key)) {
            discoveredUntracked.push({
              connectionId: conn.id,
              connectionName: conn.name,
              connectionEmail: conn.email,
              endpoint: item.endpoint,
              remoteLabel: item.untracked ? `colab-${item.endpoint.slice(-4)}` : item.name,
              accelerator: item.accelerator,
              ...(item.highMem ? { highMem: true } : {}),
              variant: item.variant,
              detectedAt: new Date().toISOString()
            })
          }
        }
      }
    } catch {
      continue
    }
  }

  return discoveredUntracked
}

export async function stopRemoteUntrackedEndpoint(options: {
  connectionId: string
  endpoint: string
  cli: ColabCliRuntime
  credentials: ColabCredentialStore
  isolation: ColabPythonIsolation
}): Promise<{ ok: boolean; message?: string }> {
  try {
    const credFile = await options.credentials.materializeRuntimeToken(options.connectionId)
    const { paths, env } = await options.isolation.prepareConnectionEnvironment(
      options.connectionId,
      credFile
    )
    const py = `from colab_cli.common import state\nstate.client.unassign(${JSON.stringify(options.endpoint)})\n`
    const tempScript = join(paths.colabConfigDir, 'unassign_orphan.py')
    await writeFile(tempScript, py, { mode: 0o600 })
    await new Promise<void>((resolve) => {
      const child = spawn(options.cli.venvPythonPath, [tempScript], { env })
      child.once('close', () => resolve())
      child.once('error', () => resolve())
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function normalizeColabUploadTargetDir(targetRemoteDir?: string): string {
  const cleaned = (targetRemoteDir ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (!cleaned) return 'content'
  if (
    cleaned.includes('\\') ||
    [...cleaned].some((ch) => ch.charCodeAt(0) < 32) ||
    cleaned.split('/').some((seg) => !seg || seg === '.' || seg === '..') ||
    (cleaned !== 'content' && !cleaned.startsWith('content/'))
  ) {
    throw new Error('Invalid Colab upload destination directory.')
  }
  return cleaned
}

export async function uploadFilesToColabSession(options: {
  session: ColabSessionView
  localPaths: string[]
  targetRemoteDir?: string
  transfer?: UploadOptions
  cli: ColabCliRuntime
  credentials: ColabCredentialStore
  isolation: ColabPythonIsolation
  fetchImpl?: typeof fetch
  spawnProcess?: typeof spawn
}): Promise<RuntimeUploadResult> {
  try {
    const destDir = normalizeColabUploadTargetDir(options.targetRemoteDir)
    if (
      destDir === 'content/drive' ||
      (destDir.startsWith('content/drive/') &&
        !/^content\/drive\/(MyDrive|My Drive|Shareddrives)(\/|$)/.test(destDir))
    ) {
      return {
        ok: false,
        uploadedCount: 0,
        message: 'Choose a folder inside /content/drive/MyDrive to upload files.'
      }
    }
    const credFile = await options.credentials.materializeRuntimeToken(options.session.connectionId)
    const { paths, env } = await options.isolation.prepareConnectionEnvironment(
      options.session.connectionId,
      credFile
    )
    const driveMountMatch = /^content\/([^/]+)\/(?:MyDrive|My Drive|Shareddrives)(?:\/|$)/.exec(
      destDir
    )
    if (driveMountMatch) {
      const mountPoint = `/content/${driveMountMatch[1]}`
      const probed = await runSessionDriveProbeHelper({
        pythonPath: options.cli.venvPythonPath,
        sessionsJsonPath: paths.sessionsJsonPath,
        sessionName: options.session.sessionName,
        env,
        mountPoint,
        signal: options.transfer?.signal,
        spawnProcess: options.spawnProcess
      })
      if (options.transfer?.signal?.aborted) {
        return { ok: false, canceled: true, uploadedCount: 0 }
      }
      if (!probed.mounted) {
        return {
          ok: false,
          uploadedCount: 0,
          message: `Mount Google Drive (${mountPoint}) before uploading files to Drive.`
        }
      }
    }
    const access = colabUploadAccess({
      pythonPath: options.cli.venvPythonPath,
      sessionsJsonPath: paths.sessionsJsonPath,
      sessionName: options.session.sessionName,
      env
    })
    return await uploadRuntimeFiles(options.localPaths.map((localPath) => ({
      localPath, remotePath: posix.join(destDir, basename(localPath))
    })), access, options.transfer, options.fetchImpl)
  } catch (error) {
    if (options.transfer?.signal?.aborted) {
      return { ok: false, canceled: true, uploadedCount: 0 }
    }
    if (error instanceof Error && error.message.includes('Invalid Colab upload destination')) {
      return { ok: false, uploadedCount: 0, message: error.message }
    }
    return { ok: false, uploadedCount: 0, message: 'Could not prepare the connected Colab runtime for upload.' }
  }
}

export async function downloadArtifactsFromColabSession(options: {
  session: ColabSessionView
  remotePath?: string
  cli: ColabCliRuntime
  credentials: ColabCredentialStore
  isolation: ColabPythonIsolation
  executor: ColabSessionExecutor
}): Promise<{ ok: boolean; localPath?: string; message?: string }> {
  try {
    const credFile = await options.credentials.materializeRuntimeToken(options.session.connectionId)
    const { paths, env } = await options.isolation.prepareConnectionEnvironment(
      options.session.connectionId,
      credFile
    )
    const localDir = resolveWorkspaceOutputLocalDir(
      options.session.workspaceRoot || process.cwd(),
      options.session.outputLocalDir || './outputs'
    )
    await mkdir(localDir, { recursive: true })
    if (options.remotePath) {
      const normalizedRemote = options.remotePath.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
      const fileName = posix.basename(normalizedRemote)
      if (
        !normalizedRemote.startsWith('content/') ||
        normalizedRemote.split('/').some((seg) => !seg || seg === '.' || seg === '..') ||
        !fileName ||
        fileName === '.' ||
        fileName === '..'
      ) {
        return { ok: false, message: 'Invalid remote file path.' }
      }
      const dest = join(localDir, fileName)
      const res = await options.cli.runCommand({
        sessionsJsonPath: paths.sessionsJsonPath,
        args: ['download', '-s', options.session.sessionName, normalizedRemote, dest],
        env,
        timeoutMs: 180_000
      })
      if (res.exitCode !== 0) {
        return { ok: false, message: res.stderr || res.stdout || '下载失败。' }
      }
      return { ok: true, localPath: dest }
    }
    await options.executor.downloadArtifactsToWorkspace(
      options.session.sessionName,
      options.session.artifacts,
      localDir,
      paths.sessionsJsonPath,
      env
    )
    return { ok: true, localPath: localDir }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function resolveColabSessionBrowserUrl(options: {
  session?: ColabSessionView
  cli: ColabCliRuntime
  credentials: ColabCredentialStore
  isolation: ColabPythonIsolation
}): Promise<string> {
  let url = 'https://colab.research.google.com/'
  if (options.session && options.cli.status.state === 'ready') {
    try {
      const credFile = await options.credentials.materializeRuntimeToken(
        options.session.connectionId
      )
      const { paths, env } = await options.isolation.prepareConnectionEnvironment(
        options.session.connectionId,
        credFile
      )
      const res = await options.cli.runCommand({
        sessionsJsonPath: paths.sessionsJsonPath,
        args: ['url', '-s', options.session.sessionName],
        env,
        timeoutMs: 15_000
      })
      const firstUrl = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.startsWith('https://'))
      if (firstUrl) url = firstUrl
    } catch {
      // Fallback to Colab home URL.
    }
  }
  return url
}

export async function prepareColabTerminalCommand(options: {
  connection: PersistedConnectionRecord
  session?: ColabSessionView
  workspaceRoot?: string
  cli: ColabCliRuntime
  credentials: ColabCredentialStore
  isolation: ColabPythonIsolation
}): Promise<{ title: string; command: string; cwd?: string; env: Record<string, string> }> {
  const credFile = await options.credentials.materializeRuntimeToken(options.connection.id)
  const { paths, env } = await options.isolation.prepareConnectionEnvironment(
    options.connection.id,
    credFile
  )
  const pyQuoted = `"${options.cli.venvPythonPath}"`
  const cfgQuoted = `"${paths.sessionsJsonPath}"`
  const keyQuoted = `"${paths.sshKeyPath}"`
  const sessionFlag = options.session ? ` -s "${options.session.sessionName}"` : ''
  const command = `${pyQuoted} -m colab_cli.cli --config ${cfgQuoted} ssh${sessionFlag} --identity ${keyQuoted}`
  return {
    title: options.session
      ? `Colab · ${options.session.sessionName}`
      : `Colab · ${options.connection.name}`,
    command,
    cwd: options.session?.workspaceRoot || options.workspaceRoot || undefined,
    env
  }
}
