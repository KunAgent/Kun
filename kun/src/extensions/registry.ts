import { isAbsolute } from 'node:path'
import {
  ExtensionRegistrySchema as PublicExtensionRegistrySchema,
  type ExtensionRegistry as PublicExtensionRegistry
} from '@kun/extension-api'
import { AtomicJsonFile } from './atomic-json.js'
import { extensionError } from './errors.js'
import { assertCanonicalPackagePath, parseExtensionManifest, manifestId } from './manifest.js'
import { assertExtensionId, ExtensionPaths } from './paths.js'
import {
  EXTENSION_REGISTRY_SCHEMA_VERSION,
  type DevelopmentExtensionRecord,
  type ExtensionRegistryDocument,
  type ExtensionRegistryEntry,
  type InstalledExtensionVersion,
  type ResolvedExtension
} from './types.js'

export type RegisterVersionOptions = {
  select?: boolean
  enable?: boolean
}

export type ExtensionVersionSwitchTarget =
  | { kind: 'installed'; version: string }
  | { kind: 'development'; version: string; generation: number }

/**
 * Only the fields a version switch is allowed to change are snapshotted.
 * Keeping enablement outside this record prevents recovery from overwriting an
 * unrelated enable/disable decision that was durably committed concurrently.
 */
export type ExtensionRegistrySwitchSnapshot = {
  extensionId: string
  entryExisted: boolean
  selectedVersion?: string
  previousSelectedVersion?: string
  useDevelopment: boolean
  workspacePermissionGrants: Record<string, string[]>
  development?: DevelopmentExtensionRecord
  targetInstalledVersionExisted: boolean
}

export class ExtensionRegistry {
  private readonly file: AtomicJsonFile<ExtensionRegistryDocument>

  constructor(
    readonly paths: ExtensionPaths,
    private readonly now: () => Date = () => new Date()
  ) {
    this.file = new AtomicJsonFile(paths.registryFile, (value) => validateRegistryDocument(value, paths))
  }

  read(): Promise<ExtensionRegistryDocument> {
    return this.file.read(() => emptyRegistry(this.now()))
  }

  async publicSnapshot(): Promise<PublicExtensionRegistry> {
    return projectPublicRegistry(await this.read())
  }

  async get(extensionId: string): Promise<ExtensionRegistryEntry | undefined> {
    assertExtensionId(extensionId)
    const registry = await this.read()
    const entry = registry.extensions[extensionId]
    return entry === undefined ? undefined : structuredClone(entry)
  }

  async captureVersionSwitch(
    extensionId: string,
    target: ExtensionVersionSwitchTarget
  ): Promise<ExtensionRegistrySwitchSnapshot> {
    assertExtensionId(extensionId)
    assertVersionSwitchTarget(target)
    const entry = await this.get(extensionId)
    return {
      extensionId,
      entryExisted: entry !== undefined,
      ...(entry?.selectedVersion === undefined ? {} : { selectedVersion: entry.selectedVersion }),
      ...(entry?.previousSelectedVersion === undefined
        ? {}
        : { previousSelectedVersion: entry.previousSelectedVersion }),
      useDevelopment: entry?.useDevelopment ?? false,
      workspacePermissionGrants: structuredClone(entry?.workspacePermissionGrants ?? {}),
      ...(entry?.development === undefined
        ? {}
        : { development: structuredClone(entry.development) }),
      targetInstalledVersionExisted: target.kind === 'installed' && entry?.versions[target.version] !== undefined
    }
  }

  async isVersionSwitchTargetSelected(
    extensionId: string,
    target: ExtensionVersionSwitchTarget
  ): Promise<boolean> {
    assertExtensionId(extensionId)
    assertVersionSwitchTarget(target)
    const entry = await this.get(extensionId)
    if (entry === undefined) return false
    if (target.kind === 'installed') {
      return !entry.useDevelopment &&
        entry.selectedVersion === target.version &&
        entry.versions[target.version] !== undefined
    }
    return entry.useDevelopment &&
      entry.development?.manifest.version === target.version &&
      entry.development.generation === target.generation
  }

  /**
   * Restores just the package-selection fields captured before a switch. The
   * operation is idempotent so an interrupted recovery can safely repeat it.
   */
  async restoreVersionSwitch(
    snapshot: ExtensionRegistrySwitchSnapshot,
    target: ExtensionVersionSwitchTarget
  ): Promise<void> {
    assertVersionSwitchSnapshot(snapshot)
    assertVersionSwitchTarget(target)
    await this.mutate((registry) => {
      const current = registry.extensions[snapshot.extensionId]
      if (!snapshot.entryExisted) {
        delete registry.extensions[snapshot.extensionId]
        return registry
      }
      if (current === undefined) {
        throw extensionError(
          'EXTENSION_VERSION_SWITCH_RECOVERY_FAILED',
          'The prior extension registry entry cannot be restored because it is missing',
          { extensionId: snapshot.extensionId }
        )
      }
      current.selectedVersion = snapshot.selectedVersion
      current.previousSelectedVersion = snapshot.previousSelectedVersion
      current.useDevelopment = snapshot.useDevelopment
      current.workspacePermissionGrants = structuredClone(snapshot.workspacePermissionGrants)
      current.development = snapshot.development === undefined
        ? undefined
        : structuredClone(snapshot.development)
      if (target.kind === 'installed' && !snapshot.targetInstalledVersionExisted) {
        delete current.versions[target.version]
      }
      return registry
    })
  }

