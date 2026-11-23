import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { npmCommand } from './npm-pack.mjs'
import { productionLock } from './npm-lock.mjs'

const manifest = {
  name: '@kun/agent', version: '1.0.0', dependencies: { '@kun/local': '1.0.0', adapter: '2.0.0' },
  bundleDependencies: ['@kun/local'], bin: { kun: 'bin/kun.mjs' }, engines: { node: '>=26.4.0 <27' }
}

function fixture() {
  return { lockfileVersion: 3, packages: {
    '': {},
    '../local': { version: '1.0.0', dependencies: { shared: '^1' }, devDependencies: { testRunner: '*' } },
    'node_modules/@kun/local': { link: true, resolved: '../local' },
    'node_modules/adapter': { version: '2.0.0', resolved: 'https://registry.npmmirror.com/adapter/-/adapter-2.0.0.tgz',
      dependencies: { shared: '^2' }, optionalDependencies: { 'native-linux': '1.0.0' },
      peerDependencies: { optionalPeer: '*' }, peerDependenciesMeta: { optionalPeer: { optional: true } } },
    'node_modules/adapter/node_modules/shared': { version: '2.0.0' },
    'node_modules/shared': { version: '1.0.0', dev: true },
    'node_modules/native-linux': { version: '1.0.0', os: ['linux'], cpu: ['arm64'], optional: true },
    'node_modules/testRunner': { version: '9.0.0', dev: true }
  } }
}

test('production closure materializes local links and preserves nearest resolution and foreign optional payloads', () => {
  const lock = productionLock(fixture(), manifest, {
    '@kun/local': { version: '1.0.0', dependencies: { shared: '^1' } }
  })
  assert.equal(lock.packages['node_modules/@kun/local'].inBundle, true)
  assert.equal(lock.packages['node_modules/@kun/local'].resolved, undefined)
  assert.equal(lock.packages['node_modules/@kun/local'].devDependencies, undefined)
  assert.equal(lock.packages['node_modules/shared'].dev, undefined)
  assert.equal(lock.packages['node_modules/adapter/node_modules/shared'].version, '2.0.0')
  assert.deepEqual(lock.packages['node_modules/native-linux'].cpu, ['arm64'])
  assert.equal(lock.packages['node_modules/testRunner'], undefined)
  assert.equal(lock.packages['../local'], undefined)
  assert.match(lock.packages['node_modules/adapter'].resolved, /^https:\/\/registry\.npmjs\.org\//)
})

test('a missing mandatory dependency or unresolved external file fails staging', () => {
  const missing = fixture()
  delete missing.packages['node_modules/shared']
  assert.throws(() => productionLock(missing, manifest, {}), /Missing dependency shared/)
  const external = fixture()
  external.packages['node_modules/adapter'].resolved = 'file:../private.tgz'
  assert.throws(() => productionLock(external, manifest, {}), /Nonportable resolution/)
})

test('omits unsupported optional native targets and their parent declarations', () => {
  const lock = productionLock(fixture(), manifest, {
    '@kun/local': { version: '1.0.0', dependencies: { shared: '^1' } }
  }, ['darwin-arm64'])
  assert.equal(lock.packages['node_modules/native-linux'], undefined)
  assert.equal(lock.packages['node_modules/adapter'].optionalDependencies['native-linux'], undefined)
})

test('an actual npm consumer installs a bundled private dependency offline without its workspace', async () => {
  const work = await mkdtemp(join(tmpdir(), 'kun-npm-bundle-'))
  try {
    const stage = join(work, 'stage')
    const local = join(stage, 'node_modules/@kun/local')
    await mkdir(local, { recursive: true })
    const main = { name: 'kun-npm-bundle-fixture', version: '1.0.0',
      dependencies: { '@kun/local': '1.0.0' }, bundleDependencies: ['@kun/local'] }
    const child = { name: '@kun/local', version: '1.0.0', main: 'index.json' }
    const source = { lockfileVersion: 3, packages: {
      '../local': { version: '1.0.0' },
      'node_modules/@kun/local': { link: true, resolved: '../local' }
    } }
    await writeFile(join(stage, 'package.json'), JSON.stringify(main))
    await writeFile(join(stage, 'npm-shrinkwrap.json'), JSON.stringify(productionLock(source, main, { '@kun/local': child })))
    await writeFile(join(local, 'package.json'), JSON.stringify(child))
    await writeFile(join(local, 'index.json'), '{"bundled":true}')
    const archive = JSON.parse(npmCommand(['pack', '--ignore-scripts', '--json'], { cwd: stage, encoding: 'utf8' }))[0]
    const project = join(work, 'consumer')
    await mkdir(project)
    npmCommand(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      '--cache', join(work, 'empty-cache'), join(stage, archive.filename)], {
      cwd: project, encoding: 'utf8', stdio: 'pipe'
    })
    const installed = JSON.parse(await readFile(join(project,
      'node_modules/kun-npm-bundle-fixture/node_modules/@kun/local/index.json'), 'utf8'))
    assert.deepEqual(installed, { bundled: true })
  } finally { await rm(work, { recursive: true, force: true }) }
})
