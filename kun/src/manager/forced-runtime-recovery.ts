import { randomUUID } from 'node:crypto'
import { chmod, readFile, stat, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { RuntimeFlavorSchema, type RuntimeFlavor } from '../contracts/runtime-flavor.js'

const FORCED_RUNTIME_RECOVERY_FILE = 'forced-runtime-recovery.json'
const MAX_RECOVERY_FILE_BYTES = 64 * 1024
const MAX_RECOVERY_OWNERS = 32
// Windows paths can contain delimiters; encode components before joining keys.
const KEY_SEPARATOR = '\0'

export const VerifiedForcedRuntimeOwnerSchema = z.object({
  flavor: RuntimeFlavorSchema,
  instanceId: z.string().min(1).max(256),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime()
}).strict()

export type VerifiedForcedRuntimeOwner = z.infer<typeof VerifiedForcedRuntimeOwnerSchema>

const RecoveryMetadataSchema = z.object({
  markerId: z.string().min(1).max(256),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict()

const ForcedRuntimeRecoveryRecordV1Schema = RecoveryMetadataSchema.extend({
  version: z.literal(1),
  dataDir: z.string().min(1).max(4_096),
  owners: z.array(VerifiedForcedRuntimeOwnerSchema).min(1).max(MAX_RECOVERY_OWNERS)
})

const ForcedRuntimeRecoveryOwnerSchema = VerifiedForcedRuntimeOwnerSchema.extend({
  dataDir: z.string().min(1).max(4_096)
})

export const ForcedRuntimeRecoveryRecordSchema = RecoveryMetadataSchema.extend({
  version: z.literal(2),
  owners: z.array(ForcedRuntimeRecoveryOwnerSchema).min(1).max(MAX_RECOVERY_OWNERS)
})

export type ForcedRuntimeRecoveryOwner = z.infer<typeof ForcedRuntimeRecoveryOwnerSchema>
export type ForcedRuntimeRecoveryRecord = z.infer<typeof ForcedRuntimeRecoveryRecordSchema>

export function forcedRuntimeRecoveryPath(controlDir: string): string {
  return join(controlDir, FORCED_RUNTIME_RECOVERY_FILE)
}

export async function readForcedRuntimeRecovery(
  controlDir: string
): Promise<ForcedRuntimeRecoveryRecord | null> {
  const path = forcedRuntimeRecoveryPath(controlDir)
  try {
    const metadata = await stat(path)
    if (!metadata.isFile() || metadata.size > MAX_RECOVERY_FILE_BYTES) {
      throw new Error('Kun forced-runtime recovery marker is invalid or oversized')
    }
    return parseForcedRuntimeRecovery(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw error
  }
}

export async function recordVerifiedForcedRuntimeOwner(input: {
  controlDir: string
  dataDir: string
  owner: VerifiedForcedRuntimeOwner
  now?: Date
}): Promise<ForcedRuntimeRecoveryRecord> {
  const owner = ForcedRuntimeRecoveryOwnerSchema.parse({
    ...VerifiedForcedRuntimeOwnerSchema.parse(input.owner),
    dataDir: input.dataDir
  })
  const existing = await readForcedRuntimeRecovery(input.controlDir)
  const now = (input.now ?? new Date()).toISOString()
  const owners = [...(existing?.owners ?? [])]
  const index = owners.findIndex((candidate) =>
    forcedRuntimeRecoveryOwnerKey(candidate) === forcedRuntimeRecoveryOwnerKey(owner)
  )
  if (index >= 0) owners[index] = owner
  else owners.push(owner)
  const record = ForcedRuntimeRecoveryRecordSchema.parse({
    version: 2,
    markerId: existing?.markerId ?? randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    owners
  })
  await writeForcedRuntimeRecovery(input.controlDir, record)
  return record
}

export async function consumeForcedRuntimeRecoveryOwners(input: {
  controlDir: string
  markerId: string
  owners: readonly ForcedRuntimeRecoveryOwner[]
  now?: Date
}): Promise<boolean> {
  const current = await readForcedRuntimeRecovery(input.controlDir)
  if (!current || current.markerId !== input.markerId) return false
  const consumed = new Set(input.owners.map(forcedRuntimeRecoveryOwnerIdentity))
  if (consumed.size !== input.owners.length) {
    throw new Error('Kun forced-runtime recovery consumption contains duplicate owners')
  }
  const owners = current.owners.filter((owner) =>
    !consumed.has(forcedRuntimeRecoveryOwnerIdentity(owner))
  )
  if (owners.length === current.owners.length) return true
  if (owners.length === 0) return removeForcedRuntimeRecovery(input.controlDir, input.markerId)
  await writeForcedRuntimeRecovery(input.controlDir, {
    ...current,
    updatedAt: (input.now ?? new Date()).toISOString(),
    owners
  })
  return true
}

export async function removeForcedRuntimeRecovery(
  controlDir: string,
  markerId: string
): Promise<boolean> {
  const current = await readForcedRuntimeRecovery(controlDir)
  if (!current || current.markerId !== markerId) return false
  try {
    await unlink(forcedRuntimeRecoveryPath(controlDir))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false
    throw error
  }
}

export function forcedOwnerKey(owner: {
  flavor: RuntimeFlavor
  instanceId: string
}): string {
  return `${owner.flavor}:${owner.instanceId}`
}

function forcedRecoveryKeyPart(value: string): string {
  return encodeURIComponent(value)
}

export function forcedRuntimeRecoveryOwnerKey(
  owner: Pick<ForcedRuntimeRecoveryOwner, 'dataDir' | 'flavor' | 'instanceId'>
): string {
  return [
    forcedRecoveryKeyPart(resolve(owner.dataDir)),
    owner.flavor,
    forcedRecoveryKeyPart(owner.instanceId)
  ].join(KEY_SEPARATOR)
}

export function forcedRuntimeRecoveryOwnerIdentity(owner: ForcedRuntimeRecoveryOwner): string {
  return [
    forcedRuntimeRecoveryOwnerKey(owner),
    String(owner.pid),
    forcedRecoveryKeyPart(owner.startedAt)
  ].join(KEY_SEPARATOR)
}

async function writeForcedRuntimeRecovery(
  controlDir: string,
  record: ForcedRuntimeRecoveryRecord
): Promise<void> {
  const path = forcedRuntimeRecoveryPath(controlDir)
  await atomicWriteFile(path, `${JSON.stringify(record, null, 2)}\n`)
  await chmod(path, 0o600).catch((error) => {
    if (process.platform !== 'win32') throw error
  })
}

function parseForcedRuntimeRecovery(value: unknown): ForcedRuntimeRecoveryRecord {
  if (typeof value === 'object' && value !== null &&
    (value as { version?: unknown }).version === 1) {
    const legacy = ForcedRuntimeRecoveryRecordV1Schema.parse(value)
    return ForcedRuntimeRecoveryRecordSchema.parse({
      version: 2,
      markerId: legacy.markerId,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      owners: legacy.owners.map((owner) => ({ ...owner, dataDir: legacy.dataDir }))
    })
  }
  return ForcedRuntimeRecoveryRecordSchema.parse(value)
}