  async registerVersion(
    extensionId: string,
    version: InstalledExtensionVersion,
    options: RegisterVersionOptions = {}
  ): Promise<ExtensionRegistryEntry> {
    assertVersionRecord(extensionId, version, this.paths)
    const select = options.select ?? true
    let result: ExtensionRegistryEntry | undefined
    await this.mutate((registry) => {
      const entry = ensureEntry(registry, extensionId, options.enable ?? select)
      const existing = entry.versions[version.version]
      if (existing !== undefined) {
        if (
          existing.archiveSha256 !== version.archiveSha256 ||
          existing.packagePath !== version.packagePath
        ) {
          throw extensionError(
            'EXTENSION_VERSION_IMMUTABLE',
            'An installed extension version cannot be replaced with different content',
            { extensionId, version: version.version }
          )
        }
      } else {
        entry.versions[version.version] = structuredClone(version)
      }
      if (select && entry.selectedVersion !== version.version) {
        const previousPermissions = entry.useDevelopment
          ? undefined
          : selectedInstalledPermissions(entry)
        if (entry.selectedVersion !== undefined) {
          entry.previousSelectedVersion = entry.selectedVersion
        }
        entry.selectedVersion = version.version
        entry.useDevelopment = false
        entry.workspacePermissionGrants = carryForwardWorkspacePermissionGrants(
          entry.workspacePermissionGrants,
          previousPermissions,
          version.grantedPermissions
        )
      }
      result = structuredClone(entry)
      return registry
    })
    return result!
  }

  async selectVersion(extensionId: string, version: string): Promise<ExtensionRegistryEntry> {
    let result: ExtensionRegistryEntry | undefined
    await this.mutate((registry) => {
      const entry = requireEntry(registry, extensionId)
      if (entry.versions[version] === undefined) {
        throw extensionError('EXTENSION_VERSION_NOT_INSTALLED', 'Extension version is not installed', {
          extensionId,
          version
        })
      }
      if (entry.selectedVersion !== version) {
        const previousPermissions = entry.useDevelopment
          ? undefined
          : selectedInstalledPermissions(entry)
        if (entry.selectedVersion !== undefined) entry.previousSelectedVersion = entry.selectedVersion
        entry.selectedVersion = version
        entry.workspacePermissionGrants = carryForwardWorkspacePermissionGrants(
          entry.workspacePermissionGrants,
          previousPermissions,
          entry.versions[version]!.grantedPermissions
        )
      }
      if (entry.useDevelopment) entry.workspacePermissionGrants = {}
      entry.useDevelopment = false
      result = structuredClone(entry)
      return registry
    })
    return result!
  }

  async rollback(extensionId: string): Promise<ExtensionRegistryEntry> {
    let result: ExtensionRegistryEntry | undefined
    await this.mutate((registry) => {
      const entry = requireEntry(registry, extensionId)
      const target = entry.previousSelectedVersion
      if (target === undefined || entry.versions[target] === undefined) {
        throw extensionError('EXTENSION_ROLLBACK_UNAVAILABLE', 'No retained previous version is available', {
          extensionId,
          previousSelectedVersion: target
        })
      }
      const current = entry.selectedVersion
      const previousPermissions = entry.useDevelopment
        ? undefined
        : selectedInstalledPermissions(entry)
      entry.selectedVersion = target
      entry.previousSelectedVersion = current
      entry.useDevelopment = false
      entry.workspacePermissionGrants = carryForwardWorkspacePermissionGrants(
        entry.workspacePermissionGrants,
        previousPermissions,
        entry.versions[target]!.grantedPermissions
      )
      result = structuredClone(entry)
      return registry
    })
    return result!
  }

  async setGlobalEnabled(extensionId: string, enabled: boolean): Promise<ExtensionRegistryEntry> {
    let result: ExtensionRegistryEntry | undefined
    await this.mutate((registry) => {
      const entry = requireEntry(registry, extensionId)
      entry.globallyEnabled = enabled
      result = structuredClone(entry)
      return registry
    })
    return result!
  }

