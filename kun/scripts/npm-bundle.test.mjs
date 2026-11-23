import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import tar from 'tar-stream'
import { extractArchive, verifyArchive } from './npm-archive.mjs'
import { bundledManifest } from './npm-bundle.mjs'
import { npmCommand } from './npm-pack.mjs'

async function archive(header, bytes = Buffer.from('fixture')) {
  const pack = tar.pack()
  pack.entry({ name: 'package/index.js', ...header }, bytes)
  pack.finalize()
  const chunks = []
  for await (const chunk of pack) chunks.push(chunk)
  return gzipSync(Buffer.concat(chunks))
}

test('dependency archives require intact pinned content and reject traversal and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-npm-archive-'))
  try {
    const bytes = await archive({})
    const pin = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
    verifyArchive(bytes, pin)
    assert.throws(() => verifyArchive(Buffer.from('tampered'), pin), /integrity mismatch/)
    await extractArchive(bytes, join(root, 'valid'))
    assert.equal(await readFile(join(root, 'valid/index.js'), 'utf8'), 'fixture')
    await assert.rejects(extractArchive(await archive({ name: 'package/../../outside' }), join(root, 'bad')), /Unsafe/)
    await assert.rejects(extractArchive(await archive({ type: 'symlink', linkname: '/outside' }, Buffer.alloc(0)),
      join(root, 'link')), /Unsupported archive/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a global and project consumer use bundled transitive pins without shrinkwrap or registry access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-npm-complete-bundle-'))
  try {
    const stage = join(root, 'stage')
    const packages = {
      'adapter-fixture': { name: 'adapter-fixture', version: '1.0.0', main: 'index.cjs',
        dependencies: { 'shared-fixture': '^1.0.0' } },
      'shared-fixture': { name: 'shared-fixture', version: '2.0.0', main: 'index.cjs', gypfile: false },
      'windows-fixture': { name: 'windows-fixture', version: '1.0.0', os: ['win32'], cpu: ['x64'] }
    }
    const lock = { packages: { '': {}, ...Object.fromEntries(Object.entries(packages).map(([name, manifest]) =>
      ['node_modules/' + name, { version: manifest.version, inBundle: true,
        ...(manifest.os ? { os: manifest.os, cpu: manifest.cpu, optional: true } : {}) }])) } }
    const manifest = bundledManifest({ name: 'kun-npm-complete-bundle-fixture', version: '1.0.0' }, lock)
    for (const [name, child] of Object.entries(packages)) {
      const directory = join(stage, 'node_modules', name)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'package.json'), JSON.stringify(child))
      await writeFile(join(directory, 'index.cjs'), name === 'adapter-fixture'
        ? "module.exports = require('shared-fixture')" : 'module.exports = {locked: true}')
      if (name === 'shared-fixture') await writeFile(join(directory, 'binding.gyp'), 'deliberately not compilable')
    }
    await writeFile(join(stage, 'package.json'), JSON.stringify(manifest))
    // No npm-shrinkwrap: npm 12 ignores it, and file installs cannot rely on it.
    const packed = JSON.parse(npmCommand(['pack', '--ignore-scripts', '--json'], { cwd: stage, encoding: 'utf8' }))[0]
    for (const global of [false, true]) {
      const prefix = join(root, global ? 'global' : 'project')
      await mkdir(prefix)
      npmCommand(['install', ...(global ? ['--global', '--prefix', prefix] : []), '--offline',
        '--no-audit', '--no-fund', '--cache', join(root, 'cache-' + global), join(stage, packed.filename)],
      { cwd: prefix, encoding: 'utf8', stdio: 'pipe' })
      const base = join(prefix, ...(global && process.platform !== 'win32' ? ['lib'] : []),
        'node_modules/kun-npm-complete-bundle-fixture/node_modules')
      assert.equal(JSON.parse(await readFile(join(base, 'shared-fixture/package.json'), 'utf8')).version, '2.0.0')
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
