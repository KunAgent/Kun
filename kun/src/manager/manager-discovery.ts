import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { RuntimeBuildIdSchema } from '../contracts/runtime-info.js'
import { isLoopbackHost } from '../server/loopback-host.js'

export const KUN_MANAGER_PROTOCOL_VERSION = 5 as const
export const KUN_MANAGER_DISCOVERY_VERSION = 1 as const
export const KUN_MANAGER_DISCOVERY_FILENAME = 'manager.json'
const MANAGER_START_LOCK_FILENAME = '.manager-start.lock'
const MAX_DISCOVERY_BYTES = 64 * 1024
const LOCK_RETRY_MS = 20
const LOCK_ATTEMPTS = 2_000
const INVALID_LOCK_STALE_MS = 30_000

export const ManagerDiscoveryRecordSchema = z.object({
  version: z.literal(KUN_MANAGER_DISCOVERY_VERSION),
  protocolVersion: z.literal(KUN_MANAGER_PROTOCOL_VERSION),
  instanceId: z.string().min(1).max(256),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  host: z.string().min(1).max(512),
  port: z.number().int().min(1).max(65_535),
  baseUrl: z.string().url().max(2_048),
  managerToken: z.string().min(1).max(16_384),
  serviceVersion: z.string().min(1).max(128),
  /** Optional so a new desktop can authenticate and hand off a legacy Manager. */
  buildId: RuntimeBuildIdSchema.optional(),
  dataDir: z.string().min(1).max(4_096),
  settingsPath: z.string().min(1).max(4_096),
  logPath: z.string().min(1).max(4_096).optional()
})

/** Minimal cross-version identity used only to drain an installed owner. */
export const ManagerHandoffDiscoveryRecordSchema = z.object({
  version: z.number().int().positive().optional(),
  protocolVersion: z.number().int().positive().optional(),
  instanceId: z.string().min(1).max(256),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  host: z.string().min(1).max(512),
  port: z.number().int().min(1).max(65_535),
  baseUrl: z.string().url().max(2_048),
  managerToken: z.string().min(1).max(16_384),
  buildId: RuntimeBuildIdSchema.optional(),
  dataDir: z.string().min(1).max(4_096),
  settingsPath: z.string().min(1).max(4_096),
  logPath: z.string().min(1).max(4_096).optional()
}).passthrough()

export type ManagerDiscoveryRecord = z.infer<typeof ManagerDiscoveryRecordSchema>
export type ManagerHandoffDiscoveryRecord = z.infer<typeof ManagerHandoffDiscoveryRecordSchema>
export type PublishManagerDiscoveryInput = Omit<
  ManagerDiscoveryRecord,
  'version' | 'protocolVersion' | 'instanceId'
> & { instanceId?: string }

export function defaultKunControlDir(home = homedir()): string {
  return join(home, '.kun', 'control')
}

export function defaultProductionSettingsPath(
  home = homedir(),
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Kun', 'kun-settings.json')
  if (platform === 'win32') {
    return join(env.APPDATA?.trim() || join(home, 'AppData', 'Roaming'), 'Kun', 'kun-settings.json')
  }
  return join(env.XDG_CONFIG_HOME?.trim() || join(home, '.config'), 'Kun', 'kun-settings.json')
}

export function managerDiscoveryPath(controlDir: string): string {
  return join(controlDir, KUN_MANAGER_DISCOVERY_FILENAME)
}

export function createManagerDiscoveryRecord(
  input: PublishManagerDiscoveryInput
): ManagerDiscoveryRecord {
  return ManagerDiscoveryRecordSchema.parse({
    ...input,
    version: KUN_MANAGER_DISCOVERY_VERSION,
    protocolVersion: KUN_MANAGER_PROTOCOL_VERSION,
    instanceId: input.instanceId ?? randomUUID()
  })
}

export async function readManagerDiscovery(
  controlDir: string
): Promise<ManagerDiscoveryRecord | null> {
  const parsed = ManagerDiscoveryRecordSchema.safeParse(
    await readManagerDiscoveryValue(controlDir)
  )
  return parsed.success ? parsed.data : null
}

