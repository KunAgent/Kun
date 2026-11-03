import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CURRENT_EXTENSION_API_VERSION,
  CURRENT_MANIFEST_VERSION,
  SUPPORTED_EXTENSION_API_VERSIONS
} from '@kun/extension-api'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ExtensionManager,
  ExtensionPackageManager,
  ExtensionPaths,
  ExtensionRegistry,
  assertManifestCompatible,
  packKunx,
  parseExtensionManifest,
  type ExtensionCompatibility
} from '../src/extensions/index.js'
import { kunEngineVersion } from '../src/version.js'

const cleanupRoots: string[] = []

afterEach(async () => {
  for (const root of cleanupRoots.splice(0)) {
    await makeWritable(root)
    await rm(root, { recursive: true, force: true })
  }
})

describe('extension runtime compatibility admission', () => {
  it('negotiates current and earlier minors and rejects future minor, future major, and engine mismatches', () => {
    const shippedPolicy: ExtensionCompatibility = {
      kunVersion: '0.1.0',
      supportedManifestVersions: [CURRENT_MANIFEST_VERSION],
      supportedApiVersions: SUPPORTED_EXTENSION_API_VERSIONS
    }
    const shipped = assertManifestCompatible(
      manifestFor({ apiVersion: CURRENT_EXTENSION_API_VERSION }),
      shippedPolicy
    )
    expect(shipped.api).toMatchObject({
      compatible: true,
      negotiatedApiVersion: CURRENT_EXTENSION_API_VERSION
    })

    const minorPolicy: ExtensionCompatibility = {
      kunVersion: '0.1.0',
      supportedManifestVersions: [1],
      supportedApiVersions: ['1.2.0']
    }
    expect(assertManifestCompatible(manifestFor({ apiVersion: '1.2.0' }), minorPolicy).api)
      .toMatchObject({ compatible: true, negotiatedApiVersion: '1.2.0' })
    expect(assertManifestCompatible(manifestFor({ apiVersion: '1.1.0' }), minorPolicy).api)
      .toMatchObject({ compatible: true, negotiatedApiVersion: '1.2.0' })
    expect(() => assertManifestCompatible(manifestFor({ apiVersion: '1.3.0' }), minorPolicy))
      .toThrow(expect.objectContaining({ code: 'EXTENSION_API_MINOR_UNSUPPORTED' }))
    expect(() => assertManifestCompatible(manifestFor({ apiVersion: '2.0.0' }), minorPolicy))
      .toThrow(expect.objectContaining({ code: 'EXTENSION_API_VERSION_UNSUPPORTED' }))
    expect(() => assertManifestCompatible(
      manifestFor({ apiVersion: '1.2.0', enginesKun: '>=0.2.0' }),
      minorPolicy
    )).toThrow(expect.objectContaining({ code: 'EXTENSION_ENGINE_INCOMPATIBLE' }))
  })

  it('checks a daily dev build against engines.kun as the develop release line', () => {
    const daily = policy({ apiVersion: '1.2.0', kunVersion: '0.0.0-dev-20261017-1607' })
    const report = assertManifestCompatible(
      manifestFor({ apiVersion: '1.2.0', enginesKun: '>=0.1.0' }),
      daily
    )
    expect(report.kunEngine).toEqual({
      declared: '>=0.1.0',
      running: '0.0.0-dev-20261017-1607',
      compatible: true
    })
    expect(() => assertManifestCompatible(
      manifestFor({ apiVersion: '1.2.0', enginesKun: '<0.1.0' }),
      daily
    )).toThrow(expect.objectContaining({ code: 'EXTENSION_ENGINE_INCOMPATIBLE' }))
    expect(() => assertManifestCompatible(
      manifestFor({ apiVersion: '1.2.0', enginesKun: '>=0.1.0' }),
      policy({ apiVersion: '1.2.0', kunVersion: '0.0.9' })
    )).toThrow(expect.objectContaining({ code: 'EXTENSION_ENGINE_INCOMPATIBLE' }))

    expect(kunEngineVersion('0.0.0-dev-20261017-1607', '0.4.1')).toBe('0.4.1')
    expect(kunEngineVersion('0.4.1', '0.9.0')).toBe('0.4.1')
    expect(kunEngineVersion('0.5.0-beta.1', '0.4.1')).toBe('0.5.0-beta.1')
    expect(kunEngineVersion('0.0.0-dev', '0.4.1')).toBe('0.0.0-dev')
  })

  it('re-admits installed versions before activation, selection, and rollback', async () => {
    const root = await temporaryRoot('kun-extension-compat-installed-')
    const source = join(root, 'source')
    const paths = new ExtensionPaths({
      packageRoot: join(root, 'extensions'),
      dataRoot: join(root, 'data')
    })
    const registry = new ExtensionRegistry(paths)
    const installPolicy = policy({ apiVersion: '1.1.0' })
    const installManager = new ExtensionPackageManager(paths, registry, {
      compatibility: installPolicy
    })

    await writeExtensionSource(source, { version: '1.0.0', apiVersion: '1.0.0' })
    const v1Archive = join(root, 'v1.kunx')
    await packKunx(source, v1Archive, { compatibility: installPolicy })
    await installManager.installArchive(v1Archive, { grantedPermissions: [] })

    await writeExtensionSource(source, { version: '2.0.0', apiVersion: '1.1.0' })
    const v2Archive = join(root, 'v2.kunx')
    await packKunx(source, v2Archive, { compatibility: installPolicy })
    await installManager.installArchive(v2Archive, { grantedPermissions: [] })
    expect((await registry.get('acme.demo'))?.selectedVersion).toBe('2.0.0')

    const runtimeManager = new ExtensionPackageManager(paths, registry, {
      compatibility: policy({ apiVersion: '1.0.0' })
    })
    const extensionManager = new ExtensionManager({
      packageManager: runtimeManager,
      paths,
      runnerPath: join(root, 'runner-must-not-start.mjs')
    })
    await expect(
      extensionManager.activate('acme.demo', 'onCommand:run')
    ).rejects.toMatchObject({ code: 'EXTENSION_API_MINOR_UNSUPPORTED' })
    await expect(extensionManager.diagnostic('acme.demo')).resolves.toMatchObject({
      lifecycleState: 'incompatible',
      active: false,
      compatibility: {
        api: {
          compatible: false,
          declaredApiVersion: '1.1.0',
          code: 'API_MINOR_UNSUPPORTED'
        }
      }
    })
    await expect(runtimeManager.resolveForActivation('acme.demo')).rejects.toMatchObject({
      code: 'EXTENSION_API_MINOR_UNSUPPORTED'
    })

    await runtimeManager.rollback('acme.demo')
    expect((await registry.get('acme.demo'))?.selectedVersion).toBe('1.0.0')
    await expect(runtimeManager.resolveForActivation('acme.demo')).resolves.toMatchObject({
      version: '1.0.0'
    })
    await expect(runtimeManager.selectVersion('acme.demo', '2.0.0')).rejects.toMatchObject({
      code: 'EXTENSION_API_MINOR_UNSUPPORTED'
    })
    await expect(runtimeManager.rollback('acme.demo')).rejects.toMatchObject({
      code: 'EXTENSION_API_MINOR_UNSUPPORTED'
    })
    expect((await registry.get('acme.demo'))?.selectedVersion).toBe('1.0.0')
    await extensionManager.shutdown()
  })

  it('re-admits mutable development manifests against current API and engine policy', async () => {
    const root = await temporaryRoot('kun-extension-compat-development-')
    const paths = new ExtensionPaths({
      packageRoot: join(root, 'extensions'),
      dataRoot: join(root, 'data')
    })
    const registry = new ExtensionRegistry(paths)

    const futureSource = join(root, 'future-source')
    await writeExtensionSource(futureSource, {
      version: '1.0.0',
      apiVersion: '1.1.0',
      name: 'future'
    })
    const futureInstall = new ExtensionPackageManager(paths, registry, {
      compatibility: policy({ apiVersion: '1.1.0' })
    })
    await futureInstall.registerDevelopment(futureSource, { grantedPermissions: [] })
    const currentRuntime = new ExtensionPackageManager(paths, registry, {
      compatibility: policy({ apiVersion: '1.0.0' })
    })
    await expect(currentRuntime.resolveForActivation('acme.future')).rejects.toMatchObject({
      code: 'EXTENSION_API_MINOR_UNSUPPORTED'
    })

    const engineSource = join(root, 'engine-source')
    await writeExtensionSource(engineSource, {
      version: '1.0.0',
      apiVersion: '1.0.0',
      enginesKun: '>=0.2.0',
      name: 'engine'
    })
    const newerKun = new ExtensionPackageManager(paths, registry, {
      compatibility: policy({ apiVersion: '1.0.0', kunVersion: '0.2.0' })
    })
    await newerKun.registerDevelopment(engineSource, { grantedPermissions: [] })
    await expect(currentRuntime.resolveForActivation('acme.engine')).rejects.toMatchObject({
      code: 'EXTENSION_ENGINE_INCOMPATIBLE'
    })
  })
})

