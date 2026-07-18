import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AtomicJsonFile } from './atomic-json.js'
import { extensionError } from './errors.js'
import type { ExtensionManager } from './manager.js'
import type {
  ExtensionPackageLifecycle,
  VersionSwitchContext
} from './package-manager.js'
import { assertExtensionId } from './paths.js'
import {
  ExtensionRegistry,
  type ExtensionRegistrySwitchSnapshot,
  type ExtensionVersionSwitchTarget
} from './registry.js'
import {
  ExtensionStateStore,
  type ExtensionStateData,
  type ExtensionStateDocument,
  type ExtensionStateVersionSwitchTransaction
} from './state-store.js'
import type { DevelopmentExtensionRecord, JsonValue } from './types.js'

const VERSION_SWITCH_JOURNAL_SCHEMA_VERSION = 1 as const
const HOST_OWNED_STATE_PREFIX = '__kun_'

type VersionSwitchJournal = {
  schemaVersion: typeof VERSION_SWITCH_JOURNAL_SCHEMA_VERSION
  transactionId: string
  extensionId: string
  phase: 'started' | 'state-prepared' | 'selection-committed'
  reason: VersionSwitchContext['reason']
  target: ExtensionVersionSwitchTarget
  registryBefore: ExtensionRegistrySwitchSnapshot
  stateExistedBefore: boolean
  fromStateSchema: number
  toStateSchema: number
  backupName: string
  backupDigest: string
  targetStateDigest?: string
  startedAt: string
}

/**
 * Coordinates package selection with extension state as one recoverable
 * transaction. The journal deliberately lives outside immutable package
 * directories, and remains until both state and registry selection are
 * durable. Recovery is idempotent and always runs before activation.
 */
export class ExtensionStateMigrationCoordinator {
  private readonly operations = new Map<string, Promise<unknown>>()

  constructor(
    private readonly stateStore: ExtensionStateStore,
    private readonly manager: ExtensionManager,
    private readonly registry: ExtensionRegistry
  ) {}

  lifecycle(): ExtensionPackageLifecycle {
    return {
      runVersionSwitch: (context, commitSelection) =>
        this.runVersionSwitch(context, commitSelection),
      recoverVersionSwitch: (extensionId) => this.recover(extensionId),
      recoverVersionSwitches: () => this.recoverAll(),
      beforeDisable: (extensionId, workspaceKey) => workspaceKey === undefined
        ? this.manager.deactivate(extensionId)
        : this.manager.deactivateWorkspace(extensionId, workspaceKey),
      beforeUninstall: (extensionId) => this.manager.deactivate(extensionId)
    }
  }

