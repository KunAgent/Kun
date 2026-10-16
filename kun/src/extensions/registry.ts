import { checkEnablement, enablementProof, enablementBusiness, pluginRevision, type EnablementControl } from './enablement-control.js'
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

  async setGlobalEnabled(extensionId: string, enabled: boolean, control?: EnablementControl): Promise<ExtensionRegistryEntry> {
    const committed = await this.mutate((registry) => {
      const entry = registry.extensions[extensionId]
      if (control) {
        checkEnablement(entry, control, enabled)
        if (enablementProof(entry!, control, enabled)) return registry
      }
      const target = requireEntry(registry, extensionId)
      target.globallyEnabled = enabled
      if (control) {
        target.controlRevision = (target.controlRevision ?? 0) + 1
        target.enablementProofs = [...(target.enablementProofs ?? []), { requestId: control.requestId,
          fingerprint: control.fingerprint, enabled, revision: pluginRevision(target) }].slice(-64)
      }
      return registry
    })
    return structuredClone(committed.extensions[extensionId]!)
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
        for (const [id, entry] of Object.entries(next.extensions)) {
          const prior = current.extensions[id]
          if (prior && enablementBusiness(prior) !== enablementBusiness(entry) &&
              (entry.controlRevision ?? 0) === (prior.controlRevision ?? 0))
            entry.controlRevision = (prior.controlRevision ?? 0) + 1
        }
        next.revision = current.revision + 1
        next.updatedAt = this.now().toISOString()
        return next
      }
    )
  }
}

import {
  emptyRegistry,
  ensureEntry,
  requireEntry,
  selectedInstalledPermissions,
  carryForwardWorkspacePermissionGrants,
  assertVersionRecord,
  assertDevelopmentRecord,
  validateRegistryDocument,
  assertVersionSwitchTarget,
  assertVersionSwitchSnapshot,
  resolveRegistrySelection,
  projectPublicRegistry
} from './registry-validation.js'
export { validateRegistryDocument } from './registry-validation.js'
