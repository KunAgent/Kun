import { randomBytes, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import type { DeviceIdentity } from '@kun/remote-protocol'
async function requireSecureStorage(): Promise<void> {
  const available =
    process.platform === 'darwin'
      ? await safeStorage.isAsyncEncryptionAvailable()
      : safeStorage.isEncryptionAvailable()
  if (
    !available ||
    (process.platform === 'linux' &&
      ['basic_text', 'unknown'].includes(
        safeStorage.getSelectedStorageBackend()
      ))
  )
    throw new Error('SECURE_STORAGE_REQUIRED')
}
export async function loadIdentity(path: string): Promise<DeviceIdentity> {
  await requireSecureStorage()
  try {
    const bytes = await readFile(path)
    const text =
      process.platform === 'darwin'
        ? (await safeStorage.decryptStringAsync(bytes)).result
        : safeStorage.decryptString(bytes)
    const value = JSON.parse(text)
    if (
      !/^[a-f0-9-]{36}$/.test(value.id) ||
      !/^[a-f0-9]{64}$/.test(value.credential)
    )
      throw new Error('INVALID_IDENTITY')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return writeIdentity(path)
}

/** Explicit recovery only: keep the rejected identity encrypted and leave remote access off. */
export async function resetIdentity(path: string): Promise<DeviceIdentity> {
  await requireSecureStorage()
  return writeIdentity(path, await readFile(path))
}

async function writeIdentity(path: string, previous?: Buffer): Promise<DeviceIdentity> {
  const value = {
    id: randomUUID(),
    credential: randomBytes(32).toString('hex')
  }
  const encrypted =
    process.platform === 'darwin'
      ? await safeStorage.encryptStringAsync(JSON.stringify(value))
      : safeStorage.encryptString(JSON.stringify(value))
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' })
    if (previous) {
      if (!(await readFile(path)).equals(previous)) throw new Error('IDENTITY_CHANGED')
      await copyFile(path, path + '.revoked-' + randomUUID() + '.bak', constants.COPYFILE_EXCL)
    }
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
  return value
}
