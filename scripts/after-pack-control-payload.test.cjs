'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const {
  cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync,
  symlinkSync, writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const test = require('node:test')
const { createPackageWithOptions, listPackage } = require('@electron/asar')
const { getMainFileMatchers, getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher')
const { _internals: { npmCommand } } = require('./after-pack.cjs')
const {
  withPackedKunPruneArchives, validateNoBundledControlPayload
} = require('./after-pack-control-payload.cjs')

function write(path, value) {
  mkdirSync(dirname(path), {recursive: true})
  writeFileSync(path, typeof value === 'object' ? JSON.stringify(value) : value)
}
function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'kun-control-packaging-'))
  t.after(() => rmSync(root, {recursive: true, force: true}))
  return root
}
function npm(root, cwd, ...args) {
  const command = npmCommand(args)
  return execFileSync(command.command, command.args, { cwd, encoding: 'utf8',
    env: {...process.env, npm_config_cache: join(root, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false'},
    stdio: ['ignore', 'pipe', 'pipe'] })
}

test('npm prune consumes a temporary local archive; shipped protocol JS remains usable after cleanup', t => {
  const root = temporary(t), project = join(root, 'project'), packed = join(root, 'resources/app.asar.unpacked')
  const source = join(root, 'protocol-source'), vendor = join(project, 'vendor/kun-remote')
  write(join(source, 'package.json'), {name: '@kun/remote-protocol', version: '1.0.0', main: 'index.cjs'})
  write(join(source, 'index.cjs'), 'module.exports = {version: "fixture-1"}')
  mkdirSync(vendor, {recursive: true})
  const archive = JSON.parse(npm(root, source, 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', vendor))[0].filename
  write(join(project, 'kun/package.json'), {name: 'fixture-kun', version: '1.0.0', dependencies: {
    '@kun/remote-protocol': 'file:../vendor/kun-remote/' + archive
  }})
  npm(root, join(project, 'kun'), 'install', '--offline', '--ignore-scripts')
  cpSync(join(project, 'kun'), join(packed, 'kun'), {recursive: true})
  const sourceBytes = readFileSync(join(vendor, archive))
  withPackedKunPruneArchives(project, packed, () => {
    assert.equal(existsSync(join(packed, 'vendor/kun-remote', archive)), true)
    npm(root, join(packed, 'kun'), 'prune', '--omit=dev', '--offline', '--ignore-scripts')
  })
  assert.equal(existsSync(join(packed, 'vendor')), false)
  assert.deepEqual(readFileSync(join(vendor, archive)), sourceBytes)
  assert.equal(execFileSync(process.execPath, ['-e', 'process.stdout.write(require("@kun/remote-protocol").version)'],
    {cwd: join(packed, 'kun'), encoding: 'utf8'}), 'fixture-1')
  assert.throws(() => withPackedKunPruneArchives(project, packed, () => { throw Error('prune_failed') }), /prune_failed/)
  assert.equal(existsSync(join(packed, 'vendor')), false, 'A failed pack must also remove temporary archives')
})

test('local archive staging rejects escaping references and symlink sources', t => {
  const root = temporary(t), project = join(root, 'project'), packed = join(root, 'packed')
  mkdirSync(project)
  write(join(packed, 'kun/package.json'), {dependencies: {invalid: 'file:../../escape.tgz'}})
  assert.throws(() => withPackedKunPruneArchives(project, packed, () => {}), /Unsupported local archive/)
  write(join(packed, 'kun/package.json'), {dependencies: {invalid: 'file:../vendor/kun-remote/link.tgz'}})
  write(join(project, 'outside.tgz'), 'archive')
  mkdirSync(join(project, 'vendor/kun-remote'), {recursive: true})
  symlinkSync(join(project, 'outside.tgz'), join(project, 'vendor/kun-remote/link.tgz'))
  assert.throws(() => withPackedKunPruneArchives(project, packed, () => {}), /Unsafe prune archive source/)
  assert.equal(existsSync(join(packed, 'vendor')), false)
})

test('real builder filters omit payloads from ASAR while retaining the host and protocol runtime', async t => {
  const root = temporary(t), project = join(root, 'project'), filtered = join(root, 'filtered')
  const resources = join(root, 'resources'), archive = join(resources, 'app.asar')
  const files = {
    'package.json': {name: 'packaging-fixture', version: '1.0.0'},
    'out/main/index.js': 'require("@kun/control-host")',
    'vendor/kun-remote/old.tgz': 'archive',
    'vendor/kun-control/current.tgz': 'archive',
    'control-baselines/darwin-arm64/runtime/index.mjs': 'obsolete baseline',
    'node_modules/@kun/control-runtime/package.json': {name: '@kun/control-runtime', version: '1.0.0'},
    'node_modules/@kun/control-runtime/baselines/darwin-arm64/runtime/index.mjs': 'duplicate baseline',
    'node_modules/@kun/control-host/package.json': {name: '@kun/control-host', version: '1.0.0'},
    'node_modules/@kun/control-host/src/index.js': 'export class ControlPackageManager {}',
    'node_modules/@kun/remote-protocol/package.json': {name: '@kun/remote-protocol', version: '1.0.0'},
    'node_modules/@kun/remote-protocol/src/index.js': 'export const wire = 1',
    'kun/node_modules/@kun/control-runtime/runtime/index.mjs': 'nested duplicate'
  }
  for (const [name, value] of Object.entries(files)) write(join(project, name), value)
  const config = require('../electron-builder.config.cjs')
  assert.equal(config.extraResources.some(item => typeof item === 'object' && item.to === 'control-baselines'), false)
  const packager = {projectDir: project, buildResourcesDir: 'build', config: {...config, files: [...config.files]},
    isPrepackedAppAsar: false, debugLogger: {isEnabled: false}}
  const [main] = getMainFileMatchers(project, filtered, value => value, {}, {info: packager}, join(root, 'dist'), false)
  const dependencies = getNodeModuleFileMatcher(project, filtered, value => value, {}, packager)
  const mainFilter = main.createFilter(), dependencyFilter = dependencies.createFilter()
  for (const name of Object.keys(files)) {
    const source = join(project, name), filter = name.startsWith('node_modules/') ? dependencyFilter : mainFilter
    if (filter(source, statSync(source))) {
      mkdirSync(dirname(join(filtered, name)), {recursive: true}); cpSync(source, join(filtered, name))
    }
  }
  mkdirSync(resources)
  await createPackageWithOptions(filtered, archive, {unpack: '**/node_modules/@kun/remote-protocol/**/*'})
  assert.doesNotThrow(() => validateNoBundledControlPayload(resources))
  const paths = listPackage(archive)
  assert.ok(paths.includes('/node_modules/@kun/control-host/src/index.js'))
  assert.ok(paths.includes('/node_modules/@kun/remote-protocol/src/index.js'))
  assert.ok(!paths.some(name => name.includes('control-runtime') || name.includes('control-baselines') || name.endsWith('.tgz')))
})

test('final payload validation catches forbidden archive entries and external resources', async t => {
  const root = temporary(t)
  for (const [index, path] of [
    'vendor/kun-remote/old.tgz', 'node_modules/@kun/control-runtime/dist/info.js',
    'control-baselines/darwin-arm64/runtime/index.mjs'
  ].entries()) {
    const source = join(root, 'source-' + index), resources = join(root, 'resources-' + index)
    write(join(source, path), 'must not ship'); mkdirSync(resources)
    await createPackageWithOptions(source, join(resources, 'app.asar'), {})
    assert.throws(() => validateNoBundledControlPayload(resources), /must not ship/)
  }
  const clean = join(root, 'clean'), resources = join(root, 'external')
  write(join(clean, 'package.json'), {name: 'fixture'}); mkdirSync(resources)
  await createPackageWithOptions(clean, join(resources, 'app.asar'), {})
  write(join(resources, 'control-baselines/linux-x64/runtime/index.mjs'), 'obsolete')
  assert.throws(() => validateNoBundledControlPayload(resources), /must not ship/)
})
