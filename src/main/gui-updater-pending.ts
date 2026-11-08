import { app } from 'electron'
import { readFile, readdir, realpath, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { basename, join, resolve } from 'node:path'
import { commonInstallerRecoveryRoot, installerRecoveryIdentity, recoveryPathApi, registeredInstallerLocations, trustedCommonRecoveryFile } from './installer-recovery-identity'
import { privilegedUpdateOperation } from './update-elevated-transaction'
import { atomicWriteFile } from './atomic-json-file'
import type { GuiUpdateChannel } from '../shared/gui-update'

export const PENDING_UPDATE_FILE = 'pending-update.json'
export const PENDING_UPDATE_RESULT_FILE = 'pending-update-result.json'
export const GUI_UPDATE_RECOVERY_FILE = 'gui-update-recovery.json'
export const GUI_UPDATE_BACKUP_GRACE_MS = 7 * 86_400_000
export const GUI_UPDATE_HEALTH_RETRY_MS = 6 * 60 * 60 * 1_000
export const GUI_UPDATE_MAX_HEALTH_ATTEMPTS = 3
export const KUN_PENDING_UPDATE_PATH = 'KUN_PENDING_UPDATE_PATH'
export const KUN_PENDING_UPDATE_RESULT = 'KUN_PENDING_UPDATE_RESULT'
export const KUN_INSTALLER_OLD_VERSION = 'KUN_INSTALLER_OLD_VERSION'
export const KUN_INSTALLER_NEW_VERSION = 'KUN_INSTALLER_NEW_VERSION'
export const PENDING_UPDATE_SCHEMA_VERSION = 1
export const PENDING_UPDATE_RESULT_SCHEMA_VERSION = 2

export const INSTALLER_RECOVERY_ENVIRONMENT_KEYS = [
  'KUN_INSTALLER_APP_EXECUTABLE',
  'KUN_INSTALLER_APP_GUID',
  'KUN_INSTALLER_AUTOMATIC_UPDATE',
  'KUN_INSTALLER_CANONICAL_LEAF',
  'KUN_INSTALLER_COMMON_DESKTOP',
  'KUN_INSTALLER_COMMON_PROGRAMS',
  'KUN_INSTALLER_CURRENT_DESKTOP',
  'KUN_INSTALLER_CURRENT_PROGRAMS',
  'KUN_INSTALLER_INSTALL_MODE',
  'KUN_INSTALLER_INSTALL_REGISTRY_KEY',
  'KUN_INSTALLER_JOURNAL',
  'KUN_INSTALLER_HEALTH_RESULT',
  'KUN_INSTALLER_PAYLOAD_BACKUP',
  'KUN_INSTALLER_PRESERVE_OTHER_SCOPE',
  'KUN_INSTALLER_PRODUCT_NAME',
  'KUN_INSTALLER_SECONDARY_SOURCE',
  'KUN_INSTALLER_SOURCE',
  'KUN_INSTALLER_STAGE',
  'KUN_INSTALLER_TARGET',
  'KUN_INSTALLER_TRANSACTION',
  'KUN_INSTALLER_UNINSTALL_REGISTRY_KEY'
] as const

export type InstallerRecoveryEnvironment = Partial<Record<
  typeof INSTALLER_RECOVERY_ENVIRONMENT_KEYS[number],
  string
>>

export type PendingUpdate = {
  schemaVersion: typeof PENDING_UPDATE_SCHEMA_VERSION
  state: 'installing'
  oldVersion: string
  newVersion: string
  installDir: string
  installerPath: string
  installerSha512?: string
  channel: GuiUpdateChannel
  writtenAt: string
  backupDir?: string
}

export type PendingUpdateResult = {
  schemaVersion: 1 | typeof PENDING_UPDATE_RESULT_SCHEMA_VERSION
  outcome: 'success' | 'aborted'
  code: string
  message: string
  at: string
  phase?: string
  backupDir?: string
  transactionState?: 'prepared' | 'payload_switched' | 'awaiting_health' | 'cleanup_pending' | 'committed' | 'rolling_back' | 'rolled_back' | 'rollback_incomplete' | ''
  rollbackOutcome?: 'not_started' | 'succeeded' | 'failed' | ''
  recoveryEnvironment?: InstallerRecoveryEnvironment
  recoveryAttempts?: number
  handoffFailureAttempts?: number
  handoffBlocked?: { at: string; message: string }
}

/** On-disk shape of the installer-owned `<guid>-update.json` transaction. */
export type InstallerUpdateTransaction = {
  installerPid?: number
  installerProcessIdentity?: string
  transactionPath: string
  schemaVersion: number
  phase: string
  oldVersion: string
  newVersion: string
  backupDir: string
  journalPath: string
  transactionRoot: string
  recoveryEnvironment: InstallerRecoveryEnvironment
}

export type GuiUpdateRecovery = {
  schemaVersion: 1 | 2
  installedVersion: string
  channel: GuiUpdateChannel
  verifiedAt: string
  healthAttempts: number
  bootAttempts?: number
  oldVersion?: string
  transactionRoot?: string
  journalPath?: string
  recoveryEnvironment?: InstallerRecoveryEnvironment
  nextHealthCheckAt?: string
  backupDir?: string
  backupExpiresAt: string
  lastError?: string
  handoffFailureAttempts?: number
  handoffBlocked?: { at: string; message: string }
}

export function pendingUpdatePath(userDataPath = app.getPath('userData')): string {
  return join(userDataPath, PENDING_UPDATE_FILE)
}

export function guiUpdateRecoveryPath(userDataPath = app.getPath('userData')): string {
  return join(userDataPath, GUI_UPDATE_RECOVERY_FILE)
}

export function pendingUpdateResultPath(userDataPath = app.getPath('userData')): string {
  return join(userDataPath, PENDING_UPDATE_RESULT_FILE)
}

async function writeAtomically(path: string, value: unknown): Promise<void> {
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function isPendingUpdate(value: unknown): value is PendingUpdate {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === PENDING_UPDATE_SCHEMA_VERSION &&
    record.state === 'installing' &&
    typeof record.oldVersion === 'string' &&
    typeof record.newVersion === 'string' &&
    typeof record.installDir === 'string' &&
    typeof record.installerPath === 'string' &&
    typeof record.channel === 'string' &&
    typeof record.writtenAt === 'string'
}

function isInstallerRecoveryEnvironment(value: unknown): value is InstallerRecoveryEnvironment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(([key, item]) =>
    (INSTALLER_RECOVERY_ENVIRONMENT_KEYS as readonly string[]).includes(key) &&
    typeof item === 'string' && !item.includes('\0')
  )
}

function isPendingUpdateResult(value: unknown): value is PendingUpdateResult {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (record.schemaVersion === PENDING_UPDATE_SCHEMA_VERSION ||
      record.schemaVersion === PENDING_UPDATE_RESULT_SCHEMA_VERSION) &&
    (record.outcome === 'success' || record.outcome === 'aborted') &&
    typeof record.code === 'string' &&
    typeof record.message === 'string' &&
    typeof record.at === 'string' &&
    (record.recoveryEnvironment === undefined || isInstallerRecoveryEnvironment(record.recoveryEnvironment)) &&
    (record.handoffFailureAttempts === undefined || typeof record.handoffFailureAttempts === 'number') &&
    (record.handoffBlocked === undefined || isHandoffBlockedMarker(record.handoffBlocked))
}

function isGuiUpdateRecovery(value: unknown): value is GuiUpdateRecovery {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (record.schemaVersion === 1 || record.schemaVersion === 2) && typeof record.installedVersion === 'string' &&
    (record.channel === 'stable' || record.channel === 'frontier') &&
    typeof record.verifiedAt === 'string' && typeof record.healthAttempts === 'number' &&
    typeof record.backupExpiresAt === 'string' &&
    (record.handoffFailureAttempts === undefined || typeof record.handoffFailureAttempts === 'number') &&
    (record.handoffBlocked === undefined || isHandoffBlockedMarker(record.handoffBlocked))
}

function isHandoffBlockedMarker(value: unknown): value is { at: string; message: string } {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.at === 'string' && typeof record.message === 'string'
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/u, '')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[kun-gui updater] ignored malformed pending update state:', error)
    }
    return null
  }
}