  async recoverAll(): Promise<void> {
    const entries = await readdir(this.stateStore.paths.dataRoot, { withFileTypes: true })
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
        throw error
      })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        assertExtensionId(entry.name)
      } catch {
        continue
      }
      await this.recover(entry.name)
    }
  }

  async recover(extensionId: string): Promise<void> {
    assertExtensionId(extensionId)
    await this.serialize(extensionId, async () => {
      await this.recoverUnlocked(extensionId)
    })
  }

  private async runVersionSwitch(
    context: VersionSwitchContext,
    commitSelection: () => Promise<void>
  ): Promise<void> {
    await this.serialize(context.extensionId, async () => {
      await this.recoverUnlocked(context.extensionId)
      await this.manager.deactivate(context.extensionId)
      const target = versionSwitchTarget(context)
      const registryBefore = await this.registry.captureVersionSwitch(
        context.extensionId,
        target
      )
      await this.stateStore.runVersionSwitchTransaction(
        context.extensionId,
        async (transaction) => {
          const targetSchema = context.to.manifest.stateSchemaVersion
          // A genuinely fresh install has no committed state to migrate: its
          // empty namespace starts at the selected package's declared schema.
          // If preserved state exists after uninstall, read() returns that
          // document instead of this fallback and normal migration still runs.
          const initialSchema = context.from?.manifest.stateSchemaVersion ?? targetSchema
          const stateExistedBefore = await transaction.exists()
          const current = await transaction.read(initialSchema)
          const transactionId = randomUUID()
          const backup = await transaction.createRecoverySnapshot(
            transactionId,
            current
          )
          const journal: VersionSwitchJournal = {
            schemaVersion: VERSION_SWITCH_JOURNAL_SCHEMA_VERSION,
            transactionId,
            extensionId: context.extensionId,
            phase: 'started',
            reason: context.reason,
            target,
            registryBefore,
            stateExistedBefore,
            fromStateSchema: current.schemaVersion,
            toStateSchema: targetSchema,
            backupName: backup.backupName,
            backupDigest: backup.digest,
            startedAt: new Date().toISOString()
          }
          const journalFile = this.journalFile(context.extensionId)
          await journalFile.write(journal)

          try {
            const prepared = await this.prepareState(
              context,
              current.schemaVersion,
              targetSchema,
              transaction
            )
            // Persist even an empty fresh-install document. Without this
            // write, a later default read would fall back to schema 0 despite
            // the package having committed a higher initial schema.
            await transaction.replace(prepared)
            journal.phase = 'state-prepared'
            journal.targetStateDigest = transaction.digest(prepared)
            await journalFile.write(journal)
            await commitSelection()
          } catch (error) {
            await this.rollbackPreparedSwitch(journal, transaction, error)
          }

          // Selection is now the durable commit point. Marker finalization is
          // best-effort: startup recovery also recognizes the selected target
          // plus its committed schema if a power loss occurs here.
          journal.phase = 'selection-committed'
          await journalFile.write(journal).catch(() => undefined)
          await rm(journalFile.path, { force: true }).catch(() => undefined)
        }
      )
    })
  }

  private async prepareState(
    context: VersionSwitchContext,
    currentSchema: number,
    targetSchema: number,
    transaction: ExtensionStateVersionSwitchTransaction
  ) {
    if (targetSchema === currentSchema) return transaction.read(currentSchema)
    if (targetSchema < currentSchema) {
      const current = await transaction.read(currentSchema)
      const restored = await transaction.restoreCompatibleSnapshot(targetSchema)
      return preserveHostOwnedState(restored, current)
    }
    if (context.to.manifest.main === undefined) {
      throw extensionError(
        'EXTENSION_STATE_MIGRATION_UNAVAILABLE',
        'State schema upgrades require a Node main entrypoint with migrateState',
        {
          extensionId: context.extensionId,
          from: currentSchema,
          to: targetSchema
        }
      )
    }
    return transaction.migrate(
      targetSchema,
      async (from, to, state, signal) => {
        const globalState = splitHostOwnedState(state.global)
        const migratedGlobal = await this.manager.migrateState(
          context.to,
          from,
          to,
          globalState.extension as unknown as JsonValue,
          { scope: 'global', signal }
        )
        const global = mergeHostOwnedState(
          parseStateNamespace(migratedGlobal, 'global'),
          globalState.host
        )
        const workspaces: ExtensionStateData['workspaces'] = {}
        for (const [workspaceKey, workspaceState] of Object.entries(state.workspaces)) {
          if (signal.aborted) {
            throw extensionError(
              'EXTENSION_STATE_MIGRATION_TIMEOUT',
              'Extension state migration was cancelled',
              { extensionId: context.extensionId, from, to }
            )
          }
          const scopedState = splitHostOwnedState(workspaceState)
          const migratedWorkspace = await this.manager.migrateState(
            context.to,
            from,
            to,
            scopedState.extension as unknown as JsonValue,
            { scope: 'workspace', signal }
          )
          workspaces[workspaceKey] = mergeHostOwnedState(
            parseStateNamespace(migratedWorkspace, 'workspace'),
            scopedState.host
          )
        }
        return { global, workspaces }
      }
    )
  }

  private async rollbackPreparedSwitch(
    journal: VersionSwitchJournal,
    transaction: ExtensionStateVersionSwitchTransaction,
    originalError: unknown
  ): Promise<never> {
    try {
      if (journal.stateExistedBefore) {
        await transaction.restoreRecoverySnapshot(
          journal.backupName,
          journal.backupDigest
        )
      } else {
        await transaction.remove()
      }
      await this.registry.restoreVersionSwitch(journal.registryBefore, journal.target)
      await this.removeUncommittedInstalledTarget(journal)
      await rm(this.journalFile(journal.extensionId).path, { force: true })
    } catch (rollbackError) {
      throw extensionError(
        'EXTENSION_VERSION_SWITCH_ROLLBACK_FAILED',
        'Extension version switch failed and durable rollback was unsuccessful',
        {
          extensionId: journal.extensionId,
          transactionId: journal.transactionId,
          fromStateSchema: journal.fromStateSchema,
          toStateSchema: journal.toStateSchema
        },
        rollbackError
      )
    }
    throw originalError
  }

  private async recoverUnlocked(extensionId: string): Promise<void> {
    const journal = await this.readJournal(extensionId)
    if (journal === undefined) return
    await this.manager.deactivate(extensionId)
    await this.stateStore.runVersionSwitchTransaction(extensionId, async (transaction) => {
      const state = await transaction.read(journal.fromStateSchema)
      const targetSelected = await this.registry.isVersionSwitchTargetSelected(
        extensionId,
        journal.target
      )
      if (targetSelected && state.schemaVersion === journal.toStateSchema) {
        await rm(this.journalFile(extensionId).path, { force: true })
        return
      }
      if (journal.stateExistedBefore) {
        await transaction.restoreRecoverySnapshot(
          journal.backupName,
          journal.backupDigest
        )
      } else {
        await transaction.remove()
      }
      await this.registry.restoreVersionSwitch(journal.registryBefore, journal.target)
      await this.removeUncommittedInstalledTarget(journal)
      await rm(this.journalFile(extensionId).path, { force: true })
    })
  }

  private async readJournal(extensionId: string): Promise<VersionSwitchJournal | undefined> {
    try {
      return await this.journalFile(extensionId).read(() => {
        throw extensionError(
          'EXTENSION_VERSION_SWITCH_JOURNAL_MISSING',
          'Version switch journal is missing'
        )
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined
      if ((error as { code?: string })?.code === 'EXTENSION_VERSION_SWITCH_JOURNAL_MISSING') {
        return undefined
      }
      throw error
    }
  }

  private journalFile(extensionId: string): AtomicJsonFile<VersionSwitchJournal> {
    return new AtomicJsonFile(
      join(this.stateStore.paths.stateDirectory(extensionId), 'version-switch.json'),
      validateVersionSwitchJournal
    )
  }

  private async removeUncommittedInstalledTarget(journal: VersionSwitchJournal): Promise<void> {
    if (
      journal.target.kind !== 'installed' ||
      journal.registryBefore.targetInstalledVersionExisted
    ) {
      return
    }
    const packagePath = this.stateStore.paths.packageVersion(
      journal.extensionId,
      journal.target.version
    )
    let details
    try {
      details = await lstat(packagePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return
      throw error
    }
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw extensionError(
        'EXTENSION_VERSION_SWITCH_RECOVERY_FAILED',
        'Uncommitted extension package path is not a safe directory',
        { extensionId: journal.extensionId, version: journal.target.version }
      )
    }
    await mkdir(this.stateStore.paths.stagingRoot, { recursive: true, mode: 0o700 })
    const quarantine = join(
      this.stateStore.paths.stagingRoot,
      `recovery-${journal.extensionId}-${journal.transactionId}`
    )
    await rm(quarantine, { recursive: true, force: true }).catch(() => undefined)
    await rename(packagePath, quarantine)
    await makeTreeWritable(quarantine)
    await rm(quarantine, { recursive: true, force: true })
  }

  private serialize<T>(extensionId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.operations.get(extensionId) ?? Promise.resolve()
    const result = prior.then(operation, operation)
    this.operations.set(extensionId, result.then(
      () => undefined,
      () => undefined
    ))
    return result
  }
}

function versionSwitchTarget(context: VersionSwitchContext): ExtensionVersionSwitchTarget {
  if (context.to.development) {
    const generation = context.to.generation
    if (generation === undefined) {
      throw extensionError(
        'EXTENSION_VERSION_SWITCH_JOURNAL_INVALID',
        'Development version switch target has no generation',
        { extensionId: context.extensionId }
      )
    }
    return { kind: 'development', version: context.to.version, generation }
  }
  return { kind: 'installed', version: context.to.version }
}

function validateVersionSwitchJournal(value: unknown): VersionSwitchJournal {
  if (
    !isRecord(value) ||
    value.schemaVersion !== VERSION_SWITCH_JOURNAL_SCHEMA_VERSION ||
    typeof value.transactionId !== 'string' ||
    !/^[a-f0-9-]{16,64}$/i.test(value.transactionId) ||
    typeof value.extensionId !== 'string' ||
    !['started', 'state-prepared', 'selection-committed'].includes(String(value.phase)) ||
    !['install', 'select', 'rollback', 'development-register', 'development-reload'].includes(String(value.reason)) ||
    !isVersionSwitchTarget(value.target) ||
    !isRegistrySnapshot(value.registryBefore, value.extensionId) ||
    typeof value.stateExistedBefore !== 'boolean' ||
    !Number.isSafeInteger(value.fromStateSchema) ||
    (value.fromStateSchema as number) < 0 ||
    !Number.isSafeInteger(value.toStateSchema) ||
    (value.toStateSchema as number) < 0 ||
    typeof value.backupName !== 'string' ||
    typeof value.backupDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.backupDigest) ||
    (value.targetStateDigest !== undefined &&
      (typeof value.targetStateDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.targetStateDigest))) ||
    typeof value.startedAt !== 'string' ||
    Number.isNaN(Date.parse(value.startedAt))
  ) {
    throw extensionError(
      'EXTENSION_VERSION_SWITCH_JOURNAL_INVALID',
      'Persisted extension version switch journal is invalid'
    )
  }
  assertExtensionId(value.extensionId)
  return value as unknown as VersionSwitchJournal
}

