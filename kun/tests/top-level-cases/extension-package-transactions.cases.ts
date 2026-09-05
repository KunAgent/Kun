import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as yazl from 'yazl'
import { describe, expect, it, vi } from 'vitest'
import {
  EXTENSION_INTEGRITY_FILE,
  ExtensionIndexClient,
  ExtensionPackageManager,
  ExtensionPaths,
  ExtensionRegistry,
  ExtensionStateMigrationCoordinator,
  ExtensionStateStore,
  extractKunxArchive,
  inspectKunxArchive,
  packKunx,
  type ExtensionCompatibility,
  type ExtensionManager,
  type JsonValue,
  type ResolvedExtension
} from '../../src/extensions/index.js'
import { compatibility, integrityFor, makeWritable, manifestFor, replaceAllAscii, requiredFiles, writeExtensionSource, writeZip } from '../support/extension-package-fixtures.js'

describe('extension package management', () => {
  it('packs deterministically, installs immutable versions, persists enablement, and rolls back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-package-'))
    try {
      const source = join(root, 'source')
      const v1Archive = join(root, 'acme.demo-1.0.0.kunx')
      const v1ArchiveAgain = join(root, 'acme.demo-1.0.0-again.kunx')
      await writeExtensionSource(source, '1.0.0')
      const first = await packKunx(source, v1Archive, { compatibility })
      const second = await packKunx(source, v1ArchiveAgain, { compatibility })
      expect(first.archiveSha256).toBe(second.archiveSha256)
      expect(`${first.manifest.publisher}.${first.manifest.name}`).toBe('acme.demo')

      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'extension-data')
      })
      const registry = new ExtensionRegistry(paths)
      const manager = new ExtensionPackageManager(paths, registry, { compatibility })
      const v1 = await manager.installArchive(v1Archive, { grantedPermissions: [] })
      expect(v1.packagePath).toBe(paths.packageVersion('acme.demo', '1.0.0'))

      await Promise.all(Array.from({ length: 12 }, (_, index) =>
        registry.setWorkspaceEnabled(
          'acme.demo',
          index.toString(16).padStart(64, '0'),
          index % 2 === 0
        )
      ))
      const persisted = JSON.parse(await readFile(paths.registryFile, 'utf8')) as {
        revision: number
        extensions: Record<string, { selectedVersion: string; workspaceEnablement: object }>
      }
      expect(persisted.revision).toBe(13)
      expect(Object.keys(persisted.extensions['acme.demo']!.workspaceEnablement)).toHaveLength(12)

      await writeExtensionSource(source, '2.0.0')
      const v2Archive = join(root, 'acme.demo-2.0.0.kunx')
      await packKunx(source, v2Archive, { compatibility })
      await manager.installArchive(v2Archive, { grantedPermissions: [] })
      expect((await registry.get('acme.demo'))?.selectedVersion).toBe('2.0.0')
      expect((await registry.get('acme.demo'))?.previousSelectedVersion).toBe('1.0.0')

      await manager.rollback('acme.demo')
      expect((await registry.get('acme.demo'))?.selectedVersion).toBe('1.0.0')
      expect((await registry.get('acme.demo'))?.previousSelectedVersion).toBe('2.0.0')

      if (process.platform !== 'win32') {
        await expect(writeFile(join(v1.packagePath, 'tamper.txt'), 'nope')).rejects.toBeDefined()
      }
      await manager.setGlobalEnabled('acme.demo', false)
      expect(await registry.isEnabled('acme.demo')).toBe(false)
      expect(await registry.publicSnapshot()).toMatchObject({
        schemaVersion: 1,
        extensions: {
          'acme.demo': {
            selectedVersion: '1.0.0',
            previousVersion: '2.0.0',
            enabled: false
          }
        }
      })
    } finally {
      await makeWritable(root)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serializes activation admission behind an in-flight disable transaction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-disable-admission-'))
    try {
      const source = join(root, 'source')
      const archive = join(root, 'acme.demo-1.0.0.kunx')
      await writeExtensionSource(source, '1.0.0')
      await packKunx(source, archive, { compatibility })
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'extension-data')
      })
      const registry = new ExtensionRegistry(paths)
      const manager = new ExtensionPackageManager(paths, registry, { compatibility })
      await manager.installArchive(archive, { grantedPermissions: [] })

      let enteredDisable!: () => void
      let releaseDisable!: () => void
      const disableEntered = new Promise<void>((resolve) => { enteredDisable = resolve })
      const disableGate = new Promise<void>((resolve) => { releaseDisable = resolve })
      manager.setLifecycle({
        beforeDisable: async () => {
          enteredDisable()
          await disableGate
        }
      })

      const disabling = manager.setGlobalEnabled('acme.demo', false)
      await disableEntered
      let admissionSettled = false
      const admission = manager.resolveForActivation('acme.demo').finally(() => {
        admissionSettled = true
      })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(admissionSettled).toBe(false)

      releaseDisable()
      await disabling
      await expect(admission).rejects.toMatchObject({ code: 'EXTENSION_DISABLED' })
    } finally {
      await makeWritable(root)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serializes activation admission behind workspace permission revocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-permission-admission-'))
    try {
      const source = join(root, 'source')
      const archive = join(root, 'acme.demo-1.0.0.kunx')
      await writeExtensionSource(source, '1.0.0', 0, ['commands.register'])
      await packKunx(source, archive, { compatibility })
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'extension-data')
      })
      const registry = new ExtensionRegistry(paths)
      const manager = new ExtensionPackageManager(paths, registry, { compatibility })
      await manager.installArchive(archive, { grantedPermissions: ['commands.register'] })
      const workspaceKey = 'a'.repeat(64)
      await manager.setWorkspacePermissionGrant(
        'acme.demo',
        workspaceKey,
        ['commands.register'],
        '1.0.0'
      )

      let enteredPermissionChange!: () => void
      let releasePermissionChange!: () => void
      const permissionChangeEntered = new Promise<void>((resolve) => {
        enteredPermissionChange = resolve
      })
      const permissionChangeGate = new Promise<void>((resolve) => {
        releasePermissionChange = resolve
      })
      manager.setLifecycle({
        beforePermissionChange: async () => {
          enteredPermissionChange()
          await permissionChangeGate
        }
      })

      const revoking = manager.setWorkspacePermissionGrant(
        'acme.demo',
        workspaceKey,
        undefined,
        '1.0.0'
      )
      await permissionChangeEntered
      let barrierSettled = false
      const barrier = manager.waitForPendingOperation('acme.demo').finally(() => {
        barrierSettled = true
      })
      let admissionSettled = false
      const admission = manager.resolveForActivation('acme.demo', workspaceKey).finally(() => {
        admissionSettled = true
      })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(barrierSettled).toBe(false)
      expect(admissionSettled).toBe(false)

      releasePermissionChange()
      await revoking
      await barrier
      expect(admissionSettled).toBe(true)
      await expect(admission).rejects.toMatchObject({ code: 'EXTENSION_WORKSPACE_UNTRUSTED' })
    } finally {
      await makeWritable(root)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('atomically rejects a stale selected version before changing workspace permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-permission-version-'))
    try {
      const source = join(root, 'source')
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'extension-data')
      })
      const registry = new ExtensionRegistry(paths)
      const manager = new ExtensionPackageManager(paths, registry, { compatibility })

      await writeExtensionSource(source, '1.0.0', 0, ['commands.register'])
      const v1Archive = join(root, 'acme.demo-1.0.0.kunx')
      await packKunx(source, v1Archive, { compatibility })
      await manager.installArchive(v1Archive, { grantedPermissions: ['commands.register'] })

      await writeExtensionSource(source, '2.0.0', 0, ['commands.register'])
      const v2Archive = join(root, 'acme.demo-2.0.0.kunx')
      await packKunx(source, v2Archive, { compatibility })
      await manager.installArchive(v2Archive, { grantedPermissions: ['commands.register'] })

      const workspaceKey = 'b'.repeat(64)
      await registry.setWorkspacePermissionGrant(
        'acme.demo',
        workspaceKey,
        ['commands.register'],
        '2.0.0'
      )
      const before = await registry.read()

      await expect(registry.setWorkspacePermissionGrant(
        'acme.demo',
        workspaceKey,
        undefined,
        '1.0.0'
      )).rejects.toMatchObject({
        code: 'EXTENSION_VERSION_CONFLICT',
        details: {
          extensionId: 'acme.demo',
          expectedVersion: '1.0.0',
          currentVersion: '2.0.0'
        }
      })

      expect(await registry.read()).toEqual(before)
      expect((await registry.get('acme.demo'))?.workspacePermissionGrants[workspaceKey])
        .toEqual(['commands.register'])
    } finally {
      await makeWritable(root)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('requires a fresh workspace review when a selected version adds permission authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-permission-update-'))
    try {
      const source = join(root, 'source')
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'extension-data')
      })
      const registry = new ExtensionRegistry(paths)
      const manager = new ExtensionPackageManager(paths, registry, { compatibility })
      const workspaceKey = 'c'.repeat(64)

      await writeExtensionSource(source, '1.0.0', 0, ['ui.views'])
      const v1Archive = join(root, 'acme.demo-1.0.0.kunx')
      await packKunx(source, v1Archive, { compatibility })
      await manager.installArchive(v1Archive, { grantedPermissions: ['ui.views'] })
      await manager.setWorkspacePermissionGrant(
        'acme.demo',
        workspaceKey,
        ['ui.views'],
        '1.0.0'
      )

      const nextPermissions = ['ui.views', 'workspace.read']
      await writeExtensionSource(source, '2.0.0', 0, nextPermissions)
      const v2Archive = join(root, 'acme.demo-2.0.0.kunx')
      await packKunx(source, v2Archive, { compatibility })
      await manager.installArchive(v2Archive, { grantedPermissions: nextPermissions })

      expect((await registry.get('acme.demo'))?.workspacePermissionGrants).toEqual({})
      expect(await registry.isWorkspaceTrusted('acme.demo', workspaceKey)).toBe(false)
    } finally {
      await makeWritable(root)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('leaves the prior selected version usable when version admission fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-install-rollback-'))
    try {
      const source = join(root, 'source')
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const registry = new ExtensionRegistry(paths)
      const initialManager = new ExtensionPackageManager(paths, registry, { compatibility })
      await writeExtensionSource(source, '1.0.0')
      const v1 = join(root, 'v1.kunx')
      await packKunx(source, v1, { compatibility })
      await initialManager.installArchive(v1, { grantedPermissions: [] })

      await writeExtensionSource(source, '2.0.0')
      const v2 = join(root, 'v2.kunx')
      await packKunx(source, v2, { compatibility })
      const rejectingManager = new ExtensionPackageManager(paths, registry, { compatibility }, {
        async beforeVersionSwitch(context) {
          if (context.to.version === '2.0.0') throw new Error('migration rejected')
        }
      })
      await expect(
        rejectingManager.installArchive(v2, { grantedPermissions: [] })
      ).rejects.toThrow('migration rejected')
      expect((await registry.get('acme.demo'))?.selectedVersion).toBe('1.0.0')
      await expect(readFile(join(paths.packageVersion('acme.demo', '1.0.0'), 'README.md')))
        .resolves.toBeDefined()
      await expect(readFile(join(paths.packageVersion('acme.demo', '2.0.0'), 'README.md')))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await makeWritable(root)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('cleans interrupted staging and unregistered canonical versions during recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-install-recovery-'))
    try {
      const source = join(root, 'source')
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const registry = new ExtensionRegistry(paths)
      const manager = new ExtensionPackageManager(paths, registry, { compatibility })
      await writeExtensionSource(source, '1.0.0')
      const archive = join(root, 'v1.kunx')
      await packKunx(source, archive, { compatibility })
      const installed = await manager.installArchive(archive, { grantedPermissions: [] })

      const staleStaging = join(paths.stagingRoot, 'install-interrupted', 'package')
      const orphanVersion = paths.packageVersion('acme.demo', '2.0.0')
      await mkdir(staleStaging, { recursive: true })
      await mkdir(orphanVersion, { recursive: true })
      await writeFile(join(staleStaging, 'partial.js'), 'partial\n')
      await writeFile(join(orphanVersion, 'partial.js'), 'partial\n')

      await manager.recover()

      await expect(access(join(paths.stagingRoot, 'install-interrupted')))
        .rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(orphanVersion)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(installed.packagePath)).resolves.toBeUndefined()
      expect((await registry.get('acme.demo'))?.selectedVersion).toBe('1.0.0')
    } finally {
      await makeWritable(root)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('commits an installed update and migrated state through one version-switch transaction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-transactional-update-'))
    try {
      const source = join(root, 'source')
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const registry = new ExtensionRegistry(paths)
      const packageManager = new ExtensionPackageManager(paths, registry, { compatibility })
      const state = new ExtensionStateStore(paths)
      const migrateState = vi.fn(async (
        extension: ResolvedExtension,
        _from: number,
        to: number,
        namespace: JsonValue
      ) => {
        expect(extension.packagePath).toContain(`${join('extensions', '.staging')}`)
        await expect(readFile(join(extension.packagePath, 'dist/main.mjs'), 'utf8'))
          .resolves.toContain('activate')
        return { ...(namespace as Record<string, unknown>), migratedTo: to }
      })
      const host = {
        deactivate: async () => undefined,
        migrateState
      } as unknown as ExtensionManager
      const migrations = new ExtensionStateMigrationCoordinator(state, host, registry)
      packageManager.setLifecycle(migrations.lifecycle())

      await writeExtensionSource(source, '1.0.0', 1)
      const v1 = join(root, 'v1.kunx')
      await packKunx(source, v1, { compatibility })
      await packageManager.installArchive(v1, { grantedPermissions: [] })
      expect(migrateState).not.toHaveBeenCalled()
      expect(await state.read('acme.demo')).toMatchObject({ schemaVersion: 1 })
      await state.setGlobal('acme.demo', 'value', 'old')

      await writeExtensionSource(source, '2.0.0', 2)
      const v2 = join(root, 'v2.kunx')
      await packKunx(source, v2, { compatibility })
      await packageManager.installArchive(v2, { grantedPermissions: [] })

      expect((await registry.get('acme.demo'))?.selectedVersion).toBe('2.0.0')
      expect(migrateState).toHaveBeenCalledOnce()
      expect(await state.read('acme.demo')).toMatchObject({
        schemaVersion: 2,
        global: { value: 'old', migratedTo: 2 }
      })
      await expect(access(paths.packageVersion('acme.demo', '2.0.0')))
        .resolves.toBeUndefined()
    } finally {
      await makeWritable(root)
      await rm(root, { recursive: true, force: true })
    }
  })
})
