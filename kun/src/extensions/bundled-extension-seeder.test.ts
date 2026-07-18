import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { packKunx } from './archive.js'
import {
  BUNDLED_EXTENSION_CATALOG_FILE,
  BUNDLED_EXTENSION_SEED_STATE_FILE,
  seedBundledExtensions,
  type BundledExtensionCatalog
} from './bundled-extension-seeder.js'
import { ExtensionPackageManager } from './package-manager.js'
import { ExtensionPaths } from './paths.js'
import { ExtensionRegistry } from './registry.js'
import type { ExtensionCompatibility } from './types.js'

const compatibility: ExtensionCompatibility = {
  kunVersion: '0.1.0',
  supportedManifestVersions: [1],
  supportedApiVersions: ['1.0.0']
}

const roots: string[] = []

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()!
    await makeWritable(root)
    await rm(root, { recursive: true, force: true })
  }
})

describe('bundled extension seeding', () => {
  it('installs a fresh bundle through the standard registry and is idempotent', async () => {
    const harness = await createHarness()
    await writeBundle(harness, '1.0.0', [])

    expect(await seedBundledExtensions(seedOptions(harness))).toEqual([{
      extensionId: 'acme.demo',
      version: '1.0.0',
      outcome: 'installed'
    }])
    expect(await harness.registry.get('acme.demo')).toMatchObject({
      selectedVersion: '1.0.0',
      globallyEnabled: true,
      useDevelopment: false,
      versions: {
        '1.0.0': {
          source: { type: 'local' },
          grantedPermissions: []
        }
      }
    })
    const statePath = join(harness.paths.packageRoot, BUNDLED_EXTENSION_SEED_STATE_FILE)
    const firstState = await readFile(statePath, 'utf8')
    expect(JSON.parse(firstState).extensions['acme.demo']).toMatchObject({
      status: 'seeded',
      managedVersion: '1.0.0'
    })

    expect(await seedBundledExtensions(seedOptions(harness))).toEqual([{
      extensionId: 'acme.demo',
      version: '1.0.0',
      outcome: 'unchanged'
    }])
    expect(await readFile(statePath, 'utf8')).toBe(firstState)
  })

  it('classifies a pre-existing package as user-managed without changing it', async () => {
    const harness = await createHarness()
    const bundle = await writeBundle(harness, '1.0.0', [])
    const userArchive = join(harness.root, 'user-install.kunx')
    await writeSource(harness.source, '1.0.0', [], 'user-owned')
    await packKunx(harness.source, userArchive, { compatibility })
    await harness.manager.installArchive(userArchive, {
      grantedPermissions: [],
      enable: false
    })

    expect(bundle.archive).not.toBe(userArchive)
    expect(await seedBundledExtensions(seedOptions(harness))).toEqual([{
      extensionId: 'acme.demo',
      version: '1.0.0',
      outcome: 'user-managed'
    }])
    expect(await harness.registry.get('acme.demo')).toMatchObject({
      selectedVersion: '1.0.0',
      globallyEnabled: false,
      versions: { '1.0.0': { source: { locator: userArchive } } }
    })
  })

  it('preserves disablement while selecting a safe same-permission update', async () => {
    const harness = await createHarness()
    await writeBundle(harness, '1.0.0', [])
    await seedBundledExtensions(seedOptions(harness))
    await harness.manager.setGlobalEnabled('acme.demo', false)
    await writeBundle(harness, '2.0.0', [])

    expect(await seedBundledExtensions(seedOptions(harness))).toEqual([{
      extensionId: 'acme.demo',
      version: '2.0.0',
      outcome: 'updated-selected'
    }])
    expect(await harness.registry.get('acme.demo')).toMatchObject({
      selectedVersion: '2.0.0',
      previousSelectedVersion: '1.0.0',
      globallyEnabled: false
    })
  })

  it('preserves and narrows workspace authorization across safe bundled updates', async () => {
    const harness = await createHarness()
    const workspaceKey = 'a'.repeat(64)
    const initialPermissions = ['commands.register', 'ui.views']
    await writeBundle(harness, '1.0.0', initialPermissions)
    await seedBundledExtensions(seedOptions(harness))
    await harness.manager.setWorkspacePermissionGrant(
      'acme.demo',
      workspaceKey,
      initialPermissions,
      '1.0.0'
    )

    await writeBundle(harness, '2.0.0', initialPermissions)
    expect(await seedBundledExtensions(seedOptions(harness))).toMatchObject([{
      outcome: 'updated-selected'
    }])
    expect((await harness.registry.get('acme.demo'))?.workspacePermissionGrants[workspaceKey])
      .toEqual(initialPermissions)
    expect(await harness.registry.isWorkspaceTrusted('acme.demo', workspaceKey)).toBe(true)

    await writeBundle(harness, '3.0.0', ['ui.views'])
    expect(await seedBundledExtensions(seedOptions(harness))).toMatchObject([{
      outcome: 'updated-selected'
    }])
    expect((await harness.registry.get('acme.demo'))?.workspacePermissionGrants[workspaceKey])
      .toEqual(['ui.views'])
    const reopenedRegistry = new ExtensionRegistry(harness.paths)
    expect(await reopenedRegistry.isWorkspaceTrusted('acme.demo', workspaceKey)).toBe(true)
  })

  it('upgrades a historical bundle whose Action reused its command ID', async () => {
    const harness = await createHarness()
    const permissions = ['commands.register', 'ui.actions']
    await writeBundle(harness, '1.0.0', permissions)
    await seedBundledExtensions(seedOptions(harness))

    const registry = JSON.parse(await readFile(harness.paths.registryFile, 'utf8'))
    const manifest = registry.extensions['acme.demo'].versions['1.0.0'].manifest
    manifest.contributes.commands = [{ id: 'open-editor', title: 'Open editor' }]
    manifest.contributes['actions.composer'] = [{
      id: 'open-editor',
      command: 'open-editor',
      title: 'Edit video'
    }]
    await writeFile(harness.paths.registryFile, `${JSON.stringify(registry, null, 2)}\n`)

    expect((await harness.registry.get('acme.demo'))?.versions['1.0.0']
      ?.manifest.contributes['actions.composer']).toEqual([
      expect.objectContaining({ id: 'open-editor-action', command: 'open-editor' })
    ])

    await writeBundle(harness, '2.0.0', permissions)
    expect(await seedBundledExtensions(seedOptions(harness))).toEqual([{
      extensionId: 'acme.demo',
      version: '2.0.0',
      outcome: 'updated-selected'
    }])
    expect(await harness.registry.get('acme.demo')).toMatchObject({
      selectedVersion: '2.0.0',
      previousSelectedVersion: '1.0.0'
    })
  })

  it('installs an update without overriding a selected development source or rollback', async () => {
    const development = await createHarness()
    await writeBundle(development, '1.0.0', [])
    await seedBundledExtensions(seedOptions(development))
    await writeSource(development.developmentSource, '9.0.0', [], 'development')
    await development.manager.registerDevelopment(development.developmentSource, {
      grantedPermissions: [],
      select: true
    })
    await writeBundle(development, '2.0.0', [])
    expect(await seedBundledExtensions(seedOptions(development))).toMatchObject([{
      outcome: 'updated-unselected'
    }])
    expect(await development.registry.get('acme.demo')).toMatchObject({
      useDevelopment: true,
      selectedVersion: '1.0.0',
      versions: { '2.0.0': {} }
    })

    const rollback = await createHarness()
    await writeBundle(rollback, '1.0.0', [])
    await seedBundledExtensions(seedOptions(rollback))
    await writeBundle(rollback, '2.0.0', [])
    await seedBundledExtensions(seedOptions(rollback))
    await rollback.manager.rollback('acme.demo')
    await writeBundle(rollback, '3.0.0', [])
    expect(await seedBundledExtensions(seedOptions(rollback))).toMatchObject([{
      outcome: 'updated-unselected'
    }])
    expect(await rollback.registry.get('acme.demo')).toMatchObject({
      useDevelopment: false,
      selectedVersion: '1.0.0',
      versions: { '3.0.0': {} }
    })
  })

  it('does not auto-accept a permission change', async () => {
    const harness = await createHarness()
    await writeBundle(harness, '1.0.0', [])
    await seedBundledExtensions(seedOptions(harness))
    await writeBundle(harness, '2.0.0', ['commands.register'])

    expect(await seedBundledExtensions(seedOptions(harness))).toEqual([{
      extensionId: 'acme.demo',
      version: '2.0.0',
      outcome: 'skipped-permission-change'
    }])
    expect(await harness.registry.get('acme.demo')).toMatchObject({
      selectedVersion: '1.0.0',
      versions: { '1.0.0': {} }
    })
    expect((await harness.registry.get('acme.demo'))?.versions['2.0.0']).toBeUndefined()
  })

  it('selects a bundled update that only removes permissions', async () => {
    const harness = await createHarness()
    await writeBundle(harness, '1.0.0', ['agent.run', 'commands.register'])
    await seedBundledExtensions(seedOptions(harness))
    await writeBundle(harness, '2.0.0', ['commands.register'])

    expect(await seedBundledExtensions(seedOptions(harness))).toEqual([{
      extensionId: 'acme.demo',
      version: '2.0.0',
      outcome: 'updated-selected'
    }])
    expect(await harness.registry.get('acme.demo')).toMatchObject({
      selectedVersion: '2.0.0',
      previousSelectedVersion: '1.0.0',
      versions: {
        '2.0.0': {
          requestedPermissions: ['commands.register'],
          grantedPermissions: ['commands.register']
        }
      }
    })
  })

  it('honors uninstall permanently across newer bundled versions', async () => {
    const harness = await createHarness()
    await writeBundle(harness, '1.0.0', [])
    await seedBundledExtensions(seedOptions(harness))
    await harness.manager.uninstall('acme.demo')

    expect(await seedBundledExtensions(seedOptions(harness))).toMatchObject([{
      outcome: 'removed'
    }])
    await writeBundle(harness, '2.0.0', [])
    expect(await seedBundledExtensions(seedOptions(harness))).toMatchObject([{
      version: '2.0.0',
      outcome: 'removed'
    }])
    expect(await harness.registry.get('acme.demo')).toBeUndefined()
    const state = JSON.parse(await readFile(
      join(harness.paths.packageRoot, BUNDLED_EXTENSION_SEED_STATE_FILE),
      'utf8'
    ))
    expect(state.extensions['acme.demo']).toMatchObject({
      status: 'removed',
      lastSeenVersion: '2.0.0',
      managedVersion: '1.0.0'
    })
  })

  it('rejects a catalog digest mismatch before mutating the registry', async () => {
    const harness = await createHarness()
    await writeBundle(harness, '1.0.0', [])
    const catalogPath = join(harness.bundles, BUNDLED_EXTENSION_CATALOG_FILE)
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
    catalog.extensions[0].sha256 = 'f'.repeat(64)
    await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)

    await expect(seedBundledExtensions(seedOptions(harness))).rejects.toMatchObject({
      code: 'EXTENSION_BUNDLED_ARCHIVE_INVALID'
    })
    expect(await harness.registry.get('acme.demo')).toBeUndefined()
  })
})

