import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DRIVER_FILES, exportDriver } from './export-kun-npm-test-driver.mjs'

test('export contains only independent drivers, with digests and no source or Git database', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'kun-driver-export-'))
  const root = join(parent, 'driver')
  try {
    await exportDriver(process.cwd(), root, 'a'.repeat(40))
    assert.deepEqual((await readdir(root)).sort(), ['driver-manifest.json', 'scripts'])
    const manifest = JSON.parse(await readFile(join(root, 'driver-manifest.json'), 'utf8'))
    assert.deepEqual(Object.keys(manifest.files).sort(), [...DRIVER_FILES].sort())
    assert(!DRIVER_FILES.some(name => name.includes('node_modules') || name.startsWith('kun/') || name.includes('.git')))
    assert(DRIVER_FILES.includes('scripts/fixtures/kun-npm/windows_conpty.py'))
    await assert.rejects(exportDriver(process.cwd(), root, 'a'.repeat(40)), { code: 'EEXIST' })
  } finally { await rm(parent, { recursive: true, force: true }) }
})