export async function readManagerHandoffDiscovery(
  controlDir: string
): Promise<ManagerHandoffDiscoveryRecord | null> {
  const parsed = ManagerHandoffDiscoveryRecordSchema.safeParse(
    await readManagerDiscoveryValue(controlDir)
  )
  if (!parsed.success) return null
  return safeHandoffManagerUrl(parsed.data) ? parsed.data : null
}

/** Strict installed-build probe; an existing invalid record is not "no owner". */
export async function readManagerHandoffDiscoveryStrict(
  controlDir: string
): Promise<ManagerHandoffDiscoveryRecord | null> {
  const record = await readManagerHandoffDiscovery(controlDir)
  if (record) return record
  try {
    await stat(managerDiscoveryPath(controlDir))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
  throw new Error('invalid Kun Service Manager discovery record')
}

export async function publishManagerDiscovery(
  controlDir: string,
  input: PublishManagerDiscoveryInput
): Promise<ManagerDiscoveryRecord> {
  const record = createManagerDiscoveryRecord(input)
  await mkdir(controlDir, { recursive: true, mode: 0o700 })
  await chmod(controlDir, 0o700).catch((error) => {
    if (process.platform !== 'win32') throw error
  })
  const path = managerDiscoveryPath(controlDir)
  await atomicWriteFile(path, `${JSON.stringify(record, null, 2)}\n`)
  await chmod(path, 0o600).catch((error) => {
    if (process.platform !== 'win32') throw error
  })
  return record
}

export async function removeManagerDiscovery(
  controlDir: string,
  instanceId: string
): Promise<boolean> {
  const current = await readManagerHandoffDiscovery(controlDir)
  if (!current || current.instanceId !== instanceId) return false
  await rm(managerDiscoveryPath(controlDir), { force: true })
  return true
}

async function readManagerDiscoveryValue(controlDir: string): Promise<unknown> {
  const path = managerDiscoveryPath(controlDir)
  try {
    const details = await stat(path)
    if (!details.isFile() || details.size > MAX_DISCOVERY_BYTES) return null
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

function safeHandoffManagerUrl(record: ManagerHandoffDiscoveryRecord): boolean {
  try {
    const url = new URL(record.baseUrl)
    return url.protocol === 'http:' &&
      isLoopbackHost(url.hostname) &&
      isLoopbackHost(record.host) &&
      (url.pathname === '/' || url.pathname === '') &&
      Number(url.port || '80') === record.port &&
      url.username === '' &&
      url.password === ''
  } catch {
    return false
  }
}

export async function withManagerStartLock<T>(
  controlDir: string,
  action: () => Promise<T>
): Promise<T> {
  await mkdir(controlDir, { recursive: true, mode: 0o700 })
  const lockPath = join(controlDir, MANAGER_START_LOCK_FILENAME)
  const owner = JSON.stringify({
    pid: process.pid,
    instanceId: randomUUID(),
    acquiredAt: new Date().toISOString()
  })
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(owner, 'utf8')
        return await action()
      } finally {
        await handle.close().catch(() => undefined)
        await removeOwnedLock(lockPath, owner)
      }
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      const stale = await staleLockOwner(lockPath)
      if (stale !== null) {
        await removeOwnedLock(lockPath, stale).catch(() => undefined)
        continue
      }
      await delay(LOCK_RETRY_MS)
    }
  }
  throw new Error('timed out waiting for the Kun Service Manager start lock')
}

async function staleLockOwner(path: string): Promise<string | null> {
  try {
    const [text, details] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    const parsed = z.object({ pid: z.number().int().positive() }).safeParse(JSON.parse(text))
    if (parsed.success) return processIsAlive(parsed.data.pid) ? null : text
    return Date.now() - details.mtimeMs >= INVALID_LOCK_STALE_MS ? text : null
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    return null
  }
}

async function removeOwnedLock(path: string, owner: string): Promise<void> {
  try {
    if (await readFile(path, 'utf8') === owner) await rm(path, { force: true })
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) === 'EPERM'
  }
}

function errorCode(error: unknown): string {
  return String((error as { code?: unknown })?.code ?? '')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
