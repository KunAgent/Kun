import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { atomicWriteFile } from '../../kun/src/adapters/file/atomic-write.js'
import {
  SETTINGS_FILE_NAME,
  settingsReadCandidates
} from './settings-file-paths'
import {
  applyKunRuntimePatch,
  DEFAULT_GUI_UPDATE_CHANNEL,
  DEFAULT_CHECKPOINT_CLEANUP_ENABLED,
  DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS,
  DEFAULT_GIT_CHECKPOINT_CREATE_ENABLED,
  DEFAULT_CURSOR_SPOTLIGHT_COLOR,
  DEFAULT_GIT_BRANCH_PREFIX,
  DEFAULT_LOG_RETENTION_DAYS,
  DEFAULT_WRITE_WORKSPACE_ROOT,
  DEFAULT_WRITE_WELCOME_FILE_NAME,
  defaultClawSettings,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultDesignSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  getKunRuntimeSettings,
  kunRuntimeTuningDefaultsMigrationNeeded,
  mergeModelProviderSettings,
  defaultWriteSettings,
  mergeClawSettings,
  mergeAppBehaviorSettings,
  mergeDesignSettings,
  mergeScheduleSettings,
  mergeWorkflowSettings,
  mergeWriteSettings,
  defaultTerminalSettings,
  mergeTerminalSettings,
  DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX,
  DEFAULT_COMPOSER_SEND_KEY,
  DEFAULT_UI_FONT_SCALE,
  normalizeAppBehaviorSettings,
  normalizeCheckpointCleanupSettings,
  normalizeGitBranchPrefix,
  normalizeKeyboardShortcuts,
  normalizeAppSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ClawImChannelV1,
  type ClawImConversationV1,
  type KunRuntimeTuningSettingsV1
} from '../shared/app-settings'

import {
  JsonSettingsStoreOptions,
  SettingsCredentialMigrationResult,
  applySettingsPatchToSnapshot,
  buildMergedSettings,
  ensureManagedWorkspaceRootsExist,
  hasLegacyProviderPlaintext,
  isDocumentRevisionConflict,
  isErrnoException,
  isRecord,
  loadDefaultSettings,
  normalizeStoredSettings,
  readLegacyCredentialSettingsBackup,
  readSettingsFileWithCompatibility,
  replaceInvalidSettingsWithDefaults,
  serializeSettingsForDisk,
  storedKunRuntimeTuning,
  writeLegacyCredentialSettingsBackup,
  assertSupportedSettingsVersion
} from './settings-store-foundation'

export class JsonSettingsStore {
  private path: string
  private cache: AppSettingsV1 | null = null
  private documentRevision: number | undefined
  private operationTail: Promise<void> = Promise.resolve()

  constructor(
    userDataPath: string,
    private readonly options: JsonSettingsStoreOptions = {}
  ) {
    this.path = join(userDataPath, SETTINGS_FILE_NAME)
  }

  load(): Promise<AppSettingsV1> {
    return this.enqueueOperation(() => this.loadOnce())
  }

  private async loadOnce(): Promise<AppSettingsV1> {
    const document = this.options.documentBackend
      ? await this.options.documentBackend.read()
      : undefined
    const lastValidCache = this.cache
    if (this.cache && (!document || document.revision === this.documentRevision)) return this.cache
    if (document) {
      this.cache = null
      this.documentRevision = document.revision
    }

    let raw = ''
    let sourcePath = this.path
    try {
      const loaded = document
        ? (document.value === null ? null : { raw: document.value, sourcePath: this.path })
        : await readSettingsFileWithCompatibility(this.path)
      if (!loaded) {
        this.cache = await loadDefaultSettings()
        return this.cache
      }
      raw = loaded.raw
      sourcePath = loaded.sourcePath
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to read settings file ${sourcePath}: ${message}`, { cause: error })
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      if (error instanceof SyntaxError) {
        if (lastValidCache) {
          console.warn('[kun-gui] Ignoring invalid externally modified settings; retaining the last valid snapshot.', {
            sourcePath,
            reason: 'invalid JSON'
          })
          this.cache = lastValidCache
          return lastValidCache
        }
        return replaceInvalidSettingsWithDefaults(
          (defaults) => this.saveOnce(defaults),
          sourcePath,
          raw,
          'invalid JSON'
        )
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to parse settings file ${sourcePath}: ${message}`, { cause: error })
    }

