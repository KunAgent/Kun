import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { RuntimeBuildIdSchema } from '../contracts/runtime-info.js'
import { RuntimeFlavorSchema, type RuntimeFlavor } from '../contracts/runtime-flavor.js'
import { isLoopbackHost } from './loopback-host.js'
import { KUN_VERSION } from '../version.js'

export const RUNTIME_DISCOVERY_VERSION = 2 as const
export const KUN_SERVICE_VERSION = KUN_VERSION
export const RUNTIME_DISCOVERY_FILENAME = 'runtime.json'
const RUNTIME_DISCOVERY_LOCK_FILENAME = '.runtime-discovery.lock'
const RUNTIME_START_LOCK_FILENAME = '.runtime-start.lock'
const MAX_DISCOVERY_BYTES = 64 * 1024
const LOCK_RETRY_MS = 20
// A detached runtime may need several seconds to import dependencies, bind its
// port, and publish discovery. Keep contenders waiting past the 30s startup
// deadline so they can reuse the elected instance instead of failing early.
const LOCK_ATTEMPTS = 2_000
const INVALID_LOCK_STALE_MS = 30_000

export const RuntimeDiscoveryRecordSchema = z.object({
  version: z.literal(RUNTIME_DISCOVERY_VERSION),
  instanceId: z.string().min(1).max(256),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  host: z.string().min(1).max(512),
  port: z.number().int().min(1).max(65_535),
  baseUrl: z.string().url().max(2_048),
  runtimeToken: z.string().max(16_384),
  insecure: z.boolean(),
  serviceVersion: z.string().min(1).max(128),
  flavor: RuntimeFlavorSchema.optional(),
  buildId: RuntimeBuildIdSchema.optional(),
  launchMode: z.enum(['foreground', 'shared', 'gui']),
  logPath: z.string().min(1).max(4_096).optional()
})

/**
 * Stable, handoff-only view of a discovery record. Normal Runtime attachment
 * still requires RuntimeDiscoveryRecordSchema and the current info schema;
 * this reader exists solely so a newer binary can identify and stop an older
 * local owner without mistaking schema drift for a missing writer.
 */
export const RuntimeHandoffDiscoveryRecordSchema = z.object({
  version: z.number().int().positive(),
  instanceId: z.string().min(1).max(256),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  host: z.string().min(1).max(512),
  port: z.number().int().min(1).max(65_535),
  baseUrl: z.string().url().max(2_048),
  runtimeToken: z.string().max(16_384),
  flavor: RuntimeFlavorSchema.optional(),
  buildId: RuntimeBuildIdSchema.optional(),
  logPath: z.string().min(1).max(4_096).optional()
}).passthrough()

export type RuntimeDiscoveryRecord = z.infer<typeof RuntimeDiscoveryRecordSchema>
export type RuntimeHandoffDiscoveryRecord = z.infer<typeof RuntimeHandoffDiscoveryRecordSchema>

export type PublishRuntimeDiscoveryInput = Omit<
  RuntimeDiscoveryRecord,
  'version' | 'instanceId' | 'serviceVersion' | 'launchMode'
> & {
  instanceId?: string
  serviceVersion?: string
  launchMode?: RuntimeDiscoveryRecord['launchMode']
}

export function runtimeDiscoveryPath(
  dataDir: string,
  flavor: RuntimeFlavor = 'production'
): string {
  return join(
    dataDir,
    flavor === 'production' ? RUNTIME_DISCOVERY_FILENAME : `runtime.${flavor}.json`
  )
}

export function createRuntimeDiscoveryRecord(
  input: PublishRuntimeDiscoveryInput
): RuntimeDiscoveryRecord {
  return RuntimeDiscoveryRecordSchema.parse({
    ...input,
    version: RUNTIME_DISCOVERY_VERSION,
    instanceId: input.instanceId ?? randomUUID(),
    serviceVersion: input.serviceVersion ?? KUN_SERVICE_VERSION,
    launchMode: input.launchMode ?? 'foreground'
  })
}

