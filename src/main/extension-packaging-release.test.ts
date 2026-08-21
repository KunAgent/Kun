import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builderConfig = require('../../electron-builder.config.cjs')
const afterPack = require('../../scripts/after-pack.cjs')
const temporaryRoots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kun-extension-packaging-'))
  temporaryRoots.push(root)
  return root
}

function touch(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '{}\n', 'utf8')
}

function packContext(root: string, platform: 'darwin' | 'win32' | 'linux') {
  return {
    appOutDir: join(root, platform),
    electronPlatformName: platform,
    arch: platform === 'win32' ? 'x64' : 'arm64',
    packager: { appInfo: { productFilename: 'Kun' } }
  }
}

function writeBundledExtensionResources(context: ReturnType<typeof packContext>): void {
  const root = join(afterPack._internals.packedResourcesDir(context), 'bundled-extensions')
  const extensions = [
    {
      id: 'kun-examples.social-media-sidebar',
      archive: 'social-media-sidebar-0.1.3.kunx'
    }
  ].map((entry) => {
    const bytes = Buffer.from(`deterministic bundled extension archive: ${entry.id}`)
    return {
      ...entry,
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex')
    }
  })
  mkdirSync(root, { recursive: true })
  for (const extension of extensions) {
    writeFileSync(join(root, extension.archive), extension.bytes)
  }
  writeFileSync(join(root, 'catalog.json'), `${JSON.stringify({
    schemaVersion: 1,
    retiredExtensions: [
      'kun-examples.kun-video-editor',
      'kun-examples.presentation-studio'
    ],
    extensions: extensions.map((extension) => ({
      id: extension.id,
      version: '0.1.0',
      archive: extension.archive,
      sha256: extension.sha256
    }))
  }, null, 2)}\n`)
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('Extension Platform packaged release resources', () => {
  it('includes the public SDK schema, compatibility fixtures, and every scaffolder shape', () => {
    expect(builderConfig.files).toEqual(expect.arrayContaining([
      'packages/extension-api/package.json',
      'packages/extension-api/dist/**/*',
      'packages/extension-api/schema/**/*',
      'packages/extension-api/fixtures/**/*',
      'packages/create-kun-extension/package.json',
      'packages/create-kun-extension/src/**/*',
      'packages/create-kun-extension/templates/**/*'
    ]))

    expect(afterPack.KUN_RUNTIME_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'kun/dist/cli/extension-cli.js',
      'kun/dist/extensions/host-runner.js',
      'packages/extension-api/schema/kun-extension.schema.json',
      'packages/extension-api/fixtures/api-major-negotiation.json',
      'packages/create-kun-extension/templates/node/src/extension.ts',
      'packages/create-kun-extension/templates/react/src/host/extension.ts',
      'packages/create-kun-extension/templates/react/src/webview/main.tsx',
      'packages/create-kun-extension/templates/webview/src/webview/main.ts'
    ]))
    expect(builderConfig.extraResources).toEqual(expect.arrayContaining([{
      from: 'resources/bundled-extensions',
      to: 'bundled-extensions',
      filter: ['catalog.json', '*.kunx']
    }]))
    expect(afterPack.REQUIRED_BUNDLED_EXTENSION_IDS).not.toContain(
      'kun-examples.kun-video-editor'
    )
    expect(afterPack.REQUIRED_RETIRED_BUNDLED_EXTENSION_IDS).toEqual([
      'kun-examples.kun-video-editor',
      'kun-examples.presentation-studio'
    ])
    expect(afterPack.REQUIRED_BUNDLED_EXTENSION_IDS).not.toContain(
      'kun-examples.presentation-studio'
    )
    expect(afterPack.REQUIRED_BUNDLED_EXTENSION_IDS).toContain(
      'kun-examples.social-media-sidebar'
    )
  })

  it.each(['darwin', 'win32', 'linux'] as const)(
    'resolves and validates the %s packaged resource layout',
    (platform) => {
      const root = temporaryRoot()
      const context = packContext(root, platform)
      const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

      for (const relativePath of afterPack.KUN_RUNTIME_REQUIRED_PATHS) {
        touch(join(unpackedRoot, relativePath))
      }
      touch(join(
        unpackedRoot,
        `kun/node_modules/@cursor/sdk-${platform}-${context.arch}/package.json`
      ))
      touch(join(unpackedRoot, 'node_modules/better-sqlite3/package.json'))
      writeBundledExtensionResources(context)

      expect(() => afterPack._internals.validateBundledKunRuntime(context)).not.toThrow()
      expect(() => afterPack._internals.validateBundledExtensionResources(context)).not.toThrow()
      if (platform === 'darwin') {
        expect(unpackedRoot).toContain(join('Kun.app', 'Contents', 'Resources', 'app.asar.unpacked'))
      } else {
        expect(unpackedRoot).toContain(join(platform, 'resources', 'app.asar.unpacked'))
      }
    }
  )

  it('fails packaged validation when bundled archive bytes no longer match the catalog', () => {
    const root = temporaryRoot()
    const context = packContext(root, 'darwin')
    writeBundledExtensionResources(context)
    writeFileSync(
      join(afterPack._internals.packedResourcesDir(context), 'bundled-extensions', 'social-media-sidebar-0.1.3.kunx'),
      'tampered'
    )
    expect(() => afterPack._internals.validateBundledExtensionResources(context)).toThrow(
      /digest mismatch/
    )
  })

  it('rejects retired Presentation Studio and orphan archives from packaged defaults', () => {
    const root = temporaryRoot()
    const context = packContext(root, 'darwin')
    writeBundledExtensionResources(context)
    const bundledRoot = join(
      afterPack._internals.packedResourcesDir(context),
      'bundled-extensions'
    )
    const archive = 'presentation-studio-0.1.10.kunx'
    const bytes = Buffer.from('retired Presentation Studio archive')
    writeFileSync(join(bundledRoot, archive), bytes)
    const catalogPath = join(bundledRoot, 'catalog.json')
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
    catalog.extensions.push({
      id: 'kun-examples.presentation-studio',
      version: '0.1.10',
      archive,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)

    expect(() => afterPack._internals.validateBundledExtensionResources(context)).toThrow(
      /Unexpected bundled extension/
    )

    catalog.extensions.pop()
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
    expect(() => afterPack._internals.validateBundledExtensionResources(context)).toThrow(
      /Unexpected bundled extension archive/
    )
  })
})