type Harness = Awaited<ReturnType<typeof createHarness>>

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), 'kun-bundled-seeder-'))
  roots.push(root)
  const paths = new ExtensionPaths({
    packageRoot: join(root, 'extensions'),
    dataRoot: join(root, 'extension-data')
  })
  const registry = new ExtensionRegistry(paths)
  const manager = new ExtensionPackageManager(paths, registry, { compatibility })
  return {
    root,
    paths,
    registry,
    manager,
    bundles: join(root, 'bundled'),
    source: join(root, 'source'),
    developmentSource: join(root, 'development')
  }
}

function seedOptions(harness: Harness) {
  return {
    directory: harness.bundles,
    packageManager: harness.manager,
    now: () => new Date('2026-07-13T00:00:00.000Z')
  }
}

async function writeBundle(
  harness: Harness,
  version: string,
  permissions: string[]
): Promise<{ archive: string; catalog: BundledExtensionCatalog }> {
  await mkdir(harness.bundles, { recursive: true })
  await writeSource(harness.source, version, permissions, `bundle-${version}`)
  const archiveName = `acme-demo-${version}.kunx`
  const archive = join(harness.bundles, archiveName)
  const packed = await packKunx(harness.source, archive, { compatibility, overwrite: true })
  const catalog: BundledExtensionCatalog = {
    schemaVersion: 1,
    extensions: [{
      id: 'acme.demo',
      version,
      archive: archiveName,
      sha256: packed.archiveSha256,
      enginesKun: '*',
      apiVersion: '1.0.0',
      permissions: [...permissions].sort()
    }]
  }
  await writeFile(
    join(harness.bundles, BUNDLED_EXTENSION_CATALOG_FILE),
    `${JSON.stringify(catalog, null, 2)}\n`
  )
  return { archive, catalog }
}

async function writeSource(
  root: string,
  version: string,
  permissions: string[],
  marker: string
): Promise<void> {
  await rm(root, { recursive: true, force: true })
  await mkdir(join(root, 'dist'), { recursive: true })
  const manifest = {
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
    stateSchemaVersion: 0
  }
  await writeFile(join(root, 'kun-extension.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(root, 'README.md'), '# Demo\n')
  await writeFile(join(root, 'LICENSE'), 'MIT\n')
  await writeFile(
    join(root, 'dist/main.mjs'),
    `export const marker = ${JSON.stringify(marker)}\nexport async function activate() {}\n`
  )
}

async function makeWritable(root: string): Promise<void> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  await chmod(root, 0o700).catch(() => undefined)
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await makeWritable(path)
    else await chmod(path, 0o600).catch(() => undefined)
  }
}