export async function readGuiUpdateRecovery(userDataPath?: string): Promise<GuiUpdateRecovery | null> {
  const value = await readJson(guiUpdateRecoveryPath(userDataPath))
  return isGuiUpdateRecovery(value) ? value : null
}

export async function writeGuiUpdateRecovery(
  recovery: Omit<GuiUpdateRecovery, 'schemaVersion'>,
  userDataPath?: string
): Promise<GuiUpdateRecovery> {
  const value: GuiUpdateRecovery = { schemaVersion: 2, ...recovery }
  await writeAtomically(guiUpdateRecoveryPath(userDataPath), value)
  return value
}

export async function clearGuiUpdateRecovery(userDataPath?: string): Promise<void> {
  await rm(guiUpdateRecoveryPath(userDataPath), { force: true })
}

export async function writePendingUpdate(
  update: Omit<PendingUpdate, 'schemaVersion' | 'state' | 'writtenAt'>,
  userDataPath?: string
): Promise<PendingUpdate> {
  const pending: PendingUpdate = {
    schemaVersion: PENDING_UPDATE_SCHEMA_VERSION,
    state: 'installing',
    writtenAt: new Date().toISOString(),
    ...update
  }
  await writeAtomically(pendingUpdatePath(userDataPath), pending)
  return pending
}