function isVersionSwitchTarget(value: unknown): value is ExtensionVersionSwitchTarget {
  if (!isRecord(value) || typeof value.version !== 'string' || value.version.length === 0) {
    return false
  }
  if (value.kind === 'installed') return true
  return value.kind === 'development' &&
    Number.isSafeInteger(value.generation) &&
    (value.generation as number) >= 1
}

function isRegistrySnapshot(
  value: unknown,
  extensionId: unknown
): value is ExtensionRegistrySwitchSnapshot {
  if (
    !isRecord(value) ||
    value.extensionId !== extensionId ||
    typeof value.entryExisted !== 'boolean' ||
    typeof value.useDevelopment !== 'boolean' ||
    typeof value.targetInstalledVersionExisted !== 'boolean' ||
    !isRecord(value.workspacePermissionGrants)
  ) {
    return false
  }
  if (value.selectedVersion !== undefined && typeof value.selectedVersion !== 'string') return false
  if (value.previousSelectedVersion !== undefined && typeof value.previousSelectedVersion !== 'string') return false
  for (const [workspaceKey, permissions] of Object.entries(value.workspacePermissionGrants)) {
    if (
      !/^[a-f0-9]{64}$/.test(workspaceKey) ||
      !Array.isArray(permissions) ||
      permissions.some((permission) => typeof permission !== 'string')
    ) {
      return false
    }
  }
  return value.development === undefined || isDevelopmentRecordShape(value.development)
}

