import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  extractKunxArchive,
  inspectDevelopmentDirectory,
  makePackageTreeReadOnly,
  verifyExtractedExtension,
  type ArchiveValidationOptions,
  type ExtractedKunx
} from './archive.js'
import { extensionError } from './errors.js'
import {
  assertManifestCompatible,
  manifestCompatibilityReport,
  manifestId
} from './manifest.js'
import { ExtensionPaths } from './paths.js'
import { ExtensionRegistry } from './registry.js'
import type {
  DevelopmentExtensionRecord,
  ExtensionManifest,
  ExtensionSource,
  InstalledExtensionVersion,
  ResolvedExtension,
  ExtensionAdmission
} from './types.js'

export type VersionSwitchContext = {
  extensionId: string
  from?: ResolvedExtension
  to: ResolvedExtension
  reason: 'install' | 'select' | 'rollback' | 'development-register' | 'development-reload'
}

export type ExtensionPackageLifecycle = {
  /**
   * Owns the durable state + selected-version transaction when supplied.
   * Implementations must invoke `commitSelection` exactly once on success.
   */
  runVersionSwitch?(
    context: VersionSwitchContext,
    commitSelection: () => Promise<void>
  ): Promise<void>
  recoverVersionSwitch?(extensionId: string): Promise<void>
  recoverVersionSwitches?(): Promise<void>
  beforeVersionSwitch?(context: VersionSwitchContext): Promise<void>
  versionSwitchFailed?(context: VersionSwitchContext, error: unknown): Promise<void>
  beforeDisable?(extensionId: string, workspaceKey?: string, workspaceRoot?: string): Promise<void>
  beforePermissionChange?(
    extensionId: string,
    workspaceKey: string,
    workspaceRoot?: string
  ): Promise<void>
  beforeUninstall?(extensionId: string): Promise<void>
}

export type ExpectedIndexedPackage = {
  extensionId: string
  version: string
  archiveSha256: string
  enginesKun: string
  apiVersion: string
  permissions: string[]
  signature?: Record<string, unknown>
}

export type InstallArchiveOptions = {
  source?: ExtensionSource
  grantedPermissions: string[]
  select?: boolean
  enable?: boolean
  expected?: ExpectedIndexedPackage
}

export class ExtensionPackageManager {
  private readonly operations = new Map<string, Promise<unknown>>()

  constructor(
    readonly paths: ExtensionPaths,
    readonly registry: ExtensionRegistry,
    private readonly validation: ArchiveValidationOptions,
    private lifecycle: ExtensionPackageLifecycle = {},
    private readonly now: () => Date = () => new Date()
  ) {}

  setLifecycle(lifecycle: ExtensionPackageLifecycle): void {
    this.lifecycle = lifecycle
  }

  async recover(extensionId?: string): Promise<void> {
    if (extensionId === undefined) {
      await this.lifecycle.recoverVersionSwitches?.()
      await this.cleanupInterruptedInstallArtifacts()
      return
    }
    await this.lifecycle.recoverVersionSwitch?.(extensionId)
  }

  compatibilityReport(manifest: ExtensionManifest): ExtensionAdmission {
    const compatibility = this.validation.compatibility
    if (compatibility === undefined) {
      throw extensionError(
        'EXTENSION_COMPATIBILITY_CONFIGURATION_MISSING',
        'Extension compatibility policy is not configured'
      )
    }
    return manifestCompatibilityReport(manifest, compatibility)
  }

  admitManifest(manifest: ExtensionManifest): ExtensionAdmission {
    const compatibility = this.validation.compatibility
    if (compatibility === undefined) {
      throw extensionError(
        'EXTENSION_COMPATIBILITY_CONFIGURATION_MISSING',
        'Extension compatibility policy is not configured'
      )
    }
    return assertManifestCompatible(manifest, compatibility)
  }

  async compatibilityReportForExtension(
    extensionId: string
  ): Promise<ExtensionAdmission | undefined> {
    await this.recover(extensionId)
    const entry = await this.registry.get(extensionId)
    if (entry === undefined) return undefined
    const manifest = entry.useDevelopment && entry.development !== undefined
      ? entry.development.manifest
      : entry.selectedVersion === undefined
        ? undefined
        : entry.versions[entry.selectedVersion]?.manifest
    return manifest === undefined ? undefined : this.compatibilityReport(manifest)
  }