export async function readPendingUpdate(userDataPath?: string): Promise<PendingUpdate | null> {
  const pending = await readJson(pendingUpdatePath(userDataPath))
  return isPendingUpdate(pending) ? pending : null
}

export async function clearPendingUpdate(userDataPath?: string): Promise<void> {
  await rm(pendingUpdatePath(userDataPath), { force: true })
}

export function resolveBackupDeleteTarget(
  recoveryRoot: string,
  backupDir: string,
  pathApi: Pick<typeof path, 'basename' | 'isAbsolute' | 'join' | 'parse' | 'relative' | 'resolve'> = path
): string | null {
  const backupName = pathApi.basename(backupDir)
  if (!/^update-backup-\d+$/.test(backupName)) return null

  const root = pathApi.resolve(recoveryRoot)
  const backup = pathApi.resolve(backupDir)
  if (pathApi.parse(root).root !== pathApi.parse(backup).root) return null

  const relativePath = pathApi.relative(root, backup)
  if (!relativePath || pathApi.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes('..')) return null

  const target = pathApi.join(root, backupName)
  return backup === target ? target : null
}

export async function cleanupPendingUpdateBackup(backupDir?: string): Promise<void> {
  if (!backupDir || process.platform !== 'win32') return
  const recoveryRoot = resolve(app.getPath('appData'), 'KunInstallerRecovery')
  const target = resolveBackupDeleteTarget(recoveryRoot, backupDir)
  if (!target) return

  try {
    const realRoot = await realpath(recoveryRoot)
    const realTarget = await realpath(target)
    const expectedRealTarget = join(realRoot, basename(target))
    if (resolveBackupDeleteTarget(realRoot, realTarget) !== expectedRealTarget) return
    await rm(realTarget, { recursive: true, force: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[kun-gui updater] failed to clean update backup:', error)
    }
  }
}

export async function writePendingUpdateResult(
  result: Omit<PendingUpdateResult, 'schemaVersion' | 'at'>,
  userDataPath?: string
): Promise<PendingUpdateResult> {
  const pendingResult: PendingUpdateResult = {
    schemaVersion: PENDING_UPDATE_RESULT_SCHEMA_VERSION,
    at: new Date().toISOString(),
    ...result
  }
  await writeAtomically(pendingUpdateResultPath(userDataPath), pendingResult)
  return pendingResult
}

export async function readPendingUpdateResult(userDataPath?: string): Promise<PendingUpdateResult | null> {
  const result = await readJson(pendingUpdateResultPath(userDataPath))
  return isPendingUpdateResult(result) ? result : null
}

function installerRecoveryRoot(userDataPath = app.getPath('userData')): string {
  // The installer writes recovery state under the roaming profile next to the
  // per-flavor userData directory; mirror the path the installer uses.
  const paths = recoveryPathApi(userDataPath)
  return paths.resolve(paths.dirname(userDataPath), 'KunInstallerRecovery')
}

function mapTransactionFieldToEnvironmentKey(key: string): string | null {
  switch (key) {
    case 'KUN_INSTALLER_APP_EXECUTABLE': return 'AppExecutable'
    case 'KUN_INSTALLER_APP_GUID': return 'AppGuid'
    case 'KUN_INSTALLER_AUTOMATIC_UPDATE': return 'AutomaticUpdate'
    case 'KUN_INSTALLER_CANONICAL_LEAF': return 'CanonicalLeaf'
    case 'KUN_INSTALLER_COMMON_DESKTOP': return 'CommonDesktop'
    case 'KUN_INSTALLER_COMMON_PROGRAMS': return 'CommonPrograms'
    case 'KUN_INSTALLER_CURRENT_DESKTOP': return 'CurrentDesktop'
    case 'KUN_INSTALLER_CURRENT_PROGRAMS': return 'CurrentPrograms'
    case 'KUN_INSTALLER_INSTALL_MODE': return 'InstallMode'
    case 'KUN_INSTALLER_INSTALL_REGISTRY_KEY': return 'InstallRegistryKey'
    case 'KUN_INSTALLER_JOURNAL': return 'JournalPath'
    case 'KUN_INSTALLER_HEALTH_RESULT': return 'HealthResult'
    case 'KUN_INSTALLER_PAYLOAD_BACKUP': return 'BackupRoot'
    case 'KUN_INSTALLER_PRESERVE_OTHER_SCOPE': return 'PreserveOtherScope'
    case 'KUN_INSTALLER_PRODUCT_NAME': return 'ProductName'
    case 'KUN_INSTALLER_SECONDARY_SOURCE': return 'SecondarySource'
    case 'KUN_INSTALLER_SOURCE': return 'Source'
    case 'KUN_INSTALLER_STAGE': return 'StageRoot'
    case 'KUN_INSTALLER_TARGET': return 'Target'
    case 'KUN_INSTALLER_TRANSACTION': return 'TransactionPath'
    case 'KUN_INSTALLER_UNINSTALL_REGISTRY_KEY': return 'UninstallRegistryKey'
    default: return null
  }
}

function hasCompleteInstallerRecoveryEnvironment(
  environment: InstallerRecoveryEnvironment,
  transaction: Record<string, unknown>
): boolean {
  const required = [
    'KUN_INSTALLER_APP_EXECUTABLE',
    'KUN_INSTALLER_APP_GUID',
    'KUN_INSTALLER_CANONICAL_LEAF',
    'KUN_INSTALLER_INSTALL_MODE',
    'KUN_INSTALLER_INSTALL_REGISTRY_KEY',
    'KUN_INSTALLER_JOURNAL',
    'KUN_INSTALLER_SOURCE',
    'KUN_INSTALLER_STAGE',
    'KUN_INSTALLER_TARGET',
    'KUN_INSTALLER_TRANSACTION',
    'KUN_INSTALLER_UNINSTALL_REGISTRY_KEY'
  ] as const
  if (required.some((key) => !environment[key])) return false
  if (!Array.isArray(transaction.Shortcuts) || transaction.Shortcuts.length === 0) return true
  const shortcutRoots = environment.KUN_INSTALLER_INSTALL_MODE === 'all'
    ? ['KUN_INSTALLER_COMMON_DESKTOP', 'KUN_INSTALLER_COMMON_PROGRAMS'] as const
    : ['KUN_INSTALLER_CURRENT_DESKTOP', 'KUN_INSTALLER_CURRENT_PROGRAMS'] as const
  return shortcutRoots.every((key) => Boolean(environment[key]))
}

/**
 * Read the installer-owned transaction journal. It is the authoritative
 * rollback record: the GUI result file is only an execution summary and may
 * be missing when the installer dies between the payload cutover and its
 * result write. Default discovery verifies the running package identity and
 * installation across current-user and machine roots; ambiguous records fail closed.
 * An explicit recoveryRoot remains a caller-selected recovery journal source.
 */
export async function readInstallerUpdateTransaction(
  match: { oldVersion: string, newVersion: string, installDir?: string },
  options: {
    recoveryRoot?: string
    platform?: NodeJS.Platform
    readdirApi?: (dir: string) => Promise<string[]>
    readApi?: (path: string) => Promise<string>
  } = {}
): Promise<InstallerUpdateTransaction | null> {
  if ((options.platform ?? process.platform) !== 'win32') return null
  const explicitRoot = options.recoveryRoot
  const identity = explicitRoot === undefined ? installerRecoveryIdentity() : null
  const registrations = identity ? await registeredInstallerLocations(identity.appGuid) : []
  const paths = identity ? recoveryPathApi(identity.executable) : path
  const normalize = (value: string) => paths === path.win32 ? paths.resolve(value).toLowerCase() : paths.resolve(value)
  const runningDir = identity ? paths.dirname(identity.executable) : ''
  const sourceDir = match.installDir ?? runningDir
  const relevantDirectories = [sourceDir, runningDir, paths.join(paths.dirname(sourceDir), identity?.productName ?? '')]
  const hasMachineInstallation = registrations.some((registration) => registration.scope === 'all' &&
    relevantDirectories.some((directory) => {
      const registered = normalize(registration.installDir), expected = normalize(directory)
      const stagePrefix = expected + '.kun-stage-'
      return registered === expected || (registered.startsWith(stagePrefix) && /^\d+$/u.test(registered.slice(stagePrefix.length)))
    }))
  // A separate machine install must not introduce UAC into current-user recovery.
  const commonRoot = hasMachineInstallation ? await commonInstallerRecoveryRoot() : null
  const roots = explicitRoot !== undefined
    ? [{ root: explicitRoot, scope: '' }]
    : [{ root: installerRecoveryRoot(), scope: 'current' }, ...(commonRoot ? [{ root: commonRoot, scope: 'all' }] : [])]
  const candidates: InstallerUpdateTransaction[] = []
  const listDir = options.readdirApi ?? ((dir: string) => readdir(dir))
  const readFileBound = options.readApi ?? ((filePath: string) => readFile(filePath, 'utf8'))
  const entriesByRoot = await Promise.all(roots.map(async ({ root, scope }) => {
    try { return (await listDir(root)).map((entry) => ({ root, scope, entry })) }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (scope === 'all' && identity && (code === 'EACCES' || code === 'EPERM')) {
        return [{ root, scope, entry: `${identity.appGuid}-update.json` }]
      }
      return []
    }
  }))
  for (const { root, scope, entry } of entriesByRoot.flat()) {
    const paths = explicitRoot !== undefined ? path : recoveryPathApi(root)
    if (!entry.endsWith('-update.json') || paths.basename(entry) !== entry) continue
    const transactionPath = paths.join(root, entry)
    let value: unknown
    let privileged = false
    try {
      value = JSON.parse((await readFileBound(transactionPath)).replace(/^\uFEFF/u, '')) as unknown
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (scope !== 'all' || !identity || (code !== 'EACCES' && code !== 'EPERM')) continue
      // Permission denial is not absence. Only the constrained elevated reader
      // can inspect a protected transaction; refusal remains retryable.
      const reply = await privilegedUpdateOperation('inspect', { ...match,
        installDir: match.installDir ?? recoveryPathApi(identity.executable).dirname(identity.executable) })
      value = reply.transaction
      privileged = true
    }
    if (!value || typeof value !== 'object') continue
    const record = value as Record<string, unknown>
    if (String(record.OldVersion ?? '') !== match.oldVersion) continue
    if (String(record.NewVersion ?? '') !== match.newVersion) continue
    if (identity) {
      const samePath = (left: unknown, right: string) => {
        if (typeof left !== 'string' || !paths.isAbsolute(left) || !paths.isAbsolute(right)) return false
        const actual = paths.resolve(left), expected = paths.resolve(right)
        return paths === path.win32 ? actual.toLowerCase() === expected.toLowerCase() : actual === expected
      }
      const executablePaths = recoveryPathApi(identity.executable)
      const runningDirectory = executablePaths.dirname(identity.executable)
      const sourceDirectory = match.installDir ?? runningDirectory
      const canonicalTarget = paths.join(paths.dirname(sourceDirectory), identity.productName)
      if (record.SchemaVersion !== 4 ||
          String(record.AppGuid).toLowerCase() !== identity.appGuid.toLowerCase() ||
          entry.toLowerCase() !== `${identity.appGuid}-update.json`.toLowerCase() ||
          record.InstallMode !== scope || record.ProductName !== identity.productName ||
          record.AppExecutable !== executablePaths.basename(identity.executable) ||
          record.CanonicalLeaf !== identity.productName ||
          record.InstallRegistryKey !== `Software\\${identity.appGuid}` ||
          record.UninstallRegistryKey !== `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${identity.appGuid}` ||
          !samePath(record.Source, sourceDirectory) ||
          (!samePath(record.Target, sourceDirectory) && !samePath(record.Target, canonicalTarget)) ||
          (!samePath(record.Source, runningDirectory) && !samePath(record.Target, runningDirectory)) ||
          !samePath(record.JournalPath, paths.join(root, `${identity.appGuid}.json`)) ||
          typeof record.BackupRoot !== 'string' || !resolveBackupDeleteTarget(root, record.BackupRoot, paths) ||
          typeof record.StageRoot !== 'string' || !samePath(paths.dirname(record.StageRoot), paths.dirname(String(record.Target))) ||
          !paths.basename(record.StageRoot).startsWith(`${paths.basename(String(record.Target))}.kun-stage-`) ||
          !/^\d+$/u.test(paths.basename(record.StageRoot).slice(`${paths.basename(String(record.Target))}.kun-stage-`.length)) ||
          (record.TransactionPath !== undefined && !samePath(record.TransactionPath, transactionPath))) continue
      const scopes = new Set(registrations.filter((registration) =>
        samePath(record.Source, registration.installDir) || samePath(record.Target, registration.installDir) ||
        samePath(record.StageRoot, registration.installDir)
      ).map((registration) => registration.scope))
      if (scopes.size !== 1 || !scopes.has(scope)) continue
      if (scope === 'all' && !privileged && !await trustedCommonRecoveryFile(root, transactionPath)) continue
    }

    const recoveryEnvironment: InstallerRecoveryEnvironment = {}
    for (const key of INSTALLER_RECOVERY_ENVIRONMENT_KEYS) {
      const mapped = mapTransactionFieldToEnvironmentKey(key)
      const raw = mapped ? record[mapped] : undefined
      if (typeof raw === 'string' && raw.length > 0 && !raw.includes('\0')) {
        recoveryEnvironment[key] = raw
      }
    }
    recoveryEnvironment.KUN_INSTALLER_TRANSACTION = transactionPath
    if (!hasCompleteInstallerRecoveryEnvironment(recoveryEnvironment, record)) continue
    const journalPath = recoveryEnvironment.KUN_INSTALLER_JOURNAL
    if (!journalPath) continue

    candidates.push({
      ...(Number.isSafeInteger(record.InstallerPid) && Number(record.InstallerPid) > 0 &&
          typeof record.InstallerProcessIdentity === 'string' && /^win32-v1:\d{4}-.*Z$/u.test(record.InstallerProcessIdentity)
        ? { installerPid: Number(record.InstallerPid), installerProcessIdentity: record.InstallerProcessIdentity } : {}),
      transactionPath,
      schemaVersion: Number(record.SchemaVersion ?? 0),
      phase: String(record.Phase ?? ''),
      oldVersion: match.oldVersion,
      newVersion: match.newVersion,
      backupDir: typeof record.BackupRoot === 'string' ? record.BackupRoot : '',
      journalPath,
      transactionRoot: paths.dirname(transactionPath),
      recoveryEnvironment
    })
  }
  // Ambiguous matching transactions cannot safely authorize a rollback.
  return candidates.length === 1 ? candidates[0] : null
}

