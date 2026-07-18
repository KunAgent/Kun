const assert = require('node:assert/strict')
const { mkdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const {
  ensureMacosNativeDependencies,
  nativeInstallArguments
} = require('./ensure-macos-native-dependencies.cjs')

async function fixture() {
  const root = join(tmpdir(), `kun-sharp-architecture-${process.pid}-${Date.now()}-${Math.random()}`)
  await mkdir(join(root, 'node_modules', 'sharp'), { recursive: true })
  await writeFile(
    join(root, 'node_modules', 'sharp', 'package.json'),
    JSON.stringify({ name: 'sharp', version: '0.34.5' })
  )
  await mkdir(join(root, 'node_modules', '@napi-rs', 'canvas'), { recursive: true })
  await writeFile(
    join(root, 'node_modules', '@napi-rs', 'canvas', 'package.json'),
    JSON.stringify({ name: '@napi-rs/canvas', version: '0.1.100' })
  )
  return root
}

test('uses npm cross-platform flags without changing package metadata', () => {
  assert.deepEqual(nativeInstallArguments('x64', { sharp: '0.34.5', canvas: '0.1.100' }), [
    'install',
    '--no-save',
    '--package-lock=false',
    '--ignore-scripts',
    '--include=optional',
    '--os=darwin',
    '--cpu=x64',
    'sharp@0.34.5',
    '@napi-rs/canvas@0.1.100'
  ])
  assert.throws(
    () => nativeInstallArguments('ia32', { sharp: '0.34.5', canvas: '0.1.100' }),
    /Unsupported/
  )
})

test('requires target Sharp, libvips, and Canvas packages after installation', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const calls = []
  const result = ensureMacosNativeDependencies({
    root,
    arch: 'x64',
    execute: (_command, args, options) => {
      calls.push({ args, options })
      for (const name of ['sharp-darwin-x64', 'sharp-libvips-darwin-x64']) {
        const directory = join(options.cwd, 'node_modules', '@img', name)
        require('node:fs').mkdirSync(directory, { recursive: true })
        require('node:fs').writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify({ name: `@img/${name}`, os: ['darwin'], cpu: ['x64'] })
        )
      }
      const canvasDirectory = join(options.cwd, 'node_modules', '@napi-rs', 'canvas-darwin-x64')
      require('node:fs').mkdirSync(canvasDirectory, { recursive: true })
      require('node:fs').writeFileSync(
        join(canvasDirectory, 'package.json'),
        JSON.stringify({ name: '@napi-rs/canvas-darwin-x64', os: ['darwin'], cpu: ['x64'] })
      )
    }
  })
  assert.deepEqual(result, {
    arch: 'x64',
    versions: { sharp: '0.34.5', canvas: '0.1.100' }
  })
  assert.equal(calls.length, 1)
  assert.ok(calls[0].args.includes('--cpu=x64'))
  assert.match(calls[0].options.cwd, /kun-macos-native-x64-/)
})

test('fails closed when npm does not install the target architecture', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.throws(
    () => ensureMacosNativeDependencies({ root, arch: 'arm64', execute: () => undefined }),
    /missing.*sharp-darwin-arm64/
  )
})

test('fails closed when the target Canvas package is absent', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.throws(() => ensureMacosNativeDependencies({
    root,
    arch: 'x64',
    execute: (_command, _args, options) => {
      for (const name of ['sharp-darwin-x64', 'sharp-libvips-darwin-x64']) {
        const directory = join(options.cwd, 'node_modules', '@img', name)
        require('node:fs').mkdirSync(directory, { recursive: true })
        require('node:fs').writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify({ name: `@img/${name}`, os: ['darwin'], cpu: ['x64'] })
        )
      }
    }
  }), /missing.*canvas-darwin-x64/i)
})
