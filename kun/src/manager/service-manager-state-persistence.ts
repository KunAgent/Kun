import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, copyFile, readFile } from 'node:fs/promises'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import {
  ServiceManagerStateSnapshotSchema,
  type ServiceManagerStateSnapshot
} from './service-manager-state-snapshot.js'
import { ServiceManagerState } from './service-manager-state.js'

export async function readPersistedManagerState(path: string): Promise<ServiceManagerState> {
  let serialized: string
  try {
    serialized = await readFile(path, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return new ServiceManagerState()
    throw error
  }

  let value: unknown
  try {
    value = JSON.parse(serialized) as unknown
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return recoverCorruptManagerState(path, 'invalid JSON')
  }

  const snapshot = ServiceManagerStateSnapshotSchema.safeParse(value)
  if (!snapshot.success) {
    return recoverCorruptManagerState(path, 'invalid state schema')
  }
  return ServiceManagerState.restore(snapshot.data)
}

export async function writePersistedManagerState(
  path: string,
  snapshot: ServiceManagerStateSnapshot
): Promise<void> {
  await atomicWriteFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, {
    allowDirectWriteFallback: false,
    durable: true
  })
  await chmodOwnerOnly(path)
}

async function recoverCorruptManagerState(
  path: string,
  reason: string
): Promise<ServiceManagerState> {
  const backupPath = `${path}.corrupt-${Date.now()}-${randomUUID()}`
  await copyFile(path, backupPath, constants.COPYFILE_EXCL)
  await chmodOwnerOnly(backupPath)

  const state = new ServiceManagerState()
  await writePersistedManagerState(path, state.durableSnapshot())
  console.warn(`[kun-manager] recovered corrupt manager state (${reason}); backup: ${backupPath}`)
  return state
}

async function chmodOwnerOnly(path: string): Promise<void> {
  await chmod(path, 0o600).catch((error) => {
    if (process.platform !== 'win32') throw error
  })
}

function errorCode(error: unknown): string {
  return String((error as { code?: unknown })?.code ?? '')
}