export async function clearPendingUpdateResult(userDataPath?: string): Promise<void> {
  await rm(pendingUpdateResultPath(userDataPath), { force: true })
}

export async function consumePendingUpdateResult(userDataPath?: string): Promise<PendingUpdateResult | null> {
  const result = await readPendingUpdateResult(userDataPath)
  if (result) await clearPendingUpdateResult(userDataPath)
  return result
}

export function setPendingUpdateEnvironment(
  pendingPath = pendingUpdatePath(),
  resultPath = pendingUpdateResultPath(),
  oldVersion = app.getVersion(),
  newVersion = '',
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): () => void {
  if (platform !== 'win32') return () => undefined
  const previous = [
    KUN_PENDING_UPDATE_PATH,
    KUN_PENDING_UPDATE_RESULT,
    KUN_INSTALLER_OLD_VERSION,
    KUN_INSTALLER_NEW_VERSION
  ].map((key) => ({
    key,
    hadValue: Object.prototype.hasOwnProperty.call(env, key),
    value: env[key]
  }))
  env[KUN_PENDING_UPDATE_PATH] = pendingPath
  env[KUN_PENDING_UPDATE_RESULT] = resultPath
  env[KUN_INSTALLER_OLD_VERSION] = oldVersion
  env[KUN_INSTALLER_NEW_VERSION] = newVersion
  return () => {
    for (const item of previous) {
      if (item.hadValue && item.value !== undefined) env[item.key] = item.value
      else delete env[item.key]
    }
  }
}