  async installArchive(
    archivePath: string,
    options: InstallArchiveOptions
  ): Promise<InstalledExtensionVersion> {
    await mkdir(this.paths.stagingRoot, { recursive: true, mode: 0o700 })
    const staging = join(this.paths.stagingRoot, `install-${randomUUID()}`)
    const extractedPath = join(staging, 'package')
    let moved = false
    let destination = ''
    try {
      const extracted = await extractKunxArchive(archivePath, extractedPath, this.validation)
      validatePermissionGrant(extracted.manifest.permissions, options.grantedPermissions)
      validateExpectedPackage(extracted, options.expected)
      const extensionId = manifestId(extracted.manifest)
      await this.recover(extensionId)
      destination = this.paths.packageVersion(extensionId, extracted.manifest.version)
      const prior = await this.registry.get(extensionId)
      const existing = prior?.versions[extracted.manifest.version]
      if (await pathExists(destination)) {
        if (
          existing === undefined ||
          existing.archiveSha256 !== extracted.archiveSha256 ||
          existing.packagePath !== destination
        ) {
          throw extensionError(
            'EXTENSION_VERSION_IMMUTABLE',
            'The version directory already exists with unregistered or different content',
            { extensionId, version: extracted.manifest.version }
          )
        }
        await verifyExtractedExtension(
          destination,
          existing.manifest,
          existing.integrity,
          this.validation.limits
        )
        if (options.select ?? true) {
          await this.switchToInstalled(existing, 'install')
        }
        return existing
      }

      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      const record = toInstalledRecord(
        extracted,
        destination,
        options.source ?? { type: 'local', locator: resolve(archivePath) },
        options.grantedPermissions,
        this.now()
      )

      if (options.select ?? true) {
        const from = await resolveOptional(this.registry, extensionId)
        const preparedSwitch: VersionSwitchContext = {
          extensionId,
          from,
          // Migration/admission executes the new entrypoint from staging.
          // The immutable canonical directory is moved only at the registry
          // commit boundary, closing the crash window before journaling.
          to: {
            ...installedToResolved(extensionId, record),
            packagePath: extractedPath
          },
          reason: 'install'
        }
        await this.performVersionSwitch(preparedSwitch, async () => {
          await verifyExtractedExtension(
            extractedPath,
            record.manifest,
            record.integrity,
            this.validation.limits
          )
          await rename(extractedPath, destination)
          moved = true
          await makePackageTreeReadOnly(destination)
          await this.registry.registerVersion(extensionId, record, {
            select: options.select,
            enable: options.enable
          })
        })
      } else {
        await rename(extractedPath, destination)
        moved = true
        await makePackageTreeReadOnly(destination)
        await this.registry.registerVersion(extensionId, record, {
          select: false,
          enable: options.enable
        })
      }
      return record
    } catch (error) {
      if (moved && destination !== '') {
        await makeTreeWritable(destination).catch(() => undefined)
        await rm(destination, { recursive: true, force: true }).catch(() => undefined)
      }
      throw error
    } finally {
      await makeTreeWritable(staging).catch(() => undefined)
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async selectVersion(extensionId: string, version: string): Promise<void> {
    await this.recover(extensionId)
    const entry = await this.registry.get(extensionId)
    const target = entry?.versions[version]
    if (target === undefined) {
      throw extensionError('EXTENSION_VERSION_NOT_INSTALLED', 'Extension version is not installed', {
        extensionId,
        version
      })
    }
    this.admitManifest(target.manifest)
    await verifyExtractedExtension(
      target.packagePath,
      target.manifest,
      target.integrity,
      this.validation.limits
    )
    await this.switchToInstalled(target, 'select')
  }

  async rollback(extensionId: string): Promise<void> {
    await this.recover(extensionId)
    const entry = await this.registry.get(extensionId)
    const targetVersion = entry?.previousSelectedVersion
    const target = targetVersion === undefined ? undefined : entry?.versions[targetVersion]
    if (target === undefined) {
      throw extensionError('EXTENSION_ROLLBACK_UNAVAILABLE', 'No retained previous version is available', {
        extensionId,
        targetVersion
      })
    }
    this.admitManifest(target.manifest)
    await verifyExtractedExtension(
      target.packagePath,
      target.manifest,
      target.integrity,
      this.validation.limits
    )
    const from = await resolveOptional(this.registry, extensionId)
    const context: VersionSwitchContext = {
      extensionId,
      from,
      to: installedToResolved(extensionId, target),
      reason: 'rollback'
    }
    await this.performVersionSwitch(context, async () => {
      await this.registry.rollback(extensionId)
    })
  }

  async setGlobalEnabled(extensionId: string, enabled: boolean): Promise<void> {
    await this.recover(extensionId)
    await this.serializeExtension(extensionId, async () => {
      if (!enabled) await this.lifecycle.beforeDisable?.(extensionId)
      await this.registry.setGlobalEnabled(extensionId, enabled)
    })
  }

  async setWorkspaceEnabled(
    extensionId: string,
    workspaceKey: string,
    enabled: boolean | undefined,
    workspaceRoot?: string
  ): Promise<void> {
    await this.recover(extensionId)
    await this.serializeExtension(extensionId, async () => {
      if (enabled === false) {
        await this.lifecycle.beforeDisable?.(extensionId, workspaceKey, workspaceRoot)
      }
      await this.registry.setWorkspaceEnabled(extensionId, workspaceKey, enabled)
    })
  }

  async setWorkspacePermissionGrant(
    extensionId: string,
    workspaceKey: string,
    permissions: string[] | undefined,
    expectedVersion: string,
    workspaceRoot?: string
  ): Promise<void> {
    await this.serializeExtension(extensionId, async () => {
      await this.recover(extensionId)
      const selected = await this.registry.resolve(extensionId)
      if (selected.version !== expectedVersion) {
        throw extensionError(
          'EXTENSION_VERSION_CONFLICT',
          'Extension version changed; repeat the permission review',
          {
            extensionId,
            expectedVersion,
            currentVersion: selected.version
          }
        )
      }
      await this.lifecycle.beforePermissionChange?.(extensionId, workspaceKey, workspaceRoot)
      await this.registry.setWorkspacePermissionGrant(
        extensionId,
        workspaceKey,
        permissions,
        expectedVersion
      )
    })
  }

  async uninstallVersion(extensionId: string, version: string): Promise<void> {
    await this.recover(extensionId)
    await this.serializeExtension(extensionId, () => this.uninstallVersionUnlocked(extensionId, version))
  }

  private async uninstallVersionUnlocked(extensionId: string, version: string): Promise<void> {
    const entry = await this.registry.get(extensionId)
    const record = entry?.versions[version]
    if (record === undefined) {
      throw extensionError('EXTENSION_VERSION_NOT_INSTALLED', 'Extension version is not installed', {
        extensionId,
        version
      })
    }
    if (entry?.selectedVersion === version || entry?.previousSelectedVersion === version) {
      await this.lifecycle.beforeUninstall?.(extensionId)
    }
    const quarantine = await quarantinePath(record.packagePath, this.paths.stagingRoot)
    try {
      await this.registry.removeVersion(extensionId, version)
    } catch (error) {
      await rename(quarantine, record.packagePath).catch(() => undefined)
      throw error
    }
    await makeTreeWritable(quarantine).catch(() => undefined)
    await rm(quarantine, { recursive: true, force: true })
  }

  async uninstall(extensionId: string): Promise<void> {
    await this.recover(extensionId)
    await this.serializeExtension(extensionId, () => this.uninstallUnlocked(extensionId))
  }

  private async uninstallUnlocked(extensionId: string): Promise<void> {
    const entry = await this.registry.get(extensionId)
    if (entry === undefined) {
      throw extensionError('EXTENSION_NOT_INSTALLED', 'Extension is not installed', { extensionId })
    }
    await this.lifecycle.beforeUninstall?.(extensionId)
    await mkdir(this.paths.stagingRoot, { recursive: true, mode: 0o700 })
    const extensionPackageRoot = join(this.paths.packageRoot, extensionId)
    const quarantine = (await pathExists(extensionPackageRoot))
      ? await quarantinePath(extensionPackageRoot, this.paths.stagingRoot)
      : undefined
    try {
      await this.registry.removeExtension(extensionId)
    } catch (error) {
      if (quarantine !== undefined) await rename(quarantine, extensionPackageRoot).catch(() => undefined)
      throw error
    }
    if (quarantine !== undefined) {
      await makeTreeWritable(quarantine).catch(() => undefined)
      await rm(quarantine, { recursive: true, force: true })
    }
  }

  async registerDevelopment(
    sourceDirectory: string,
    options: { grantedPermissions: string[]; enable?: boolean; select?: boolean }
  ): Promise<DevelopmentExtensionRecord> {
    const inspection = await inspectDevelopmentDirectory(sourceDirectory, this.validation)
    this.admitManifest(inspection.manifest)
    validatePermissionGrant(inspection.manifest.permissions, options.grantedPermissions)
    const extensionId = manifestId(inspection.manifest)
    await this.recover(extensionId)
    const timestamp = this.now().toISOString()
    const development: DevelopmentExtensionRecord = {
      path: inspection.path,
      source: { type: 'development', locator: inspection.path },
      digest: inspection.digest,
      manifest: inspection.manifest,
      requestedPermissions: [...inspection.manifest.permissions].sort(),
      grantedPermissions: [...options.grantedPermissions].sort(),
      registeredAt: timestamp,
      reloadedAt: timestamp,
      generation: 1,
      mutable: true
    }
    if (options.select ?? true) {
      const from = await resolveOptional(this.registry, extensionId)
      const context: VersionSwitchContext = {
        extensionId,
        from,
        to: developmentToResolved(extensionId, development),
        reason: 'development-register'
      }
      await this.performVersionSwitch(context, async () => {
        await this.registry.registerDevelopment(extensionId, development, options)
      })
      return development
    }
    await this.serializeExtension(extensionId, async () => {
      await this.registry.registerDevelopment(extensionId, development, options)
    })
    return development
  }

  async reloadDevelopment(extensionId: string): Promise<DevelopmentExtensionRecord> {
    await this.recover(extensionId)
    const entry = await this.registry.get(extensionId)
    const current = entry?.development
    if (current === undefined) {
      throw extensionError('EXTENSION_DEVELOPMENT_NOT_REGISTERED', 'Development source is not registered', {
        extensionId
      })
    }
    const inspection = await inspectDevelopmentDirectory(current.path, this.validation)
    this.admitManifest(inspection.manifest)
    if (manifestId(inspection.manifest) !== extensionId) {
      throw extensionError(
        'EXTENSION_DEVELOPMENT_ID_CHANGED',
        'Development extension identity cannot change during reload',
        { extensionId, current: manifestId(inspection.manifest) }
      )
    }
    validatePermissionGrant(inspection.manifest.permissions, current.grantedPermissions)
    const nextDevelopment: DevelopmentExtensionRecord = {
      path: inspection.path,
      source: current.source,
      digest: inspection.digest,
      manifest: inspection.manifest,
      requestedPermissions: [...inspection.manifest.permissions].sort(),
      grantedPermissions: [...current.grantedPermissions],
      registeredAt: current.registeredAt,
      reloadedAt: this.now().toISOString(),
      generation: current.generation + 1,
      mutable: true
    }
    const context: VersionSwitchContext = {
      extensionId,
      from: await resolveOptional(this.registry, extensionId),
      to: developmentToResolved(extensionId, nextDevelopment),
      reason: 'development-reload'
    }
    const replacement = {
      path: inspection.path,
      source: current.source,
      digest: inspection.digest,
      manifest: inspection.manifest,
      requestedPermissions: [...inspection.manifest.permissions].sort(),
      grantedPermissions: [...current.grantedPermissions],
      reloadedAt: this.now().toISOString(),
      mutable: true as const
    }
    let updated
    if (entry?.useDevelopment) {
      await this.performVersionSwitch(context, async () => {
        updated = await this.registry.reloadDevelopment(extensionId, replacement)
      })
    } else {
      await this.serializeExtension(extensionId, async () => {
        updated = await this.registry.reloadDevelopment(extensionId, replacement)
      })
    }
    return updated!.development!
  }

  async resolveForActivation(extensionId: string, workspaceKey?: string): Promise<ResolvedExtension> {
    return this.serializeExtension(
      extensionId,
      () => this.resolveForActivationSerialized(extensionId, workspaceKey)
    )
  }

  private async resolveForActivationSerialized(
    extensionId: string,
    workspaceKey?: string
  ): Promise<ResolvedExtension> {
    await this.recover(extensionId)
    if (workspaceKey !== undefined && !(await this.registry.isWorkspaceTrusted(extensionId, workspaceKey))) {
      throw extensionError(
        'EXTENSION_WORKSPACE_UNTRUSTED',
        'Extension activation requires an explicitly trusted workspace',
        { extensionId, workspaceKey }
      )
    }
    if (!(await this.registry.isEnabled(extensionId, workspaceKey))) {
      throw extensionError('EXTENSION_DISABLED', 'Extension is disabled in this scope', {
        extensionId,
        workspaceKey
      })
    }
    const resolved = await this.registry.resolve(extensionId, workspaceKey)
    if (resolved.development) {
      const current = await inspectDevelopmentDirectory(resolved.packagePath, this.validation)
      const entry = await this.registry.get(extensionId)
      if (entry?.development?.digest !== current.digest) {
        throw extensionError(
          'EXTENSION_DEVELOPMENT_RELOAD_REQUIRED',
          'Development source changed; explicit reload is required',
          { extensionId, generation: resolved.generation }
        )
      }
    } else {
      const entry = await this.registry.get(extensionId)
      const record = entry?.versions[resolved.version]
      if (record === undefined) {
        throw extensionError('EXTENSION_VERSION_UNAVAILABLE', 'Selected extension version is unavailable', {
          extensionId,
          version: resolved.version
        })
      }
      await verifyExtractedExtension(
        record.packagePath,
        record.manifest,
        record.integrity,
        this.validation.limits
      )
    }
    this.admitManifest(resolved.manifest)
    return resolved
  }

  private async switchToInstalled(
    target: InstalledExtensionVersion,
    reason: 'install' | 'select'
  ): Promise<void> {
    this.admitManifest(target.manifest)
    const extensionId = manifestId(target.manifest)
    const from = await resolveOptional(this.registry, extensionId)
    const context: VersionSwitchContext = {
      extensionId,
      from,
      to: installedToResolved(extensionId, target),
      reason
    }
    await this.performVersionSwitch(context, async () => {
      await this.registry.selectVersion(extensionId, target.version)
    })
  }

  private async performVersionSwitch(
    context: VersionSwitchContext,
    commitSelection: () => Promise<void>
  ): Promise<void> {
    await this.serializeExtension(context.extensionId, async () => {
      if (this.lifecycle.runVersionSwitch !== undefined) {
        await this.lifecycle.runVersionSwitch(context, commitSelection)
        return
      }
      await this.lifecycle.beforeVersionSwitch?.(context)
      try {
        await commitSelection()
      } catch (error) {
        await rethrowAfterSwitchRollback(this.lifecycle, context, error)
      }
    })
  }

  private serializeExtension<T>(
    extensionId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const prior = this.operations.get(extensionId) ?? Promise.resolve()
    const result = prior.then(operation, operation)
    this.operations.set(extensionId, result.then(
      () => undefined,
      () => undefined
    ))
    return result
  }

  private async cleanupInterruptedInstallArtifacts(): Promise<void> {
    const stagingEntries = await readdir(this.paths.stagingRoot, { withFileTypes: true })
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
        throw error
    })
    for (const entry of stagingEntries) {
      if (!entry.name.startsWith('install-') && !entry.name.startsWith('recovery-')) continue
      const path = join(this.paths.stagingRoot, entry.name)
      if (!entry.isSymbolicLink()) await makeTreeWritable(path).catch(() => undefined)
      await rm(path, { recursive: !entry.isSymbolicLink(), force: true })
    }

    const registry = await this.registry.read()
    const packageEntries = await readdir(this.paths.packageRoot, { withFileTypes: true })
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
        throw error
      })
    for (const extensionEntry of packageEntries) {
      if (!extensionEntry.isDirectory() || !isExtensionId(extensionEntry.name)) continue
      const extensionId = extensionEntry.name
      const registeredPaths = new Set(
        Object.values(registry.extensions[extensionId]?.versions ?? {})
          .map((version) => version.packagePath)
      )
      const extensionRoot = join(this.paths.packageRoot, extensionId)
      const versionEntries = await readdir(extensionRoot, { withFileTypes: true })
      for (const versionEntry of versionEntries) {
        const candidate = join(extensionRoot, versionEntry.name)
        if (registeredPaths.has(candidate)) continue
        if (versionEntry.isSymbolicLink()) {
          await rm(candidate, { force: true })
          continue
        }
        if (!versionEntry.isDirectory()) continue
        await makeTreeWritable(candidate)
        await rm(candidate, { recursive: true, force: true })
      }
    }
  }
}

