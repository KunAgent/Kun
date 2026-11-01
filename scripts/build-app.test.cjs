'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync, statSync, utimesSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const test = require('node:test')
const { buildApp, outputs } = require('./build-app.cjs')

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'kun-build-reuse-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0)
  const put = (path, value = 'fixture') => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), value)
  }
  put('.gitignore', [...outputs, '.cache', 'node_modules'].map(path => `${path}/`).join('\n'))
  put('src/app.ts', 'export const value = 1')
  put('package-lock.json', '{}')
  let launches = 0
  const launch = () => {
    launches++
    for (const path of outputs) put(`${path}/index.js`)
    return 0
  }
  const run = (env = {}) => buildApp(root, env, launch)
  return { root, put, launch, run, launches: () => launches }
}

test('an unchanged second build reuses all verified outputs without executing the build chain', t => {
  const f = fixture(t)
  assert.equal(f.run(), 0)
  assert.equal(f.run(), 0)
  assert.equal(f.launches(), 1)
  const stamp = JSON.parse(readFileSync(join(f.root, '.cache/app-build.json'), 'utf8'))
  assert.match(stamp.input, /^[a-f0-9]{64}$/)
  assert.match(stamp.output, /^[a-f0-9]{64}$/)
})

test('only emitted workspace outputs are required; the source-only scaffold CLI has no dist', () => {
  assert.equal(outputs.includes('packages/create-kun-extension/dist'), false)
  const cli = require('../packages/create-kun-extension/package.json')
  assert.match(cli.scripts.build, /node --check src\/cli\.mjs/)
})

test('cold builds remove obsolete TypeScript emits before compiling workspaces', t => {
  const f = fixture(t)
  f.run()
  f.put('packages/extension-api/dist/obsolete.js', 'removed source')
  assert.equal(buildApp(f.root, {}, () => {
    assert.equal(existsSync(join(f.root, 'packages/extension-api/dist/obsolete.js')), false)
    return f.launch()
  }), 0)
  assert.equal(f.launches(), 2)
})

test('content edits, additions, renames and deletions invalidate even when mtimes are preserved', t => {
  const f = fixture(t)
  f.run()
  const original = statSync(join(f.root, 'src/app.ts'))
  f.put('src/app.ts', 'export const value = 2')
  utimesSync(join(f.root, 'src/app.ts'), original.atime, original.mtime)
  f.run()
  f.put('src/new.ts', 'export {}')
  f.run()
  renameSync(join(f.root, 'src/new.ts'), join(f.root, 'src/renamed.ts'))
  f.run()
  rmSync(join(f.root, 'src/renamed.ts'))
  f.run()
  assert.equal(f.launches(), 5)
})

test('lockfiles and installed dependency metadata invalidate reuse', t => {
  const f = fixture(t)
  f.run()
  for (const file of ['package-lock.json', 'kun/package-lock.json', 'node_modules/.package-lock.json', 'kun/node_modules/.package-lock.json']) {
    f.put(file, '{"updated":true}')
    f.run()
  }
  assert.equal(f.launches(), 5)
})

test('deleting or changing an emitted chunk or entire output directory forces a rebuild', t => {
  const f = fixture(t)
  f.run()
  rmSync(join(f.root, 'out/index.js'))
  f.run()
  f.put('kun/dist/index.js', 'tampered')
  f.run()
  rmSync(join(f.root, 'resources/bundled-extensions'), { recursive: true })
  f.run()
  assert.equal(f.launches(), 4)
})

test('version, channel, flavor and signing environment changes invalidate without persisting secrets', t => {
  const f = fixture(t)
  f.run()
  for (const key of ['KUN_APP_VERSION', 'RELEASE_CHANNEL', 'KUN_APP_FLAVOR', 'MAC_SIGN', 'VITE_FEATURE']) {
    f.run({ [key]: 'different' })
  }
  assert.equal(f.launches(), 6)
  f.run({ CSC_KEY_PASSWORD: 'private-fixture-secret' })
  assert.ok(!readFileSync(join(f.root, '.cache/app-build.json'), 'utf8').includes('private-fixture-secret'))
})

test('force rebuild, failed build and mid-build input edits cannot leave a reusable stamp', t => {
  const f = fixture(t)
  f.run()
  f.run({ KUN_FORCE_BUILD: '1' })
  f.run()
  assert.equal(f.launches(), 2)
  assert.equal(buildApp(f.root, { KUN_FORCE_BUILD: '1' }, () => 7), 7)
  assert.equal(existsSync(join(f.root, '.cache/app-build.json')), false)
  f.run()
  assert.equal(f.launches(), 3)
  buildApp(f.root, { KUN_FORCE_BUILD: '1' }, () => { f.put('src/changed.ts'); return 0 })
  assert.equal(existsSync(join(f.root, '.cache/app-build.json')), false)
})
