import { validateEnablementMetadata } from './enablement-control.js'
import { isAbsolute, win32 } from 'node:path'
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

import type { ExtensionRegistrySwitchSnapshot, ExtensionVersionSwitchTarget, RegisterVersionOptions } from './registry.js'

export function emptyRegistry(now: Date): ExtensionRegistryDocument {
  return {
    schemaVersion: EXTENSION_REGISTRY_SCHEMA_VERSION,
    revision: 0,
    updatedAt: now.toISOString(),
    extensions: {}
  }
}

export function ensureEntry(
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

export function requireEntry(
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

export function selectedInstalledPermissions(entry: ExtensionRegistryEntry): string[] | undefined {
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
export function carryForwardWorkspacePermissionGrants(
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

export function assertVersionRecord(
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
  // Sessions canonicalize Windows data directories to lowercase. Packages
  // installed by older builds still name that same directory with its original
  // casing. Adopt the current spelling so startup recovery keeps the package.
  if (paths !== undefined && typeof record.packagePath === 'string') {
    record.packagePath = canonicalizeInstalledPackagePath(
      record.packagePath,
      paths.packageVersion(extensionId, record.version)
    )
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
 * Accept a Windows spelling difference for the exact installed package
 * directory. A different directory, including one reached with `..`, stays
 * unchanged so the strict equality check still rejects it.
 */
export function canonicalizeInstalledPackagePath(
  packagePath: string,
  expected: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (packagePath === expected || platform !== 'win32') return packagePath
  if (!win32.isAbsolute(packagePath) || !win32.isAbsolute(expected)) return packagePath
  if (windowsPackagePathKey(packagePath) !== windowsPackagePathKey(expected)) return packagePath
  return expected
}

function windowsPackagePathKey(value: string): string {
  let resolved = win32.resolve(value)
  if (resolved.startsWith('\\\\?\\UNC\\')) resolved = `\\\\${resolved.slice(8)}`
  else if (resolved.startsWith('\\\\?\\')) resolved = resolved.slice(4)
  return resolved.toLowerCase()
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
export function normalizeLegacyInstalledManifest(value: unknown): unknown {
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

export function availableLegacyActionId(id: string, used: ReadonlySet<string>): string {
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

export function assertDevelopmentRecord(extensionId: string, record: DevelopmentExtensionRecord): void {
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

export function validateRegistryDocument(
  value: unknown,
  paths: ExtensionPaths
): ExtensionRegistryDocument {
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

export function validateEntry(
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
  validateEnablementMetadata(value)
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

export function validateSource(source: Record<string, unknown>, development: boolean): void {
  if (
    typeof source.locator !== 'string' ||
    !['local', 'index', 'development'].includes(String(source.type)) ||
    (development ? source.type !== 'development' : source.type === 'development') ||
    (source.type === 'index' && typeof source.indexUrl !== 'string')
  ) {
    throw extensionError('EXTENSION_REGISTRY_RECORD_INVALID', 'Extension source provenance is invalid')
  }
}

export function validatePermissionSnapshot(
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

export function assertVersionSwitchTarget(
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

export function assertVersionSwitchSnapshot(
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveRegistrySelection(
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

export function projectPublicRegistry(document: ExtensionRegistryDocument): PublicExtensionRegistry {
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

export function projectPublicSource(source: InstalledExtensionVersion['source']): unknown {
  switch (source.type) {
    case 'local':
      return { type: 'local', path: source.locator }
    case 'index':
      return { type: 'index', indexUrl: source.indexUrl, packageUrl: source.locator }
    case 'development':
      return { type: 'development', path: source.locator }
  }
}
