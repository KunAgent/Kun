import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

test('ciphertext server has no OpenMLS dependency', async () => {
  const manifest = await readFile(resolve(root, 'native/kun-collab-server/Cargo.toml'), 'utf8')
  const lock = await readFile(resolve(root, 'native/kun-collab-server/Cargo.lock'), 'utf8')
  assert.doesNotMatch(manifest, /openmls/i)
  assert.doesNotMatch(lock, /name = "openmls/i)
})

test('packaging declares both native Collaboration artifacts', async () => {
  const config = await readFile(resolve(root, 'electron-builder.config.cjs'), 'utf8')
  assert.match(config, /kun-collab-crypto\.node/)
  assert.match(config, /kun-collab-server/)
})