function policy(options: { apiVersion: string; kunVersion?: string }): ExtensionCompatibility {
  return {
    kunVersion: options.kunVersion ?? '0.1.0',
    supportedManifestVersions: [1],
    supportedApiVersions: [options.apiVersion]
  }
}

function manifestFor(options: {
  version?: string
  apiVersion: string
  enginesKun?: string
  name?: string
}) {
  return parseExtensionManifest({
    publisher: 'acme',
    name: options.name ?? 'demo',
    version: options.version ?? '1.0.0',
    manifestVersion: 1,
    apiVersion: options.apiVersion,
    engines: { kun: options.enginesKun ?? '*' },
    main: 'dist/main.mjs',
    activationEvents: ['onStartup'],
    contributes: {},
    permissions: [],
    stateSchemaVersion: 0
  })
}

async function writeExtensionSource(
  root: string,
  options: {
    version: string
    apiVersion: string
    enginesKun?: string
    name?: string
  }
): Promise<void> {
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(
    join(root, 'kun-extension.json'),
    `${JSON.stringify(manifestFor(options), null, 2)}\n`
  )
  await writeFile(join(root, 'README.md'), '# Compatibility fixture\n')
  await writeFile(join(root, 'LICENSE'), 'MIT\n')
  await writeFile(join(root, 'dist/main.mjs'), 'export async function activate() {}\n')
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  cleanupRoots.push(root)
  return root
}

async function makeWritable(root: string): Promise<void> {
  try {
    await chmod(root, 0o700)
  } catch {
    return
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await makeWritable(path)
    else await chmod(path, 0o600).catch(() => undefined)
  }
}
