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
} from '../src/extensions/index.js'

const compatibility: ExtensionCompatibility = {
  kunVersion: '0.1.0',
  supportedManifestVersions: [1],
  supportedApiVersions: ['1.0.0']
}

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

      await expect(writeFile(join(v1.packagePath, 'tamper.txt'), 'nope')).rejects.toBeDefined()
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
      let admissionSettled = false
      const admission = manager.resolveForActivation('acme.demo', workspaceKey).finally(() => {
        admissionSettled = true
      })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(admissionSettled).toBe(false)

      releasePermissionChange()
      await revoking
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

  it('packs a manifest allowlist and applies explicit safe include and ignore paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-pack-selection-'))
    try {
      const source = join(root, 'source')
      await writeExtensionSource(source, '1.0.0')
      await mkdir(join(source, 'node_modules/dependency'), { recursive: true })
      await mkdir(join(source, '.git/objects'), { recursive: true })
      await mkdir(join(source, 'src'), { recursive: true })
      await mkdir(join(source, 'dist/chunks'), { recursive: true })
      await writeFile(join(source, 'node_modules/dependency/index.js'), 'module.exports = 1\n')
      await writeFile(join(source, '.git/config'), '[core]\n')
      await writeFile(join(source, '.env'), 'API_KEY=must-not-ship\n')
      await writeFile(join(source, 'secrets.json'), '{"token":"must-not-ship"}\n')
      await writeFile(join(source, 'private-key.pem'), 'must-not-ship\n')
      await writeFile(join(source, 'src/index.ts'), 'export const sourceOnly = true\n')
      await writeFile(join(source, 'dist/chunks/runtime.js'), 'export const runtime = true\n')
      await writeFile(join(source, 'dist/chunks/debug.map'), '{"sources":[]}\n')

      const defaultPack = await packKunx(source, join(root, 'default.kunx'), { compatibility })
      expect(Object.keys(defaultPack.integrity.files).sort()).toEqual([
        'LICENSE',
        'README.md',
        'dist/main.mjs',
        'kun-extension.json'
      ])

      const selectedPack = await packKunx(source, join(root, 'selected.kunx'), {
        compatibility,
        include: ['dist/chunks'],
        ignore: ['dist/chunks/debug.map']
      })
      expect(Object.keys(selectedPack.integrity.files)).toContain('dist/chunks/runtime.js')
      expect(Object.keys(selectedPack.integrity.files)).not.toContain('dist/chunks/debug.map')
      expect(Object.keys(selectedPack.integrity.files)).not.toContain('.env')

      await expect(
        packKunx(source, join(root, 'escape.kunx'), { compatibility, include: ['../outside'] })
      ).rejects.toMatchObject({ code: 'EXTENSION_PACKAGE_RULE_INVALID' })
      await expect(
        packKunx(source, join(root, 'secret.kunx'), { compatibility, include: ['.env'] })
      ).rejects.toMatchObject({ code: 'EXTENSION_PACKAGE_FORBIDDEN_PATH' })

      if (process.platform !== 'win32') {
        await symlink(root, join(source, 'dist/chunks/escape'))
        await expect(
          packKunx(source, join(root, 'link.kunx'), {
            compatibility,
            include: ['dist/chunks'],
            ignore: ['dist/chunks/debug.map']
          })
        ).rejects.toMatchObject({ code: 'EXTENSION_PACKAGE_LINK_FORBIDDEN' })

        const linkedSource = join(root, 'linked-source')
        await mkdir(join(linkedSource, 'dist'), { recursive: true })
        await writeFile(join(linkedSource, 'README.md'), '# Linked manifest\n')
        await writeFile(join(linkedSource, 'LICENSE'), 'MIT\n')
        await writeFile(join(linkedSource, 'dist/main.mjs'), 'export async function activate() {}\n')
        await symlink(join(source, 'kun-extension.json'), join(linkedSource, 'kun-extension.json'))
        await expect(
          packKunx(linkedSource, join(root, 'manifest-link.kunx'), { compatibility })
        ).rejects.toMatchObject({ code: 'EXTENSION_PACKAGE_LINK_FORBIDDEN' })

        const linkedRoot = join(root, 'linked-root')
        await symlink(source, linkedRoot)
        await expect(
          packKunx(linkedRoot, join(root, 'source-link.kunx'), { compatibility })
        ).rejects.toMatchObject({ code: 'EXTENSION_PACKAGE_SOURCE_INVALID' })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects traversal, case collisions, symlinks, integrity mismatches, and package limits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-attacks-'))
    try {
      const collision = join(root, 'collision.kunx')
      await writeZip(collision, [
        ['A.txt', Buffer.from('a'), 0o100644],
        ['a.txt', Buffer.from('b'), 0o100644]
      ])
      await expect(
        extractKunxArchive(collision, join(root, 'collision-out'))
      ).rejects.toMatchObject({ code: 'EXTENSION_ARCHIVE_PATH_COLLISION' })

      const symlink = join(root, 'symlink.kunx')
      await writeZip(symlink, [['link', Buffer.from('../outside'), 0o120777]])
      await expect(
        extractKunxArchive(symlink, join(root, 'symlink-out'))
      ).rejects.toMatchObject({ code: 'EXTENSION_ARCHIVE_LINK_FORBIDDEN' })

      const traversalBase = join(root, 'traversal-base.kunx')
      await writeZip(traversalBase, [['abcd', Buffer.from('x'), 0o100644]])
      const traversalBytes = Buffer.from(await readFile(traversalBase))
      replaceAllAscii(traversalBytes, 'abcd', '../x')
      const traversal = join(root, 'traversal.kunx')
      await writeFile(traversal, traversalBytes)
      await expect(
        extractKunxArchive(traversal, join(root, 'traversal-out'))
      ).rejects.toMatchObject({ code: 'EXTENSION_ARCHIVE_INVALID' })
      await expect(readFile(join(root, 'x'))).rejects.toMatchObject({ code: 'ENOENT' })

      const invalidIntegrity = join(root, 'invalid-integrity.kunx')
      const manifest = manifestFor('1.0.0')
      const files = requiredFiles(manifest)
      const integrity = integrityFor(files)
      integrity.files['dist/main.mjs'] = '0'.repeat(64)
      await writeZip(invalidIntegrity, [
        ...Object.entries(files).map(([path, contents]) => [path, contents, 0o100644] as const),
        [EXTENSION_INTEGRITY_FILE, Buffer.from(JSON.stringify(integrity)), 0o100644]
      ])
      await expect(
        inspectKunxArchive(invalidIntegrity, { compatibility })
      ).rejects.toMatchObject({ code: 'EXTENSION_PACKAGE_INTEGRITY_MISMATCH' })

      const source = join(root, 'large-source')
      await writeExtensionSource(source, '1.0.0')
      await writeFile(join(source, 'large.bin'), Buffer.alloc(1_024))
      await expect(
        packKunx(source, join(root, 'large.kunx'), {
          include: ['large.bin'],
          limits: { maxFileBytes: 512 }
        })
      ).rejects.toMatchObject({ code: 'EXTENSION_ARCHIVE_LIMIT_EXCEEDED' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('registers mutable development sources but reloads only explicitly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-dev-'))
    try {
      const source = join(root, 'dev-extension')
      await writeExtensionSource(source, '1.0.0')
      await mkdir(join(source, 'dist/assets'), { recursive: true })
      await writeFile(join(source, 'dist/view.html'), '<main>Demo</main>\n')
      await writeFile(join(source, 'dist/assets/theme.css'), 'main { color: black; }\n')
      await writeFile(
        join(source, 'kun-extension.json'),
        `${JSON.stringify({
          ...manifestFor('1.0.0'),
          contributes: {
            'views.rightSidebar': [{
              id: 'demo-view',
              title: 'Demo',
              entry: 'dist/view.html',
              order: 0,
              multiple: false,
              localResourceRoots: ['dist/assets']
            }]
          },
          permissions: ['ui.views', 'webview']
        }, null, 2)}\n`
      )
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const registry = new ExtensionRegistry(paths)
      const manager = new ExtensionPackageManager(paths, registry, { compatibility })
      const registered = await manager.registerDevelopment(source, {
        grantedPermissions: ['ui.views', 'webview']
      })
      expect(registered.path).toBe(source)
      expect((await registry.resolve('acme.demo')).development).toBe(true)

      await writeFile(join(source, 'dist/main.mjs'), 'export const changed = true\n')
      await expect(manager.resolveForActivation('acme.demo')).rejects.toMatchObject({
        code: 'EXTENSION_DEVELOPMENT_RELOAD_REQUIRED'
      })
      const reloaded = await manager.reloadDevelopment('acme.demo')
      expect(reloaded.generation).toBe(2)
      await expect(manager.resolveForActivation('acme.demo')).resolves.toMatchObject({
        development: true,
        generation: 2
      })

      await writeFile(join(source, 'dist/assets/theme.css'), 'main { color: blue; }\n')
      await expect(manager.resolveForActivation('acme.demo')).rejects.toMatchObject({
        code: 'EXTENSION_DEVELOPMENT_RELOAD_REQUIRED'
      })
      await expect(manager.reloadDevelopment('acme.demo')).resolves.toMatchObject({
        generation: 3
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('loads an HTTPS Index only on explicit request and installs the exact digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-index-'))
    try {
      const source = join(root, 'source')
      const archive = join(root, 'package.kunx')
      await writeExtensionSource(source, '1.2.3')
      const packed = await packKunx(source, archive, { compatibility })
      const packageBytes = await readFile(archive)
      const index = {
        schemaVersion: 1,
        extensions: [{
          id: 'acme.demo',
          name: 'Demo',
          publisher: 'acme',
          versions: [{
            version: '1.2.3',
            url: 'https://plugins.example/acme.demo-1.2.3.kunx',
            sha256: packed.archiveSha256,
            engines: { kun: '*' },
            apiVersion: '1.0.0',
            permissions: []
          }]
        }]
      }
      const requests: string[] = []
      const client = new ExtensionIndexClient({
        fetch: (async (input: string | URL | Request) => {
          const url = String(input)
          requests.push(url)
          if (url.endsWith('index.json')) {
            return new Response(JSON.stringify(index), {
              status: 200,
              headers: { 'content-type': 'application/json' }
            })
          }
          return new Response(packageBytes, { status: 200 })
        }) as typeof fetch
      })
      expect(requests).toEqual([])

      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const registry = new ExtensionRegistry(paths)
      const manager = new ExtensionPackageManager(paths, registry, { compatibility })
      await client.installExact(
        'https://plugins.example/index.json',
        'acme.demo',
        '1.2.3',
        manager,
        { grantedPermissions: [] }
      )
      expect(requests).toEqual([
        'https://plugins.example/index.json',
        'https://plugins.example/acme.demo-1.2.3.kunx'
      ])
      expect((await registry.get('acme.demo'))?.versions['1.2.3']?.source).toMatchObject({
        type: 'index',
        indexUrl: 'https://plugins.example/index.json'
      })
    } finally {
      await makeWritable(root)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects every HTTPS redirect hop that downgrades an index or package request', async () => {
    const indexClient = new ExtensionIndexClient({
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.redirect).toBe('manual')
        return new Response(null, {
          status: 302,
          headers: { location: 'http://attacker.example/index.json' }
        })
      }) as typeof fetch
    })
    await expect(indexClient.load('https://plugins.example/index.json')).rejects.toMatchObject({
      code: 'EXTENSION_INDEX_HTTPS_REQUIRED'
    })

    const root = await mkdtemp(join(tmpdir(), 'kun-extension-index-redirect-'))
    try {
      const index = {
        schemaVersion: 1,
        extensions: [{
          id: 'acme.demo',
          name: 'Demo',
          publisher: 'acme',
          versions: [{
            version: '1.2.3',
            url: 'https://plugins.example/acme.demo-1.2.3.kunx',
            sha256: 'a'.repeat(64),
            engines: { kun: '*' },
            apiVersion: '1.0.0',
            permissions: []
          }]
        }]
      }
      const packageClient = new ExtensionIndexClient({
        fetch: (async (input: string | URL | Request, init?: RequestInit) => {
          expect(init?.redirect).toBe('manual')
          return String(input).endsWith('index.json')
            ? new Response(JSON.stringify(index), { status: 200 })
            : new Response(null, {
                status: 307,
                headers: { location: 'http://attacker.example/package.kunx' }
              })
        }) as typeof fetch
      })
      const paths = new ExtensionPaths({
        packageRoot: join(root, 'extensions'),
        dataRoot: join(root, 'data')
      })
      const manager = new ExtensionPackageManager(
        paths,
        new ExtensionRegistry(paths),
        { compatibility }
      )
      await expect(packageClient.installExact(
        'https://plugins.example/index.json',
        'acme.demo',
        '1.2.3',
        manager,
        { grantedPermissions: [] }
      )).rejects.toMatchObject({ code: 'EXTENSION_INDEX_HTTPS_REQUIRED' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the Manifest Ed25519 signature shape for Index v1 metadata', async () => {
    const version = {
      version: '1.2.3',
      url: 'https://plugins.example/acme.demo-1.2.3.kunx',
      sha256: 'a'.repeat(64),
      engines: { kun: '*' },
      apiVersion: '1.0.0',
      permissions: []
    }
    const indexWith = (signature: Record<string, unknown>) => ({
      schemaVersion: 1,
      extensions: [{
        id: 'acme.demo',
        name: 'Demo',
        publisher: 'acme',
        versions: [{ ...version, signature }]
      }]
    })
    const clientFor = (body: unknown) => new ExtensionIndexClient({
      fetch: (async () => new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })) as typeof fetch
    })

    await expect(clientFor(indexWith({
      algorithm: 'ed25519',
      keyId: 'acme-release-2026',
      value: 'base64-signature'
    })).load('https://plugins.example/index.json')).resolves.toMatchObject({
      extensions: [{ versions: [{ signature: { algorithm: 'ed25519' } }] }]
    })
    await expect(clientFor(indexWith({
      kind: 'ed25519',
      value: 'legacy-documentation-shape'
    })).load('https://plugins.example/index.json')).rejects.toMatchObject({
      code: 'EXTENSION_INDEX_INVALID'
    })
  })
})

async function writeExtensionSource(
  root: string,
  version: string,
  stateSchemaVersion = 0,
  permissions: string[] = []
): Promise<void> {
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(
    join(root, 'kun-extension.json'),
    `${JSON.stringify(manifestFor(version, stateSchemaVersion, permissions), null, 2)}\n`
  )
  await writeFile(join(root, 'README.md'), '# Demo\n')
  await writeFile(join(root, 'LICENSE'), 'MIT\n')
  await writeFile(join(root, 'dist/main.mjs'), 'export async function activate() {}\n')
}

function manifestFor(version: string, stateSchemaVersion = 0, permissions: string[] = []) {
  return {
    publisher: 'acme',
    name: 'demo',
    displayName: 'Demo',
    version,
    manifestVersion: 1,
    apiVersion: '1.0.0',
    engines: { kun: '*' },
    main: 'dist/main.mjs',
    activationEvents: ['onStartup'],
    contributes: {},
    permissions,
    stateSchemaVersion
  }
}

function requiredFiles(manifest: ReturnType<typeof manifestFor>): Record<string, Buffer> {
  return {
    'kun-extension.json': Buffer.from(JSON.stringify(manifest)),
    'README.md': Buffer.from('# Demo\n'),
    LICENSE: Buffer.from('MIT\n'),
    'dist/main.mjs': Buffer.from('export async function activate() {}\n')
  }
}

function integrityFor(files: Record<string, Buffer>) {
  return {
    algorithm: 'sha256' as const,
    files: Object.fromEntries(
      Object.entries(files).map(([path, contents]) => [
        path,
        createHash('sha256').update(contents).digest('hex')
      ])
    )
  }
}

async function writeZip(
  path: string,
  entries: ReadonlyArray<readonly [string, Buffer, number]>
): Promise<void> {
  const zip = new yazl.ZipFile()
  for (const [entryPath, contents, mode] of entries) {
    zip.addBuffer(contents, entryPath, {
      mtime: new Date('1980-01-01T00:00:00.000Z'),
      mode,
      compress: true
    })
  }
  const chunks: Buffer[] = []
  zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk))
  const complete = new Promise<void>((resolvePromise, reject) => {
    zip.outputStream.once('end', resolvePromise)
    zip.outputStream.once('error', reject)
  })
  zip.end()
  await complete
  await writeFile(path, Buffer.concat(chunks))
}

function replaceAllAscii(buffer: Buffer, from: string, to: string): void {
  expect(Buffer.byteLength(from)).toBe(Buffer.byteLength(to))
  const source = Buffer.from(from)
  const replacement = Buffer.from(to)
  let offset = 0
  let replacements = 0
  while ((offset = buffer.indexOf(source, offset)) >= 0) {
    replacement.copy(buffer, offset)
    offset += replacement.length
    replacements += 1
  }
  expect(replacements).toBeGreaterThanOrEqual(2)
}

async function makeWritable(root: string): Promise<void> {
  if (process.platform === 'win32') return
  const { chmod, lstat, readdir } = await import('node:fs/promises')
  const visit = async (path: string): Promise<void> => {
    const details = await lstat(path).catch(() => undefined)
    if (details === undefined) return
    if (!details.isDirectory()) {
      await chmod(path, 0o600)
      return
    }
    await chmod(path, 0o700)
    for (const entry of await readdir(path)) await visit(join(path, entry))
  }
  await visit(root)
}