  async setWorkspaceEnabled(
    extensionId: string,
    workspaceKey: string,
    enabled: boolean | undefined
  ): Promise<ExtensionRegistryEntry> {
    if (!/^[a-f0-9]{64}$/.test(workspaceKey)) {
      throw extensionError('EXTENSION_WORKSPACE_KEY_INVALID', 'Workspace key is invalid', {
        workspaceKey
      })
    }
    let result: ExtensionRegistryEntry | undefined
    await this.mutate((registry) => {
      const entry = requireEntry(registry, extensionId)
      if (enabled === undefined) delete entry.workspaceEnablement[workspaceKey]
      else entry.workspaceEnablement[workspaceKey] = enabled
      result = structuredClone(entry)
      return registry
    })
    return result!
  }

  async setWorkspacePermissionGrant(
    extensionId: string,
    workspaceKey: string,
    permissions: string[] | undefined,
    expectedVersion: string
  ): Promise<ExtensionRegistryEntry> {
    if (!/^[a-f0-9]{64}$/.test(workspaceKey)) {
      throw extensionError('EXTENSION_WORKSPACE_KEY_INVALID', 'Workspace key is invalid', {
        workspaceKey
      })
    }
    let result: ExtensionRegistryEntry | undefined
    await this.mutate((registry) => {
      const entry = requireEntry(registry, extensionId)
      const selected = resolveRegistrySelection(entry)
      if (selected.manifest.version !== expectedVersion) {
        throw extensionError(
          'EXTENSION_VERSION_CONFLICT',
          'Extension version changed; repeat the permission review',
          {
            extensionId,
            expectedVersion,
            currentVersion: selected.manifest.version
          }
        )
      }
      if (permissions === undefined) {
        delete entry.workspacePermissionGrants[workspaceKey]
      } else {
        const allowed = new Set(selected.grantedPermissions)
        const grant = [...new Set(permissions)].sort()
        if (grant.some((permission) => !allowed.has(permission))) {
          throw extensionError(
            'EXTENSION_PERMISSION_DENIED',
            'Workspace permission grant cannot exceed the accepted package grant',
            { extensionId, workspaceKey, permissions: grant }
          )
        }
        entry.workspacePermissionGrants[workspaceKey] = grant
      }
      result = structuredClone(entry)
      return registry
    })
    return result!
  }

  async isEnabled(extensionId: string, workspaceKey?: string): Promise<boolean> {
    const entry = await this.get(extensionId)
    if (entry === undefined) return false
    if (workspaceKey !== undefined && workspaceKey in entry.workspaceEnablement) {
      return entry.workspaceEnablement[workspaceKey]!
    }
    return entry.globallyEnabled
  }

