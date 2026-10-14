import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import type { DeviceIdentity } from '@kun/remote-protocol'
export async function loadIdentity(path: string): Promise<DeviceIdentity> {
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
  await writeFile(temporary, encrypted, { mode: 0o600 })
  await rename(temporary, path)
  return value
}
