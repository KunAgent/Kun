import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import type { RuntimeFlavor } from '../contracts/runtime-flavor.js'
import { withRuntimeStartLock } from '../server/runtime-discovery.js'
import { runtimeProcessIdentity, runtimeProcessIsAlive } from '../server/runtime-process-identity.js'
import { inspectSharedRuntime, runtimeDiscoveryDirectory, stopInspectedSharedRuntime,
  type SharedRuntimeInspection } from './shared-runtime.js'
import { terminateSpawnedRuntime, waitForSpawnedSharedRuntime } from './shared-runtime-launch.js'

const HostRecord = z.object({
  version: z.literal(1), pid: z.number().int().positive(), processIdentity: z.string().min(1),
  startedAt: z.string().datetime(), instanceId: z.string().optional(),
  logPath: z.string(), stoppedAt: z.string().optional(), lastError: z.string().optional()
}).strict()
type HostRecord = z.infer<typeof HostRecord>
export type PersistentHostStatus = {
  status: 'online' | 'starting' | 'unreachable' | 'offline' | 'conflict'
  dataDir: string; pid?: number; startedAt?: string; stoppedAt?: string
  instanceId?: string; url?: string; logPath?: string; lastError?: string
  guiAttachSupported: false; osAutostartInstalled: false
}
export type PersistentHostOptions = {
  dataDir: string; controlDir: string; runtimeFlavor: RuntimeFlavor
  env?: NodeJS.ProcessEnv; fetch?: typeof fetch; timeoutMs?: number
  /** Internal test/package seam; never accepted as a CLI argument. */
  launch?: { command: string; args: string[]; runAsNode?: boolean }
}

/** An explicitly started independent application owner. Its foreground serve
 * process owns and fences Manager/Runtime descendants, even though the command
 * that launched it exits. It never adopts a GUI or replaces another owner. */
export class PersistentHost {
  private readonly directory: string
  private readonly recordPath: string
  constructor(private readonly options: PersistentHostOptions) {
    this.directory = join(runtimeDiscoveryDirectory(options.dataDir, options.runtimeFlavor, options.controlDir), 'persistent-host')
    this.recordPath = join(this.directory, 'owner.json')
  }

  private inspect(): Promise<SharedRuntimeInspection | null> {
    return inspectSharedRuntime(this.options.dataDir, this.options.fetch ?? fetch, this.options)
  }