  async isWorkspaceTrusted(extensionId: string, workspaceKey: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(workspaceKey)) {
      throw extensionError('EXTENSION_WORKSPACE_KEY_INVALID', 'Workspace key is invalid', {
        workspaceKey
      })
    }
    const entry = await this.get(extensionId)
    return entry !== undefined && Object.prototype.hasOwnProperty.call(
      entry.workspacePermissionGrants,
      workspaceKey
    )
  }

  async registerDevelopment(
    extensionId: string,
    development: DevelopmentExtensionRecord,
    options: { enable?: boolean; select?: boolean } = {}
  ): Promise<ExtensionRegistryEntry> {
    assertDevelopmentRecord(extensionId, development)
    let result: ExtensionRegistryEntry | undefined
    await this.mutate((registry) => {
      const entry = ensureEntry(registry, extensionId, options.enable ?? (options.select ?? true))
      entry.development = structuredClone(development)
      if (options.select ?? true) {
        entry.useDevelopment = true
        entry.workspacePermissionGrants = {}
      }
      result = structuredClone(entry)
      return registry
    })
    return result!
  }

  async reloadDevelopment(
    extensionId: string,
    replacement: Omit<DevelopmentExtensionRecord, 'registeredAt' | 'generation'>
  ): Promise<ExtensionRegistryEntry> {
    let result: ExtensionRegistryEntry | undefined
    await this.mutate((registry) => {
      const entry = requireEntry(registry, extensionId)
      const current = entry.development
      if (current === undefined) {
        throw extensionError('EXTENSION_DEVELOPMENT_NOT_REGISTERED', 'Development source is not registered', {
          extensionId
        })
      }
      const next: DevelopmentExtensionRecord = {
        ...structuredClone(replacement),
        registeredAt: current.registeredAt,
        generation: current.generation + 1
      }
      assertDevelopmentRecord(extensionId, next)
      entry.development = next
      if (entry.useDevelopment) entry.workspacePermissionGrants = {}
      result = structuredClone(entry)
      return registry
    })
    return result!
  }

  async useDevelopment(extensionId: string, enabled: boolean): Promise<ExtensionRegistryEntry> {
    let result: ExtensionRegistryEntry | undefined
    await this.mutate((registry) => {
      const entry = requireEntry(registry, extensionId)
      if (enabled && entry.development === undefined) {
        throw extensionError('EXTENSION_DEVELOPMENT_NOT_REGISTERED', 'Development source is not registered', {
          extensionId
        })
      }
      if (!enabled && entry.selectedVersion === undefined) {
        throw extensionError('EXTENSION_VERSION_NOT_SELECTED', 'No installed version is selected', {
          extensionId
        })
      }
      entry.useDevelopment = enabled
      entry.workspacePermissionGrants = {}
      result = structuredClone(entry)
      return registry
    })
    return result!
  }

  async removeDevelopment(extensionId: string): Promise<ExtensionRegistryEntry> {
    let result: ExtensionRegistryEntry | undefined
    await this.mutate((registry) => {
      const entry = requireEntry(registry, extensionId)
      delete entry.development
      entry.useDevelopment = false
      entry.workspacePermissionGrants = {}
      if (entry.selectedVersion === undefined) entry.globallyEnabled = false
      result = structuredClone(entry)
      return registry
    })
    return result!
  }

  async removeVersion(extensionId: string, version: string): Promise<ExtensionRegistryEntry> {
    let result: ExtensionRegistryEntry | undefined
    await this.mutate((registry) => {
      const entry = requireEntry(registry, extensionId)
      if (entry.versions[version] === undefined) {
        throw extensionError('EXTENSION_VERSION_NOT_INSTALLED', 'Extension version is not installed', {
          extensionId,
          version
        })
      }
      delete entry.versions[version]
      if (entry.selectedVersion === version) {
        entry.selectedVersion = undefined
        entry.globallyEnabled = false
        entry.workspacePermissionGrants = {}
      }
      if (entry.previousSelectedVersion === version) entry.previousSelectedVersion = undefined
      result = structuredClone(entry)
      return registry
    })
    return result!
  }

  async removeExtension(extensionId: string): Promise<void> {
    await this.mutate((registry) => {
      requireEntry(registry, extensionId)
      delete registry.extensions[extensionId]
      return registry
    })
  }

  async resolve(extensionId: string, workspaceKey?: string): Promise<ResolvedExtension> {
    const entry = await this.get(extensionId)
    if (entry === undefined) {
      throw extensionError('EXTENSION_NOT_INSTALLED', 'Extension is not installed', { extensionId })
    }
    if (entry.useDevelopment) {
      const development = entry.development
      if (development === undefined) {
        throw extensionError('EXTENSION_DEVELOPMENT_UNAVAILABLE', 'Selected development source is unavailable', {
          extensionId
        })
      }
      const grantedPermissions = workspaceKey === undefined
        ? development.grantedPermissions
        : entry.workspacePermissionGrants[workspaceKey] ?? development.grantedPermissions
      return {
        id: extensionId,
        version: development.manifest.version,
        packagePath: development.path,
        manifest: structuredClone(development.manifest),
        requestedPermissions: [...development.requestedPermissions],
        grantedPermissions: [...grantedPermissions],
        source: structuredClone(development.source),
        development: true,
        generation: development.generation
      }
    }
    const selectedVersion = entry.selectedVersion
    const selected = selectedVersion === undefined ? undefined : entry.versions[selectedVersion]
    if (selected === undefined) {
      throw extensionError('EXTENSION_VERSION_NOT_SELECTED', 'Extension has no selected version', {
        extensionId,
        selectedVersion
      })
    }
    const grantedPermissions = workspaceKey === undefined
      ? selected.grantedPermissions
      : entry.workspacePermissionGrants[workspaceKey] ?? selected.grantedPermissions
    return {
      id: extensionId,
      version: selected.version,
      packagePath: selected.packagePath,
      manifest: structuredClone(selected.manifest),
      requestedPermissions: [...selected.requestedPermissions],
      grantedPermissions: [...grantedPermissions],
      source: structuredClone(selected.source),
      development: false
    }
  }

  private async mutate(
    mutate: (document: ExtensionRegistryDocument) => ExtensionRegistryDocument
  ): Promise<ExtensionRegistryDocument> {
    return this.file.update(
      () => emptyRegistry(this.now()),
      (current) => {
        const next = mutate(structuredClone(current))
        next.revision = current.revision + 1
        next.updatedAt = this.now().toISOString()
        return next
      }
    )
  }
}

function emptyRegistry(now: Date): ExtensionRegistryDocument {
  return {
    schemaVersion: EXTENSION_REGISTRY_SCHEMA_VERSION,
    revision: 0,
    updatedAt: now.toISOString(),
    extensions: {}
  }
}

function ensureEntry(
  registry: ExtensionRegistryDocument,
  extensionId: string,
  enabled: boolean
): ExtensionRegistryEntry {
  const existing = registry.extensions[extensionId]
  if (existing !== undefined) return existing
  const created: ExtensionRegistryEntry = {
    id: extensionId,
    globallyEnabled: enabled,
    workspaceEnablement: {},
    workspacePermissionGrants: {},
    versions: {},
    useDevelopment: false
  }
  registry.extensions[extensionId] = created
  return created
}