    if (!isRecord(parsed)) {
      if (lastValidCache) {
        console.warn('[kun-gui] Ignoring invalid externally modified settings; retaining the last valid snapshot.', {
          sourcePath,
          reason: 'top-level value is not an object'
        })
        this.cache = lastValidCache
        return lastValidCache
      }
      return replaceInvalidSettingsWithDefaults(
        (defaults) => this.saveOnce(defaults),
        sourcePath,
        raw,
        'top-level value is not an object'
      )
    }

    assertSupportedSettingsVersion(parsed, sourcePath)

    const persistRuntimeTuningDefaultsMigration = (() => {
      const runtimeTuning = storedKunRuntimeTuning(parsed)
      return runtimeTuning !== undefined &&
        kunRuntimeTuningDefaultsMigrationNeeded(runtimeTuning)
    })()
    const normalized = normalizeStoredSettings(buildMergedSettings(parsed as Partial<AppSettingsV1>))
    await ensureManagedWorkspaceRootsExist(normalized)
    const prepared = normalized
    await this.repairRefreshableCredentialsFromBackup(prepared, sourcePath)
    if (this.options.credentialMigration && hasLegacyProviderPlaintext(prepared)) {
      const backupPath = await writeLegacyCredentialSettingsBackup(sourcePath, raw)
      if (!backupPath) {
        throw new Error(
          'Legacy credential migration was blocked because a protected settings backup could not be written'
        )
      }
    }
    const migration = await this.prepareCredentialMigration(prepared, false)
    if (migration === undefined) {
      this.cache = prepared
      if (sourcePath !== this.path || persistRuntimeTuningDefaultsMigration) {
        if (this.rejectsPlaintextCredentials(prepared)) {
          console.warn(
            '[kun-gui] Settings compatibility rewrite deferred because protected credential storage is unavailable.'
          )
        } else {
          await this.saveOnce(prepared)
        }
      }
      return this.cache
    }
    if (migration === null) {
      this.cache = prepared
      return this.cache
    }

