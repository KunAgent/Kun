import { spawn } from 'node:child_process'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, posix } from 'node:path'
import type { KunColabSettingsV1 } from '../../shared/app-settings-colab'
import { activeDrivePullSessions } from './colab-drive-notebooks'
import type { ColabSessionView, ColabUntrackedSession } from '../../shared/colab/colab-types'
import {
  classifyColabErrorOutput,
  type ColabCliRuntime,
  parseColabSessionsOutput,
  parseColabUsageOutput
} from './colab-cli-runtime'
import type { ColabCredentialStore } from './colab-credential-store'
import type { ColabPythonIsolation } from './colab-python-isolation'
import type { ColabSessionExecutor } from './colab-session-executor'
import type { PersistedConnectionRecord } from './colab-state-store'

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
      const parsed = parseColabUsageOutput(usageRes.stdout)
      if (parsed) {
        conn.balanceCu = Number(parsed.balanceCu.toFixed(1))
        conn.burnRateCuPerHour = Number(parsed.burnRateCuPerHour.toFixed(2))
        conn.planLabel =
          conn.balanceCu >= 300 ? 'Colab Pro+' : conn.balanceCu > 0 ? 'Colab Pro' : 'Colab'
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

export async function uploadFilesToColabSession(options: {
  session: ColabSessionView
  localPaths: string[]
  cli: ColabCliRuntime
  credentials: ColabCredentialStore
  isolation: ColabPythonIsolation
}): Promise<{ ok: boolean; uploadedCount?: number; message?: string }> {
  try {
    const credFile = await options.credentials.materializeRuntimeToken(options.session.connectionId)
    const { paths, env } = await options.isolation.prepareConnectionEnvironment(
      options.session.connectionId,
      credFile
    )
    let count = 0
    for (const localPath of options.localPaths) {
      const info = await stat(localPath)
      if (!info.isFile()) continue
      const remote = posix.join('content', basename(localPath))
      const res = await options.cli.runCommand({
        sessionsJsonPath: paths.sessionsJsonPath,
        args: ['upload', '-s', options.session.sessionName, localPath, remote],
        env,
        timeoutMs: 180_000
      })
      if (res.exitCode === 0) count += 1
    }
    return { ok: true, uploadedCount: count }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
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
    const localDir = join(
      options.session.workspaceRoot || process.cwd(),
      options.session.outputLocalDir || './outputs'
    )
    await mkdir(localDir, { recursive: true })
    if (options.remotePath) {
      const dest = join(localDir, basename(options.remotePath))
      const res = await options.cli.runCommand({
        sessionsJsonPath: paths.sessionsJsonPath,
        args: ['download', '-s', options.session.sessionName, options.remotePath, dest],
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