function requireEntry(
  registry: ExtensionRegistryDocument,
  extensionId: string
): ExtensionRegistryEntry {
  assertExtensionId(extensionId)
  const entry = registry.extensions[extensionId]
  if (entry === undefined) {
    throw extensionError('EXTENSION_NOT_INSTALLED', 'Extension is not installed', { extensionId })
  }
  return entry
}

function selectedInstalledPermissions(entry: ExtensionRegistryEntry): string[] | undefined {
  if (entry.selectedVersion === undefined) return undefined
  return entry.versions[entry.selectedVersion]?.grantedPermissions
}

/**
 * A workspace review remains valid when an immutable installed update cannot
 * broaden the authority accepted for the previously selected package. Grants
 * are narrowed to the new package ceiling so removed permissions cannot leak
 * into the selected-version snapshot. Any addition, missing prior selection,
 * or mutable development source fails closed and requires a fresh review.
 */
function carryForwardWorkspacePermissionGrants(
  current: Record<string, string[]>,
  previousAllowed: readonly string[] | undefined,
  nextAllowed: readonly string[]
): Record<string, string[]> {
  if (previousAllowed === undefined) return {}
  const previous = new Set(previousAllowed)
  if (nextAllowed.some((permission) => !previous.has(permission))) return {}
  const next = new Set(nextAllowed)
  return Object.fromEntries(
    Object.entries(current).map(([workspaceKey, permissions]) => [
      workspaceKey,
      permissions.filter((permission) => next.has(permission))
    ])
  )
}

function assertVersionRecord(
  extensionId: string,
  record: InstalledExtensionVersion,
  paths?: ExtensionPaths
): void {
  assertExtensionId(extensionId)
  const manifest = parseExtensionManifest(normalizeLegacyInstalledManifest(record.manifest))
  record.manifest = manifest
  if (manifestId(manifest) !== extensionId || manifest.version !== record.version) {
    throw extensionError('EXTENSION_REGISTRY_RECORD_INVALID', 'Installed version metadata is incoherent', {
      extensionId,
      version: record.version
    })
  }
  if (
    !isAbsolute(record.packagePath) ||
    (paths !== undefined && record.packagePath !== paths.packageVersion(extensionId, record.version)) ||
    record.mutable !== false ||
    !/^[a-f0-9]{64}$/.test(record.archiveSha256) ||
    !['unsigned', 'present-unverified', 'verified'].includes(record.signatureStatus) ||
    !Array.isArray(record.requestedPermissions) ||
    !Array.isArray(record.grantedPermissions) ||
    typeof record.installedAt !== 'string' ||
    Number.isNaN(Date.parse(record.installedAt)) ||
    !isRecord(record.integrity) ||
    record.integrity.algorithm !== 'sha256' ||
    !isRecord(record.integrity.files) ||
    !isRecord(record.source)
  ) {
    throw extensionError('EXTENSION_REGISTRY_RECORD_INVALID', 'Installed package path must be immutable and absolute', {
      extensionId,
      packagePath: record.packagePath
    })
  }
  validateSource(record.source, false)
  validatePermissionSnapshot(manifest.permissions, record.requestedPermissions, record.grantedPermissions)
  for (const [path, digest] of Object.entries(record.integrity.files)) {
    assertCanonicalPackagePath(path, false)
    if (!/^[a-f0-9]{64}$/.test(String(digest))) {
      throw extensionError('EXTENSION_REGISTRY_RECORD_INVALID', 'Integrity digest is invalid', {
        extensionId,
        path
      })
    }
  }
}

/**
 * Early Extension API v1 builds allowed an Action to reuse a workbench ID that
 * was already owned by a command or View. Newer hosts correctly reject that
 * ambiguous registry identity, but an immutable package installed by an older
 * Kun must still be readable long enough for a bundled update or uninstall.
 *
 * Action IDs have no activation event and do not change their command target,
 * so assigning a deterministic action-only suffix is the one compatibility
 * repair that does not broaden authority or reinterpret executable code. All
 * other manifest validation remains strict, and mutable development sources
 * deliberately do not receive this repair.
 */