    const shouldPersist =
      sourcePath !== this.path ||
      migration.removedPlaintext ||
      persistRuntimeTuningDefaultsMigration
    if (shouldPersist) {
      try {
        await this.persistSettings(migration.persistedSettings)
      } catch (error) {
        await migration.rollback().catch(() => undefined)
        throw new Error(
          'Legacy credential migration could not commit secret-free settings',
          { cause: error }
        )
      }
    }
    await migration.commit().catch((error) => {
      console.warn('[kun-gui] Legacy credential migration commit marker is pending recovery.', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
    this.cache = migration.runtimeSettings
    return this.cache
  }

  save(data: AppSettingsV1): Promise<void> {
    return this.enqueueOperation(() => this.saveOnce(data))
  }

  private async saveOnce(data: AppSettingsV1, expectedRevision = this.documentRevision): Promise<void> {
    assertSupportedSettingsVersion(data, this.path)
    const normalized = normalizeStoredSettings(data)
    await ensureManagedWorkspaceRootsExist(normalized)
    const prepared = normalized
    if (this.rejectsPlaintextCredentials(prepared)) {
      throw new Error(
        'Protected credential storage is unavailable while Kun Runtime data migration is blocked; settings containing plaintext credentials were not written'
      )
    }
    if (this.options.credentialMigration && hasLegacyProviderPlaintext(prepared)) {
      const currentRaw = this.options.documentBackend
        ? (await this.options.documentBackend.read()).value ?? serializeSettingsForDisk(prepared)
        : await readFile(this.path, 'utf8').catch((error) => {
            if (isErrnoException(error) && error.code === 'ENOENT') return serializeSettingsForDisk(prepared)
            throw error
          })
      const backupPath = await writeLegacyCredentialSettingsBackup(this.path, currentRaw)
      if (!backupPath) {
        throw new Error('Failed to create the pre-migration settings backup; ordinary settings were not changed')
      }
    }
    const migration = await this.prepareCredentialMigration(prepared, true)
    if (migration === undefined) {
      await this.persistSettings(prepared, expectedRevision)
      this.cache = prepared
      return
    }
    if (migration === null) throw new Error('Legacy credential migration is unavailable')
    try {
      await this.persistSettings(migration.persistedSettings, expectedRevision)
    } catch (error) {
      await migration.rollback().catch(() => undefined)
      throw error
    }
    await migration.commit().catch((error) => {
      console.warn('[kun-gui] Legacy credential migration commit marker is pending recovery.', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
    this.cache = migration.runtimeSettings
  }

  patch(partial: AppSettingsPatch): Promise<AppSettingsV1> {
    return this.enqueueOperation(() => this.mutateWithRevisionRetry((current) =>
      applySettingsPatchToSnapshot(current, partial)
    ))
  }

  /**
   * Atomically derive and persist one snapshot from the latest settings.
   * The mutation may be evaluated twice after a Manager revision conflict, so
   * it must not perform external side effects.
   */
  update(
    mutation: (current: AppSettingsV1) => AppSettingsV1 | Promise<AppSettingsV1>
  ): Promise<AppSettingsV1> {
    return this.enqueueOperation(() => this.mutateWithRevisionRetry(mutation))
  }

  /** Atomically re-check a condition after any Manager revision retry. */
  updateIf(
    predicate: (current: AppSettingsV1) => boolean,
    mutation: (current: AppSettingsV1) => AppSettingsV1 | Promise<AppSettingsV1>
  ): Promise<{ settings: AppSettingsV1; applied: boolean }> {
    return this.enqueueOperation(async () => {
      let applied = false
      const settings = await this.mutateWithRevisionRetry(async (current) => {
        applied = false
        if (!predicate(current)) return current
        applied = true
        return mutation(current)
      })
      return { settings, applied }
    })
  }

  private enqueueOperation<Value>(operation: () => Promise<Value>): Promise<Value> {
    const result = this.operationTail.then(
      operation,
      operation
    )
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private async mutateWithRevisionRetry(
    mutation: (current: AppSettingsV1) => AppSettingsV1 | Promise<AppSettingsV1>
  ): Promise<AppSettingsV1> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await this.loadOnce()
      const expectedRevision = this.documentRevision
      const next = await mutation(current)
      if (next === current) return current
      try {
        await this.saveOnce(next, expectedRevision)
        return this.cache ?? next
      } catch (error) {
        if (
          attempt === 0 &&
          this.options.documentBackend &&
          isDocumentRevisionConflict(error)
        ) {
          this.cache = null
          this.documentRevision = undefined
          continue
        }
        throw error
      }
    }
    throw new Error('Settings mutation revision retry exhausted')
  }

  private async prepareCredentialMigration(
    settings: AppSettingsV1,
    replaceCommitted: boolean
  ): Promise<SettingsCredentialMigrationResult | null | undefined> {
    if (!this.options.credentialMigration) return undefined
    try {
      return await this.options.credentialMigration.prepare(settings, {
        replaceCommitted,
        ...(replaceCommitted && this.cache ? { previousSettings: this.cache } : {})
      })
    } catch (error) {
      if (replaceCommitted) throw error
      if (hasLegacyProviderPlaintext(settings)) {
        throw new Error(
          'Legacy provider credentials could not be moved to protected storage',
          { cause: error }
        )
      }
      console.warn('[kun-gui] Legacy credential migration is unavailable; retaining compatibility settings.', {
        message: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  private async repairRefreshableCredentialsFromBackup(
    settings: AppSettingsV1,
    sourcePath: string
  ): Promise<void> {
    const credentialMigration = this.options.credentialMigration
    const repair = credentialMigration?.repairRefreshableCredentialsFromBackup
    if (!repair || hasLegacyProviderPlaintext(settings)) return
    const backup = await readLegacyCredentialSettingsBackup(sourcePath)
    if (!backup) return
    try {
      const repairedSourceIds = await repair.call(credentialMigration, settings, backup)
      if (repairedSourceIds.length > 0) {
        console.info('[kun-gui] Recovered refreshable OAuth credentials from the protected migration backup.', {
          sourceIds: repairedSourceIds
        })
      }
    } catch (error) {
      console.warn('[kun-gui] Refreshable OAuth credential recovery was skipped.', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private rejectsPlaintextCredentials(settings: AppSettingsV1): boolean {
    return this.options.rejectPlaintextCredentials === true &&
      !this.options.credentialMigration &&
      hasLegacyProviderPlaintext(settings)
  }

  private async persistSettings(
    settings: AppSettingsV1,
    expectedRevision = this.documentRevision
  ): Promise<void> {
    const serialized = serializeSettingsForDisk(settings)
    if (this.options.documentBackend) {
      const revision = expectedRevision ?? (await this.options.documentBackend.read()).revision
      const committed = await this.options.documentBackend.write(revision, serialized)
      this.documentRevision = committed.revision
      return
    }
    await mkdir(dirname(this.path), { recursive: true })
    await atomicWriteFile(this.path, serialized)
  }
}
