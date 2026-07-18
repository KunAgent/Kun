const assert = require('node:assert/strict')
const { mkdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const {
  assertMachOArchitecture,
  verifyPackagedMacosNativeArchitecture
} = require('./verify-packaged-macos-native-architecture.cjs')

async function fixture(arch) {
  const root = join(tmpdir(), `kun-packaged-macos-${process.pid}-${Date.now()}-${Math.random()}`)
  const resources = join(root, 'Kun.app', 'Contents', 'Resources')
  const modules = join(resources, 'app.asar.unpacked', 'node_modules')
  const bindingPackage = join(modules, '@img', `sharp-darwin-${arch}`)
  const libvipsPackage = join(modules, '@img', `sharp-libvips-darwin-${arch}`)
  const canvasPackage = join(modules, '@napi-rs', `canvas-darwin-${arch}`)
  await mkdir(join(modules, 'sharp'), { recursive: true })
  await mkdir(join(bindingPackage, 'lib'), { recursive: true })
  await mkdir(join(libvipsPackage, 'lib'), { recursive: true })
  await mkdir(canvasPackage, { recursive: true })
  await mkdir(join(root, 'Kun.app', 'Contents', 'MacOS'), { recursive: true })
  await writeFile(join(resources, 'app.asar'), 'asar')
  await writeFile(join(modules, 'sharp', 'package.json'), JSON.stringify({ name: 'sharp' }))
  for (const [directory, name] of [
    [bindingPackage, `@img/sharp-darwin-${arch}`],
    [libvipsPackage, `@img/sharp-libvips-darwin-${arch}`],
    [canvasPackage, `@napi-rs/canvas-darwin-${arch}`]
  ]) {
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ name, os: ['darwin'], cpu: [arch] })
    )
  }
  await writeFile(join(root, 'Kun.app', 'Contents', 'MacOS', 'Kun'), 'main')
  await writeFile(join(bindingPackage, 'lib', `sharp-darwin-${arch}.node`), 'binding')
  await writeFile(join(libvipsPackage, 'lib', 'libvips-cpp.test.dylib'), 'libvips')
  await writeFile(join(canvasPackage, `skia.darwin-${arch}.node`), 'canvas')
  return { root, resources }
}

test('accepts a packaged app whose executable, Sharp, libvips, and Canvas match x64', async (t) => {
  const value = await fixture('x64')
  t.after(() => rm(value.root, { recursive: true, force: true }))
  const result = verifyPackagedMacosNativeArchitecture({
    resourcesDir: value.resources,
    arch: 'x64',
    inspect: () => 'Mach-O 64-bit bundle x86_64'
  })
  assert.equal(result.arch, 'x64')
})

test('rejects the arm64 Sharp binding that broke the published x64 app', async (t) => {
  const value = await fixture('x64')
  t.after(() => rm(value.root, { recursive: true, force: true }))
  let calls = 0
  assert.throws(() => verifyPackagedMacosNativeArchitecture({
    resourcesDir: value.resources,
    arch: 'x64',
    inspect: () => (++calls === 1
      ? 'Mach-O 64-bit executable x86_64'
      : 'Mach-O 64-bit bundle arm64')
  }), /expected.*darwin\/x64.*arm64/i)
})

test('rejects mixed or non-Mach-O architecture descriptions', () => {
  assert.throws(
    () => assertMachOArchitecture('/tmp/sharp.node', 'arm64', () =>
      'Mach-O universal binary with 2 architectures: x86_64 arm64'),
    /Expected.*darwin\/arm64/
  )
  assert.throws(
    () => assertMachOArchitecture('/tmp/sharp.node', 'x64', () => 'ELF 64-bit LSB shared object'),
    /Expected.*Mach-O/
  )
})