function normalizeLegacyInstalledManifest(value: unknown): unknown {
  if (!isRecord(value) || value.manifestVersion !== 1 || !isRecord(value.contributes)) {
    return value
  }
  const contributes = value.contributes
  const nonActionKeys = [
    'commands',
    'views.containers',
    'views.leftSidebar',
    'views.rightSidebar',
    'views.auxiliaryPanel',
    'views.editorTab',
    'views.fullPage',
    'message.resultPreviews',
    'settings',
    'contextMenus',
    'notifications',
    'hostContentScripts'
  ] as const
  const used = new Set<string>()
  for (const key of nonActionKeys) {
    const entries = contributes[key]
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (isRecord(entry) && typeof entry.id === 'string') used.add(entry.id)
    }
  }

  let normalized: Record<string, unknown> | undefined
  let normalizedContributes: Record<string, unknown> | undefined
  for (const key of ['actions.topBar', 'actions.composer', 'actions.message'] as const) {
    const entries = contributes[key]
    if (!Array.isArray(entries)) continue
    entries.forEach((entry, index) => {
      if (!isRecord(entry) || typeof entry.id !== 'string') return
      if (!used.has(entry.id)) {
        used.add(entry.id)
        return
      }
      normalized ??= structuredClone(value)
      normalizedContributes ??= normalized.contributes as Record<string, unknown>
      const normalizedEntries = normalizedContributes[key] as Array<Record<string, unknown>>
      const nextId = availableLegacyActionId(entry.id, used)
      normalizedEntries[index] = { ...normalizedEntries[index], id: nextId }
      used.add(nextId)
    })
  }
  return normalized ?? value
}

function availableLegacyActionId(id: string, used: ReadonlySet<string>): string {
  for (let attempt = 1; attempt <= 10_000; attempt += 1) {
    const suffix = attempt === 1 ? '-action' : `-action-${attempt}`
    const candidate = `${id.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`
    if (!used.has(candidate)) return candidate
  }
  throw extensionError(
    'EXTENSION_REGISTRY_RECORD_INVALID',
    'Legacy extension action IDs cannot be normalized safely',
    { id }
  )
}

function assertDevelopmentRecord(extensionId: string, record: DevelopmentExtensionRecord): void {
  assertExtensionId(extensionId)
  const manifest = parseExtensionManifest(record.manifest)
  if (
    manifestId(manifest) !== extensionId ||
    !isAbsolute(record.path) ||
    record.mutable !== true ||
    !/^[a-f0-9]{64}$/.test(record.digest) ||
    record.source?.type !== 'development' ||
    record.source.locator !== record.path ||
    !Number.isSafeInteger(record.generation) ||
    record.generation < 1 ||
    Number.isNaN(Date.parse(record.registeredAt)) ||
    Number.isNaN(Date.parse(record.reloadedAt))
  ) {
    throw extensionError('EXTENSION_REGISTRY_RECORD_INVALID', 'Development source metadata is incoherent', {
      extensionId,
      path: record.path
    })
  }
  validateSource(record.source, true)
  validatePermissionSnapshot(manifest.permissions, record.requestedPermissions, record.grantedPermissions)
}

function validateRegistryDocument(value: unknown, paths: ExtensionPaths): ExtensionRegistryDocument {
  if (!isRecord(value)) {
    throw extensionError('EXTENSION_REGISTRY_INVALID', 'Extension registry must be an object')
  }
  if (value.schemaVersion !== EXTENSION_REGISTRY_SCHEMA_VERSION) {
    throw extensionError('EXTENSION_REGISTRY_VERSION_UNSUPPORTED', 'Unsupported extension registry version', {
      schemaVersion: value.schemaVersion
    })
  }
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    throw extensionError('EXTENSION_REGISTRY_INVALID', 'Registry revision is invalid')
  }
  if (typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))) {
    throw extensionError('EXTENSION_REGISTRY_INVALID', 'Registry timestamp is invalid')
  }
  if (!isRecord(value.extensions)) {
    throw extensionError('EXTENSION_REGISTRY_INVALID', 'Registry extensions must be an object')
  }
  for (const [extensionId, rawEntry] of Object.entries(value.extensions)) {
    validateEntry(extensionId, rawEntry, paths)
  }
  return value as ExtensionRegistryDocument
}

