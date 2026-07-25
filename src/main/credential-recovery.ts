import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  createSecretEncryptor,
  defaultSecretCommandRunner,
  isUnreadableCredentialKeyError,
  WINDOWS_DPAPI_KEY_PREFIX,
  type CommandRunner
} from '../../kun/src/security/secret-store.js'

const CREDENTIAL_RECOVERY_ITEMS = [
  'secret.key',
  'credentials',
  'mcp-oauth',
  'extensions/accounts.json',
  'extensions/provider-bindings.json',
  'extensions/legacy-credential-migrations.json'
] as const

export type CredentialRecoveryResult = {
  backupPath: string
  movedItems: string[]
}

type CredentialRecoveryOptions = {
  run?: CommandRunner
  now?: () => Date
  id?: () => string
  move?: typeof rename
}

export async function resetUnreadableWindowsCredentials(
  dataDir: string,
  options: CredentialRecoveryOptions = {}
): Promise<CredentialRecoveryResult> {
  const keyFilePath = join(dataDir, 'secret.key')
  const keyFileText = await readFile(keyFilePath, 'utf8').catch(() => '')
  if (!keyFileText.trim().startsWith(WINDOWS_DPAPI_KEY_PREFIX)) {
    throw new Error('Credential recovery is unavailable because no DPAPI-protected Kun key was found.')
  }

  let unreadable = false
  try {
    await createSecretEncryptor({
      keyFilePath,
      platform: 'win32',
      run: options.run ?? defaultSecretCommandRunner,
      disableOsKeychain: false
    })
  } catch (error) {
    if (!isUnreadableCredentialKeyError(error)) throw error
    unreadable = true
  }
  if (!unreadable) {
    throw new Error('Credential recovery is unnecessary because the DPAPI-protected Kun key is readable.')
  }

  const timestamp = (options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')
  const backupPath = join(
    dataDir,
    'credential-recovery',
    `${timestamp}-${(options.id?.() ?? randomUUID()).replace(/[^A-Za-z0-9_-]/g, '')}`
  )
  const movedItems: string[] = []
  const move = options.move ?? rename

  try {
    await mkdir(backupPath, { recursive: true, mode: 0o700 })
    for (const relativePath of CREDENTIAL_RECOVERY_ITEMS) {
      const sourcePath = join(dataDir, relativePath)
      if (!(await pathExists(sourcePath))) continue
      const destinationPath = join(backupPath, relativePath)
      await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 })
      await move(sourcePath, destinationPath)
      movedItems.push(relativePath)
    }
  } catch (error) {
    const rollbackFailures: string[] = []
    for (const relativePath of [...movedItems].reverse()) {
      const sourcePath = join(backupPath, relativePath)
      const destinationPath = join(dataDir, relativePath)
      await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 }).catch(() => undefined)
      await move(sourcePath, destinationPath).catch((rollbackError) => {
        rollbackFailures.push(
          `${relativePath}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
        )
      })
    }
    if (rollbackFailures.length === 0) {
      await rm(backupPath, { recursive: true, force: true }).catch(() => undefined)
    }
    throw new Error(
      [
        `Failed to back up unreadable credentials: ${error instanceof Error ? error.message : String(error)}`,
        ...(rollbackFailures.length > 0
          ? [`Rollback was incomplete; remaining backup data was kept at ${backupPath}. ${rollbackFailures.join('; ')}`]
          : [])
      ].join(' '),
      { cause: error }
    )
  }

  return { backupPath, movedItems }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    return !(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
  }
}
