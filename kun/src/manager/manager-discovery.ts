import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { RuntimeBuildIdSchema } from '../contracts/runtime-info.js'
import { isLoopbackHost } from '../server/loopback-host.js'
import { AppSessionOwnerSchema, sameAppSessionOwner } from '../contracts/app-session-owner.js'

export const KUN_MANAGER_PROTOCOL_VERSION = 6 as const
export const KUN_MANAGER_DISCOVERY_VERSION = 1 as const
export const KUN_MANAGER_DISCOVERY_FILENAME = 'manager.json'
export { withManagerStartLock, ManagerStartLockError } from './manager-start-lock.js'
const MAX_DISCOVERY_BYTES = 64 * 1024

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
  appOwner: AppSessionOwnerSchema.optional(),
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
  appOwner: AppSessionOwnerSchema.optional(),
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
  instanceId: string,
  expected?: Pick<ManagerDiscoveryRecord, 'pid' | 'startedAt' | 'appOwner'>
): Promise<boolean> {
  const current = await readManagerHandoffDiscovery(controlDir)
  if (!current || current.instanceId !== instanceId) return false
  if (expected && (current.pid !== expected.pid || current.startedAt !== expected.startedAt ||
    (expected.appOwner ? !sameAppSessionOwner(current.appOwner, expected.appOwner) : Boolean(current.appOwner)))) return false
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

function errorCode(error: unknown): string {
  return String((error as { code?: unknown })?.code ?? '')
}