function validateEntry(
  extensionId: string,
  value: unknown,
  paths: ExtensionPaths
): asserts value is ExtensionRegistryEntry {
  assertExtensionId(extensionId)
  if (!isRecord(value) || value.id !== extensionId) {
    throw extensionError('EXTENSION_REGISTRY_INVALID', 'Registry entry identity is invalid', {
      extensionId
    })
  }
  if (
    typeof value.globallyEnabled !== 'boolean' ||
    typeof value.useDevelopment !== 'boolean' ||
    !isRecord(value.workspaceEnablement) ||
    !isRecord(value.workspacePermissionGrants) ||
    !isRecord(value.versions)
  ) {
    throw extensionError('EXTENSION_REGISTRY_INVALID', 'Registry entry shape is invalid', {
      extensionId
    })
  }
  for (const [key, enabled] of Object.entries(value.workspaceEnablement)) {
    if (!/^[a-f0-9]{64}$/.test(key) || typeof enabled !== 'boolean') {
      throw extensionError('EXTENSION_REGISTRY_INVALID', 'Workspace enablement is invalid', {
        extensionId,
        workspaceKey: key
      })
    }
  }
  for (const [version, rawRecord] of Object.entries(value.versions)) {
    if (!isRecord(rawRecord) || rawRecord.version !== version) {
      throw extensionError('EXTENSION_REGISTRY_INVALID', 'Installed version key is invalid', {
        extensionId,
        version
      })
    }
    assertVersionRecord(extensionId, rawRecord as InstalledExtensionVersion, paths)
  }
  if (value.development !== undefined) {
    assertDevelopmentRecord(extensionId, value.development as DevelopmentExtensionRecord)
  }
  if (value.useDevelopment && value.development === undefined) {
    throw extensionError('EXTENSION_REGISTRY_INVALID', 'Development source is selected but missing', {
      extensionId
    })
  }
  if (
    value.selectedVersion !== undefined &&
    (typeof value.selectedVersion !== 'string' || value.versions[value.selectedVersion] === undefined)
  ) {
    throw extensionError('EXTENSION_REGISTRY_INVALID', 'Selected extension version is unavailable', {
      extensionId,
      selectedVersion: value.selectedVersion
    })
  }
  if (
    value.previousSelectedVersion !== undefined &&
    (
      typeof value.previousSelectedVersion !== 'string' ||
      value.versions[value.previousSelectedVersion] === undefined
    )
  ) {
    throw extensionError('EXTENSION_REGISTRY_INVALID', 'Previous extension version is unavailable', {
      extensionId,
      previousSelectedVersion: value.previousSelectedVersion
    })
  }
  const selected = value.useDevelopment
    ? value.development as DevelopmentExtensionRecord | undefined
    : typeof value.selectedVersion === 'string'
      ? value.versions[value.selectedVersion] as InstalledExtensionVersion | undefined
      : undefined
  const allowedPermissions = new Set(selected?.grantedPermissions ?? [])
  for (const [key, permissions] of Object.entries(value.workspacePermissionGrants)) {
    if (
      !/^[a-f0-9]{64}$/.test(key) ||
      !Array.isArray(permissions) ||
      permissions.some((permission) => typeof permission !== 'string') ||
      new Set(permissions).size !== permissions.length ||
      permissions.some((permission) => !allowedPermissions.has(permission as string))
    ) {
      throw extensionError('EXTENSION_REGISTRY_INVALID', 'Workspace permission grant is invalid', {
        extensionId,
        workspaceKey: key
      })
    }
  }
}

function validateSource(source: Record<string, unknown>, development: boolean): void {
  if (
    typeof source.locator !== 'string' ||
    !['local', 'index', 'development'].includes(String(source.type)) ||
    (development ? source.type !== 'development' : source.type === 'development') ||
    (source.type === 'index' && typeof source.indexUrl !== 'string')
  ) {
    throw extensionError('EXTENSION_REGISTRY_RECORD_INVALID', 'Extension source provenance is invalid')
  }
}

function validatePermissionSnapshot(
  manifestPermissions: string[],
  requestedPermissions: unknown[],
  grantedPermissions: unknown[]
): void {
  if (
    requestedPermissions.some((permission) => typeof permission !== 'string') ||
    grantedPermissions.some((permission) => typeof permission !== 'string')
  ) {
    throw extensionError('EXTENSION_REGISTRY_RECORD_INVALID', 'Permission snapshot is invalid')
  }
  const manifest = [...manifestPermissions].sort()
  const requested = [...new Set(requestedPermissions as string[])].sort()
  const granted = [...new Set(grantedPermissions as string[])].sort()
  if (
    manifest.length !== requested.length ||
    manifest.some((permission, index) => permission !== requested[index]) ||
    requested.length !== granted.length ||
    requested.some((permission, index) => permission !== granted[index])
  ) {
    throw extensionError('EXTENSION_REGISTRY_RECORD_INVALID', 'Permission snapshot is incoherent')
  }
}

function assertVersionSwitchTarget(
  target: ExtensionVersionSwitchTarget
): asserts target is ExtensionVersionSwitchTarget {
  if (target.kind === 'installed') {
    if (typeof target.version !== 'string' || target.version.length === 0) {
      throw extensionError(
        'EXTENSION_VERSION_SWITCH_JOURNAL_INVALID',
        'Installed version switch target is invalid'
      )
    }
    return
  }
  if (
    target.kind !== 'development' ||
    typeof target.version !== 'string' ||
    target.version.length === 0 ||
    !Number.isSafeInteger(target.generation) ||
    target.generation < 1
  ) {
    throw extensionError(
      'EXTENSION_VERSION_SWITCH_JOURNAL_INVALID',
      'Development version switch target is invalid'
    )
  }
}