function toInstalledRecord(
  extracted: ExtractedKunx,
  packagePath: string,
  source: ExtensionSource,
  grantedPermissions: string[],
  installedAt: Date
): InstalledExtensionVersion {
  return {
    version: extracted.manifest.version,
    packagePath,
    archiveSha256: extracted.archiveSha256,
    integrity: extracted.integrity,
    source: structuredClone(source),
    signatureStatus: extracted.signatureStatus,
    requestedPermissions: [...extracted.manifest.permissions].sort(),
    grantedPermissions: [...grantedPermissions].sort(),
    installedAt: installedAt.toISOString(),
    manifest: structuredClone(extracted.manifest),
    mutable: false
  }
}

function validatePermissionGrant(requested: string[], granted: string[]): void {
  const expected = [...new Set(requested)].sort()
  const actual = [...new Set(granted)].sort()
  if (expected.length !== actual.length || expected.some((permission, index) => permission !== actual[index])) {
    throw extensionError(
      'EXTENSION_PERMISSION_CONSENT_REQUIRED',
      'Permission grant must exactly match the requested permission set',
      { requested: expected, granted: actual }
    )
  }
}

function validateExpectedPackage(
  extracted: ExtractedKunx,
  expected: ExpectedIndexedPackage | undefined
): void {
  if (expected === undefined) return
  const actualPermissions = [...extracted.manifest.permissions].sort()
  const expectedPermissions = [...expected.permissions].sort()
  const mismatches: string[] = []
  if (manifestId(extracted.manifest) !== expected.extensionId) mismatches.push('id')
  if (extracted.manifest.version !== expected.version) mismatches.push('version')
  if (extracted.archiveSha256 !== expected.archiveSha256) mismatches.push('sha256')
  if (extracted.manifest.engines.kun !== expected.enginesKun) mismatches.push('engines.kun')
  if (extracted.manifest.apiVersion !== expected.apiVersion) mismatches.push('apiVersion')
  if (canonicalJson(extracted.manifest.signature) !== canonicalJson(expected.signature)) {
    mismatches.push('signature')
  }
  if (
    actualPermissions.length !== expectedPermissions.length ||
    actualPermissions.some((permission, index) => permission !== expectedPermissions[index])
  ) {
    mismatches.push('permissions')
  }
  if (mismatches.length > 0) {
    throw extensionError('EXTENSION_INDEX_PACKAGE_MISMATCH', 'Index metadata and package disagree', {
      mismatches
    })
  }
}

