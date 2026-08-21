import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUNDLED_EXTENSION_DEFINITIONS,
  RETIRED_BUNDLED_EXTENSION_IDS,
  bundledArchiveName,
  bundledCatalogEntry,
  bundledExtensionCatalog
} from './pack-bundled-extensions.mjs'

const digest = 'a'.repeat(64)

function manifest(name, overrides = {}) {
  return {
    publisher: 'kun-examples',
    name,
    version: '0.1.0',
    apiVersion: '1.0.0',
    engines: { kun: '>=0.1.0' },
    permissions: ['ui.views', 'workspace.read', 'ui.views'],
    ...overrides
  }
}

test('declares every product-owned default extension', () => {
  assert.deepEqual(
    BUNDLED_EXTENSION_DEFINITIONS.map((entry) => entry.id),
    ['kun-examples.social-media-sidebar']
  )
  assert.deepEqual(
    RETIRED_BUNDLED_EXTENSION_IDS,
    [
      'kun-examples.kun-video-editor',
      'kun-examples.presentation-studio'
    ]
  )
})

test('derives bounded catalog entries from canonical manifests', () => {
  const definition = BUNDLED_EXTENSION_DEFINITIONS[0]
  assert.equal(
    bundledArchiveName(manifest('social-media-sidebar'), definition.name),
    'social-media-sidebar-0.1.0.kunx'
  )
  assert.deepEqual(
    bundledCatalogEntry(
      definition,
      manifest('social-media-sidebar'),
      'social-media-sidebar-0.1.0.kunx',
      digest
    ),
    {
      id: 'kun-examples.social-media-sidebar',
      version: '0.1.0',
      archive: 'social-media-sidebar-0.1.0.kunx',
      sha256: digest,
      enginesKun: '>=0.1.0',
      apiVersion: '1.0.0',
      permissions: ['ui.views', 'workspace.read']
    }
  )
  assert.throws(
    () => bundledCatalogEntry(
      definition,
      manifest('other'),
      'social-media-sidebar-0.1.0.kunx',
      digest
    ),
    /Unexpected/
  )
})

test('sorts catalog entries and rejects duplicate extension ids', () => {
  const entries = BUNDLED_EXTENSION_DEFINITIONS.map((definition) => bundledCatalogEntry(
    definition,
    manifest(definition.name),
    `${definition.name}-0.1.0.kunx`,
    digest
  )).reverse()
  const catalog = bundledExtensionCatalog(entries)
  assert.deepEqual(
    catalog.extensions.map((entry) => entry.id),
    ['kun-examples.social-media-sidebar']
  )
  assert.deepEqual(
    catalog.retiredExtensions,
    [
      'kun-examples.kun-video-editor',
      'kun-examples.presentation-studio'
    ]
  )
  assert.throws(
    () => bundledExtensionCatalog([entries[0], entries[0]]),
    /duplicate/
  )
  assert.throws(
    () => bundledExtensionCatalog(entries, [entries[0].id]),
    /cannot retire/
  )
})