export async function readRuntimeDiscovery(
  dataDir: string,
  flavor: RuntimeFlavor = 'production'
): Promise<RuntimeDiscoveryRecord | null> {
  const value = await readRuntimeDiscoveryValue(dataDir, flavor)
  const parsed = RuntimeDiscoveryRecordSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export async function readRuntimeHandoffDiscovery(
  dataDir: string,
  flavor: RuntimeFlavor = 'production'
): Promise<RuntimeHandoffDiscoveryRecord | null> {
  const value = await readRuntimeDiscoveryValue(dataDir, flavor)
  const parsed = RuntimeHandoffDiscoveryRecordSchema.safeParse(value)
  if (!parsed.success || !handoffFlavorMatches(parsed.data, flavor)) return null
  return isSafeRuntimeHandoffDiscovery(parsed.data) ? parsed.data : null
}

/**
 * Replacement probes must distinguish an absent owner from an unreadable or
 * unsafe discovery record. Normal attachment keeps the compatibility behavior
 * above, while installed-build handoff fails closed on an existing invalid file.
 */
export async function readRuntimeHandoffDiscoveryStrict(
  dataDir: string,
  flavor: RuntimeFlavor = 'production'
): Promise<RuntimeHandoffDiscoveryRecord | null> {
  const record = await readRuntimeHandoffDiscovery(dataDir, flavor)
  if (record) return record
  try {
    await stat(runtimeDiscoveryPath(dataDir, flavor))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
  throw new Error(`invalid Kun ${flavor} Runtime discovery record`)
}

export async function publishRuntimeDiscovery(
  dataDir: string,
  input: PublishRuntimeDiscoveryInput
): Promise<RuntimeDiscoveryRecord> {
  const record = createRuntimeDiscoveryRecord(input)
  await withDiscoveryLock(dataDir, record.instanceId, async () => {
    const flavor = record.flavor ?? 'production'
    const path = runtimeDiscoveryPath(dataDir, flavor)
    await atomicWriteFile(path, `${JSON.stringify(record, null, 2)}\n`)
    // On Windows atomicWriteFile can fall back to overwriting an existing
    // destination, where writeFile's mode does not tighten prior permissions.
    await chmod(path, 0o600).catch((error) => {
      if (process.platform !== 'win32') throw error
    })
  })
  return record
}

/**
 * Remove the rendezvous record only if this exact server instance still owns
 * it. The lock serializes publication and cleanup across overlapping GUI/CLI
 * server lifecycles, so an older process cannot unlink a newer record.
 */
export async function removeRuntimeDiscovery(
  dataDir: string,
  instanceId: string,
  flavor: RuntimeFlavor = 'production'
): Promise<boolean> {
  return withDiscoveryLock(dataDir, instanceId, async () => {
    const current = await readRuntimeHandoffDiscovery(dataDir, flavor)
    if (!current || current.instanceId !== instanceId) return false
    await rm(runtimeDiscoveryPath(dataDir, flavor), { force: true })
    return true
  })
}

async function readRuntimeDiscoveryValue(
  dataDir: string,
  flavor: RuntimeFlavor
): Promise<unknown> {
  const path = runtimeDiscoveryPath(dataDir, flavor)
  let details
  try {
    details = await stat(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
  if (!details.isFile() || details.size > MAX_DISCOVERY_BYTES) return null
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

function handoffFlavorMatches(
  record: RuntimeHandoffDiscoveryRecord,
  expected: RuntimeFlavor
): boolean {
  return expected === 'production'
    ? record.flavor === undefined || record.flavor === 'production'
    : record.flavor === expected
}

export function isSafeRuntimeHandoffDiscovery(
  record: RuntimeHandoffDiscoveryRecord
): boolean {
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

/** Serialize shared-runtime election for one data directory. */
export async function withRuntimeStartLock<T>(
  dataDir: string,
  action: () => Promise<T>,
  flavor: RuntimeFlavor = 'production'
): Promise<T> {
  const filename = flavor === 'production'
    ? RUNTIME_START_LOCK_FILENAME
    : `.runtime-start.${flavor}.lock`
  return withFileLock(dataDir, filename, randomUUID(), action)
}

async function withDiscoveryLock<T>(
  dataDir: string,
  instanceId: string,
  action: () => Promise<T>
): Promise<T> {
  return withFileLock(dataDir, RUNTIME_DISCOVERY_LOCK_FILENAME, instanceId, action)
}

async function withFileLock<T>(
  dataDir: string,
  filename: string,
  instanceId: string,
  action: () => Promise<T>
): Promise<T> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  await chmod(dataDir, 0o700).catch((error) => {
    if (process.platform !== 'win32') throw error
  })
  const lockPath = join(dataDir, filename)
  const owner = JSON.stringify({ pid: process.pid, instanceId, acquiredAt: new Date().toISOString() })
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
      const staleOwner = await staleDiscoveryLockOwner(lockPath)
      if (staleOwner !== null) {
        // The prior owner may release the lock and a new server may acquire it
        // between inspection and cleanup. Remove only the bytes we inspected.
        await removeOwnedLock(lockPath, staleOwner).catch(() => undefined)
        continue
      }
      await delay(LOCK_RETRY_MS)
    }
  }
  throw new Error('timed out waiting for the Kun runtime discovery lock')
}

async function staleDiscoveryLockOwner(path: string): Promise<string | null> {
  try {
    const [text, details] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    const parsed = z.object({ pid: z.number().int().positive() }).safeParse(JSON.parse(text))
    if (parsed.success) return !isProcessAlive(parsed.data.pid) ? text : null
    return Date.now() - details.mtimeMs >= INVALID_LOCK_STALE_MS ? text : null
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    if (error instanceof SyntaxError) {
      const [text, details] = await Promise.all([
        readFile(path, 'utf8').catch(() => null),
        stat(path).catch(() => null)
      ])
      return text !== null && details && Date.now() - details.mtimeMs >= INVALID_LOCK_STALE_MS
        ? text
        : null
    }
    return null
  }
}

async function removeOwnedLock(path: string, owner: string): Promise<void> {
  try {
    if (await readFile(path, 'utf8') === owner) {
      await rm(path, { force: true })
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
}

function isProcessAlive(pid: number): boolean {
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