async function resolveOptional(
  registry: ExtensionRegistry,
  extensionId: string
): Promise<ResolvedExtension | undefined> {
  try {
    return await registry.resolve(extensionId)
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (
      code === 'EXTENSION_NOT_INSTALLED' ||
      code === 'EXTENSION_VERSION_NOT_SELECTED' ||
      code === 'EXTENSION_DEVELOPMENT_UNAVAILABLE'
    ) {
      return undefined
    }
    throw error
  }
}

async function quarantinePath(sourcePath: string, stagingRoot: string): Promise<string> {
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 })
  await makeTreeWritable(sourcePath).catch(() => undefined)
  const target = join(stagingRoot, `remove-${randomUUID()}`)
  await rename(sourcePath, target)
  return target
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

function isExtensionId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/.test(value)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false
    throw error
  }
}

function installedToResolved(
  extensionId: string,
  record: InstalledExtensionVersion
): ResolvedExtension {
  return {
    id: extensionId,
    version: record.version,
    packagePath: record.packagePath,
    manifest: structuredClone(record.manifest),
    requestedPermissions: [...record.requestedPermissions],
    grantedPermissions: [...record.grantedPermissions],
    source: structuredClone(record.source),
    development: false
  }
}

function developmentToResolved(
  extensionId: string,
  record: DevelopmentExtensionRecord
): ResolvedExtension {
  return {
    id: extensionId,
    version: record.manifest.version,
    packagePath: record.path,
    manifest: structuredClone(record.manifest),
    requestedPermissions: [...record.requestedPermissions],
    grantedPermissions: [...record.grantedPermissions],
    source: structuredClone(record.source),
    development: true,
    generation: record.generation
  }
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return ''
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

async function rethrowAfterSwitchRollback(
  lifecycle: ExtensionPackageLifecycle,
  context: VersionSwitchContext,
  error: unknown
): Promise<never> {
  try {
    await lifecycle.versionSwitchFailed?.(context, error)
  } catch (rollbackError) {
    throw extensionError(
      'EXTENSION_VERSION_SWITCH_ROLLBACK_FAILED',
      'Extension version switch failed and state rollback was unsuccessful',
      { extensionId: context.extensionId },
      rollbackError
    )
  }
  throw error
}