function assertVersionSwitchSnapshot(
  snapshot: ExtensionRegistrySwitchSnapshot
): asserts snapshot is ExtensionRegistrySwitchSnapshot {
  assertExtensionId(snapshot.extensionId)
  if (
    typeof snapshot.entryExisted !== 'boolean' ||
    typeof snapshot.useDevelopment !== 'boolean' ||
    typeof snapshot.targetInstalledVersionExisted !== 'boolean' ||
    !isRecord(snapshot.workspacePermissionGrants)
  ) {
    throw extensionError(
      'EXTENSION_VERSION_SWITCH_JOURNAL_INVALID',
      'Version switch registry snapshot is invalid',
      { extensionId: snapshot.extensionId }
    )
  }
  for (const [workspaceKey, permissions] of Object.entries(snapshot.workspacePermissionGrants)) {
    if (
      !/^[a-f0-9]{64}$/.test(workspaceKey) ||
      !Array.isArray(permissions) ||
      permissions.some((permission) => typeof permission !== 'string')
    ) {
      throw extensionError(
        'EXTENSION_VERSION_SWITCH_JOURNAL_INVALID',
        'Version switch workspace permission snapshot is invalid',
        { extensionId: snapshot.extensionId, workspaceKey }
      )
    }
  }
  if (snapshot.development !== undefined) {
    assertDevelopmentRecord(snapshot.extensionId, snapshot.development)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveRegistrySelection(
  entry: ExtensionRegistryEntry
): InstalledExtensionVersion | DevelopmentExtensionRecord {
  if (entry.useDevelopment && entry.development !== undefined) return entry.development
  const selected = entry.selectedVersion === undefined ? undefined : entry.versions[entry.selectedVersion]
  if (selected === undefined) {
    throw extensionError('EXTENSION_VERSION_NOT_SELECTED', 'Extension has no selected version', {
      extensionId: entry.id
    })
  }
  return selected
}

function projectPublicRegistry(document: ExtensionRegistryDocument): PublicExtensionRegistry {
  const extensions: Record<string, unknown> = {}
  for (const [extensionId, entry] of Object.entries(document.extensions)) {
    const installedVersions = Object.values(entry.versions).map((record) => ({
      version: record.version,
      path: record.packagePath,
      sha256: record.archiveSha256,
      source: projectPublicSource(record.source),
      signatureStatus: record.signatureStatus === 'verified'
        ? 'valid'
        : record.signatureStatus === 'unsigned'
          ? 'unsigned'
          : 'unknown-key',
      installedAt: record.installedAt,
      permissions: record.requestedPermissions,
      apiVersion: record.manifest.apiVersion,
      manifestVersion: record.manifest.manifestVersion,
      stateSchemaVersion: record.manifest.stateSchemaVersion,
      mutable: false
    }))
    if (entry.development !== undefined) {
      installedVersions.push({
        version: entry.development.manifest.version,
        path: entry.development.path,
        sha256: entry.development.digest,
        source: { type: 'development', path: entry.development.path },
        signatureStatus: 'unsigned',
        installedAt: entry.development.registeredAt,
        permissions: entry.development.requestedPermissions,
        apiVersion: entry.development.manifest.apiVersion,
        manifestVersion: entry.development.manifest.manifestVersion,
        stateSchemaVersion: entry.development.manifest.stateSchemaVersion,
        mutable: true
      })
    }
    const selected = entry.useDevelopment ? entry.development : (
      entry.selectedVersion === undefined ? undefined : entry.versions[entry.selectedVersion]
    )
    const grants: Array<{
      extensionId: string
      version: string
      permissions: string[]
      acceptedAt: string
      workspaceId?: string
    }> = Object.values(entry.versions).map((record) => ({
      extensionId,
      version: record.version,
      permissions: record.grantedPermissions,
      acceptedAt: record.installedAt
    }))
    if (entry.development !== undefined) {
      grants.push({
        extensionId,
        version: entry.development.manifest.version,
        permissions: entry.development.grantedPermissions,
        acceptedAt: entry.development.registeredAt
      })
    }
    if (selected !== undefined) {
      for (const [workspaceId, permissions] of Object.entries(entry.workspacePermissionGrants)) {
        grants.push({
          extensionId,
          version: selected.manifest.version,
          permissions,
          acceptedAt: document.updatedAt,
          workspaceId
        })
      }
    }
    extensions[extensionId] = {
      id: extensionId,
      ...(selected === undefined ? {} : { selectedVersion: selected.manifest.version }),
      ...(entry.previousSelectedVersion === undefined
        ? {}
        : { previousVersion: entry.previousSelectedVersion }),
      installedVersions,
      enabled: entry.globallyEnabled,
      workspaceEnablement: entry.workspaceEnablement,
      grants
    }
  }
  return PublicExtensionRegistrySchema.parse({
    schemaVersion: 1,
    revision: document.revision,
    extensions,
    updatedAt: document.updatedAt
  })
}

function projectPublicSource(source: InstalledExtensionVersion['source']): unknown {
  switch (source.type) {
    case 'local':
      return { type: 'local', path: source.locator }
    case 'index':
      return { type: 'index', indexUrl: source.indexUrl, packageUrl: source.locator }
    case 'development':
      return { type: 'development', path: source.locator }
  }
}