  private async record(): Promise<HostRecord | null> {
    try { return HostRecord.parse(JSON.parse(await readFile(this.recordPath, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }

  private save(record: HostRecord): Promise<void> {
    return atomicWriteFile(this.recordPath, JSON.stringify(record), { durable: true, allowDirectWriteFallback: false })
  }

  async status(): Promise<PersistentHostStatus> {
    const record = await this.record(), inspected = await this.inspect()
    const alive = record && runtimeProcessIsAlive(record.pid, record)
    const matched = record && inspected && sameHost(record, inspected)
    const status = matched ? inspected.connection ? 'online' : 'unreachable'
      : inspected ? 'conflict' : alive ? record.instanceId ? 'unreachable' : 'starting' : 'offline'
    return { status, dataDir: this.options.dataDir, guiAttachSupported: false, osAutostartInstalled: false,
      ...(record ? { pid: record.pid, startedAt: record.startedAt, stoppedAt: record.stoppedAt,
        instanceId: record.instanceId, logPath: record.logPath, lastError: record.lastError } : {}),
      ...(matched && inspected.connection ? { url: inspected.discovery.baseUrl } : {}) }
  }

  start(): Promise<PersistentHostStatus> {
    // Separate from Runtime's start lock: foreground serve takes that lock
    // itself after obtaining the canonical application-session reservation.
    return withRuntimeStartLock(this.directory, async () => {
      const status = await this.status()
      if (status.status === 'online') return status
      if (status.status !== 'offline') throw new Error(
        `Persistent host is ${status.status}. Close its current owner or wait for recovery; another process will not be replaced.`)
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const logPath = join(this.directory, 'host.log')
      const logFd = openSync(logPath, 'a', 0o600)
      const env = persistentHostEnvironment({ ...process.env, ...this.options.env })
      Object.assign(env, { KUN_RUNTIME_TOKEN: randomBytes(32).toString('base64url'),
        KUN_RUNTIME_LAUNCH_MODE: 'foreground', KUN_RUNTIME_FLAVOR: this.options.runtimeFlavor,
        KUN_MANAGER_CONTROL_DIR: this.options.controlDir,
        KUN_RUNTIME_DISCOVERY_DIR: runtimeDiscoveryDirectory(this.options.dataDir, this.options.runtimeFlavor, this.options.controlDir),
        KUN_RUNTIME_LOG_PATH: logPath })
      const packaged = env.KUN_PACKAGED_RUNTIME_EXECUTABLE?.trim()
      const command = this.options.launch?.command ?? packaged ?? process.execPath
      const args = this.options.launch?.args ?? [fileURLToPath(new URL('./serve-entry.js', import.meta.url)),
        'serve', '--host', '127.0.0.1', '--port', '0', '--data-dir', this.options.dataDir]
      if (this.options.launch?.runAsNode ?? Boolean(packaged || process.versions.electron)) env.ELECTRON_RUN_AS_NODE = '1'
      else delete env.ELECTRON_RUN_AS_NODE
      let child: ChildProcess
      try { child = spawn(command, args, { detached: true, windowsHide: true, stdio: ['ignore', logFd, logFd], env }) }
      finally { closeSync(logFd) }
      let record: HostRecord | undefined
      try {
        await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
        const identity = child.pid && runtimeProcessIdentity(child.pid)
        if (!child.pid || !identity) throw new Error('Could not verify the newly started host process identity')
        record = { version: 1, pid: child.pid, processIdentity: identity, startedAt: new Date().toISOString(), logPath }
        await this.save(record)
        const connected = await waitForSpawnedSharedRuntime<SharedRuntimeInspection>({ child, allowWinningOwner: false,
          deadline: Date.now() + (this.options.timeoutMs ?? 90_000), pollMs: 100,
          timeoutError: () => new Error(`Persistent host did not become ready. Check ${logPath}`),
          observe: async () => {
            const current = await this.inspect()
            if (!current) return { kind: 'starting' }
            if (current.discovery.pid !== child.pid || current.discovery.launchMode !== 'foreground' || current.discovery.clientOwnerKind) {
              return { kind: 'blocked', error: new Error('Another application owns this profile; close it before starting a persistent host') }
            }
            return current.connection ? { kind: 'ready', value: current, ownerPid: current.discovery.pid } : { kind: 'starting' }
          }
        })
        await this.save({ ...record, startedAt: connected.discovery.startedAt, instanceId: connected.discovery.instanceId })
        child.unref()
        return this.status()
      } catch (error) {
        await terminateSpawnedRuntime(child)
        if (record) await this.save({ ...record, stoppedAt: new Date().toISOString(),
          lastError: error instanceof Error ? error.message : String(error) })
        throw error
      }
    }, this.options.runtimeFlavor)
  }

  stop(): Promise<PersistentHostStatus> {
    return withRuntimeStartLock(this.directory, async () => {
      const record = await this.record(), inspected = await this.inspect()
      if (!record) throw new Error('No persistent host is recorded for this profile; no other client was stopped')
      if (!inspected && !runtimeProcessIsAlive(record.pid, record)) return this.status()
      if (!inspected || !sameHost(record, inspected)) throw new Error('Host identity is unavailable or changed; preserving the current process')
      if (this.options.env?.KUN_RUNTIME_INSTANCE_ID === inspected.discovery.instanceId) {
        throw new Error('Cannot stop the host executing this command; use an external terminal')
      }
      const current = await this.inspect()
      if (!current || !sameHost(record, current)) throw new Error('Host owner changed before shutdown; retry after checking status')
      await stopInspectedSharedRuntime(this.options.dataDir, current, this.options.fetch ?? fetch, this.options)
      await this.save({ ...record, stoppedAt: new Date().toISOString() })
      return this.status()
    }, this.options.runtimeFlavor)
  }
}

function sameHost(record: HostRecord, current: SharedRuntimeInspection): boolean {
  return Boolean(record.instanceId && current.discovery.instanceId === record.instanceId &&
    current.discovery.pid === record.pid && current.discovery.startedAt === record.startedAt &&
    current.discovery.launchMode === 'foreground' && !current.discovery.clientOwnerKind)
}

export function persistentHostEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...input }
  for (const key of ['KUN_APP_SESSION_OWNER', 'KUN_APP_SESSION_RESERVATION', 'KUN_RUNTIME_CLIENT_OWNER_KIND',
    'KUN_RUNTIME_INSTANCE_ID', 'KUN_RUNTIME_BUILD_ID', 'KUN_MANAGER_BASE_URL', 'KUN_MANAGER_TOKEN',
    'KUN_MANAGER_INSTANCE_ID', 'KUN_MANAGER_DATA_DIR', 'KUN_PROCESS_STACK_OWNER_PID', 'KUN_PROCESS_STACK_OWNER_BIRTH']) delete env[key]
  return env
}
