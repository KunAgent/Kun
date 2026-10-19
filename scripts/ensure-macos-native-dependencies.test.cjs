const assert = require('node:assert/strict')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { mkdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const {
  ensureMacosNativeDependencies,
  nativeInstallArguments
} = require('./ensure-macos-native-dependencies.cjs')

const VERSIONS = {
  sharp: '0.34.5',
  canvas: '0.1.100',
  cursorSdk: '1.0.24',
  opentuiCore: '0.6.6'
}

async function fixture(opentuiVersion = VERSIONS.opentuiCore) {
  const root = join(tmpdir(), `kun-native-architecture-${process.pid}-${Date.now()}-${Math.random()}`)
  for (const [name, version] of [
    ['node_modules/sharp', VERSIONS.sharp],
    ['node_modules/@napi-rs/canvas', VERSIONS.canvas],
    ['kun/node_modules/@cursor/sdk', VERSIONS.cursorSdk],
    ['kun/node_modules/@opentui/core', opentuiVersion]
  ]) {
    await mkdir(join(root, name), { recursive: true })
    await writeFile(join(root, name, 'package.json'), JSON.stringify({ version }))
  }
  return root
}

function stagePackages(root, arch, { omit, opentuiManifest = {} } = {}) {
  for (const name of [
    `@img/sharp-darwin-${arch}`,
    `@img/sharp-libvips-darwin-${arch}`,
    `@napi-rs/canvas-darwin-${arch}`,
    `@cursor/sdk-darwin-${arch}`,
    `@opentui/core-darwin-${arch}`
  ]) {
    if (name === omit) continue
    const directory = join(root, 'node_modules', name)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      name,
      os: ['darwin'],
      cpu: [arch],
      ...(name.startsWith('@opentui/') ? { version: VERSIONS.opentuiCore, ...opentuiManifest } : {})
    }))
    if (name.startsWith('@opentui/')) {
      writeFileSync(join(directory, 'libopentui.dylib'), `OpenTUI ${arch} binary fixture`)
    }
  }
}

test('uses npm cross-platform flags without changing package metadata', () => {
  assert.deepEqual(nativeInstallArguments('x64', VERSIONS), [
    'install',
    '--no-save',
    '--package-lock=false',
    '--ignore-scripts',
    '--include=optional',
    '--force',
    '--os=darwin',
    '--cpu=x64',
    'sharp@0.34.5',
    '@napi-rs/canvas@0.1.100',
    '@cursor/sdk-darwin-x64@1.0.24',
    '@opentui/core-darwin-x64@0.6.6'
  ])
  assert.throws(() => nativeInstallArguments('ia32', VERSIONS), /Unsupported/)
})

test('stages target packages and switches Kun native payloads between macOS builds', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const coreManifest = join(root, 'kun/node_modules/@opentui/core/package.json')
  const originalManifest = readFileSync(coreManifest, 'utf8')
  for (const arch of ['x64', 'arm64', 'x64']) {
    const calls = []
    const result = ensureMacosNativeDependencies({
      root,
      arch,
      execute: (_command, args, options) => {
        calls.push({ args, options })
        stagePackages(options.cwd, arch)
      }
    })
    assert.deepEqual(result, { arch, versions: VERSIONS })
    assert.equal(calls.length, 1)
    assert.ok(calls[0].args.includes(`--cpu=${arch}`))
    assert.ok(calls[0].args.includes(`@opentui/core-darwin-${arch}@0.6.6`))
    assert.match(calls[0].options.cwd, new RegExp(`kun-macos-native-${arch}-`))
    assert.equal(existsSync(calls[0].options.cwd), false, 'staging directory is removed')
    const otherArch = arch === 'x64' ? 'arm64' : 'x64'
    for (const name of ['@cursor/sdk', '@opentui/core']) {
      assert.ok(existsSync(join(root, 'kun/node_modules', `${name}-darwin-${arch}/package.json`)))
      assert.equal(existsSync(join(root, 'kun/node_modules', `${name}-darwin-${otherArch}`)), false)
    }
    assert.equal(readFileSync(join(
      root, 'kun/node_modules/@opentui', `core-darwin-${arch}`, 'libopentui.dylib'
    ), 'utf8'), `OpenTUI ${arch} binary fixture`)
    assert.equal(existsSync(join(root, 'node_modules/@opentui')), false, 'OpenTUI belongs in Kun')
    assert.equal(readFileSync(coreManifest, 'utf8'), originalManifest)
  }
})

test('uses the installed OpenTUI version instead of a hardcoded or latest version', async (t) => {
  const root = await fixture('0.6.7')
  t.after(() => rm(root, { recursive: true, force: true }))
  const result = ensureMacosNativeDependencies({
    root,
    arch: 'arm64',
    execute: (_command, args, options) => {
      assert.ok(args.includes('@opentui/core-darwin-arm64@0.6.7'))
      stagePackages(options.cwd, 'arm64', { opentuiManifest: { version: '0.6.7' } })
    }
  })
  assert.equal(result.versions.opentuiCore, '0.6.7')
})

test('fails closed when npm does not install the target architecture', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.throws(
    () => ensureMacosNativeDependencies({ root, arch: 'arm64', execute: () => undefined }),
    /missing.*sharp-darwin-arm64/
  )
})

for (const [name, pattern] of [
  ['@napi-rs/canvas-darwin-x64', /missing.*canvas-darwin-x64/i],
  ['@cursor/sdk-darwin-x64', /missing.*sdk-darwin-x64/i],
  ['@opentui/core-darwin-x64', /missing.*core-darwin-x64/i]
]) {
  test(`fails closed when the target ${name} package is absent`, async (t) => {
    const root = await fixture()
    t.after(() => rm(root, { recursive: true, force: true }))
    assert.throws(() => ensureMacosNativeDependencies({
      root,
      arch: 'x64',
      execute: (_command, _args, options) => stagePackages(options.cwd, 'x64', { omit: name })
    }), pattern)
  })
}

for (const [manifest, pattern] of [
  [{ os: ['linux'] }, /core-darwin-x64.*expected darwin\/x64/],
  [{ cpu: ['arm64'] }, /core-darwin-x64.*expected darwin\/x64/],
  [{ version: '0.6.5' }, /core-darwin-x64.*installed runtime version 0\.6\.6/]
]) {
  test(`rejects mismatched OpenTUI metadata ${JSON.stringify(manifest)}`, async (t) => {
    const root = await fixture()
    t.after(() => rm(root, { recursive: true, force: true }))
    assert.throws(() => ensureMacosNativeDependencies({
      root,
      arch: 'x64',
      execute: (_command, _args, options) => stagePackages(options.cwd, 'x64', {
        opentuiManifest: manifest
      })
    }), pattern)
  })
}