function isDevelopmentRecordShape(value: unknown): value is DevelopmentExtensionRecord {
  return isRecord(value) &&
    typeof value.path === 'string' &&
    typeof value.digest === 'string' &&
    isRecord(value.manifest) &&
    Array.isArray(value.requestedPermissions) &&
    Array.isArray(value.grantedPermissions) &&
    typeof value.registeredAt === 'string' &&
    typeof value.reloadedAt === 'string' &&
    Number.isSafeInteger(value.generation) &&
    value.mutable === true
}

function parseStateNamespace(
  value: JsonValue,
  scope: 'global' | 'workspace'
): Record<string, JsonValue> {
  if (!isRecord(value)) {
    throw extensionError(
      'EXTENSION_STATE_MIGRATION_RESULT_INVALID',
      `migrateState must return an object for ${scope} state`
    )
  }
  return value as Record<string, JsonValue>
}

function splitHostOwnedState(namespace: Record<string, JsonValue>): {
  extension: Record<string, JsonValue>
  host: Record<string, JsonValue>
} {
  const extension: Record<string, JsonValue> = {}
  const host: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(namespace)) {
    if (key.startsWith(HOST_OWNED_STATE_PREFIX)) host[key] = structuredClone(value)
    else extension[key] = structuredClone(value)
  }
  return { extension, host }
}

function mergeHostOwnedState(
  migrated: Record<string, JsonValue>,
  host: Record<string, JsonValue>
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(migrated)) {
    if (key.startsWith(HOST_OWNED_STATE_PREFIX)) {
      throw extensionError(
        'EXTENSION_STATE_MIGRATION_RESULT_INVALID',
        `migrateState cannot write the host-owned state key: ${key}`
      )
    }
    result[key] = structuredClone(value)
  }
  for (const [key, value] of Object.entries(host)) result[key] = structuredClone(value)
  return result
}

function preserveHostOwnedState(
  restored: ExtensionStateDocument,
  current: ExtensionStateDocument
): ExtensionStateDocument {
  const currentGlobal = splitHostOwnedState(current.global).host
  restored.global = mergeHostOwnedState(
    splitHostOwnedState(restored.global).extension,
    currentGlobal
  )
  const workspaceKeys = new Set([
    ...Object.keys(restored.workspaces),
    ...Object.keys(current.workspaces)
  ])
  for (const workspaceKey of workspaceKeys) {
    const restoredWorkspace = splitHostOwnedState(restored.workspaces[workspaceKey] ?? {})
    const currentHost = splitHostOwnedState(current.workspaces[workspaceKey] ?? {}).host
    const merged = mergeHostOwnedState(restoredWorkspace.extension, currentHost)
    if (Object.keys(merged).length === 0) delete restored.workspaces[workspaceKey]
    else restored.workspaces[workspaceKey] = merged
  }
  return restored
}

async function makeTreeWritable(root: string): Promise<void> {
  if (process.platform === 'win32') return
  const details = await lstat(root)
  if (details.isSymbolicLink()) return
  if (!details.isDirectory()) {
    await chmod(root, 0o600)
    return
  }
  await chmod(root, 0o700)
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) await makeTreeWritable(path)
    else await chmod(path, 0o600)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
