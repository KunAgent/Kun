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
  const cuaPackage = join(modules, '@trycua', `cua-driver-darwin-${arch}`)
  const opentuiPackage = join(
    resources, 'app.asar.unpacked', 'kun', 'node_modules', '@opentui', `core-darwin-${arch}`
  )
  await mkdir(join(modules, 'sharp'), { recursive: true })
  await mkdir(join(bindingPackage, 'lib'), { recursive: true })
  await mkdir(join(libvipsPackage, 'lib'), { recursive: true })
  await mkdir(canvasPackage, { recursive: true })
  await mkdir(cuaPackage, { recursive: true })
  await mkdir(opentuiPackage, { recursive: true })
  await mkdir(join(root, 'Kun.app', 'Contents', 'MacOS'), { recursive: true })
  await writeFile(join(resources, 'app.asar'), 'asar')
  await writeFile(join(modules, 'sharp', 'package.json'), JSON.stringify({ name: 'sharp' }))
  for (const [directory, name] of [
    [bindingPackage, `@img/sharp-darwin-${arch}`],
    [libvipsPackage, `@img/sharp-libvips-darwin-${arch}`],
    [canvasPackage, `@napi-rs/canvas-darwin-${arch}`],
    [cuaPackage, `@trycua/cua-driver-darwin-${arch}`],
    [opentuiPackage, `@opentui/core-darwin-${arch}`]
  ]) {
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ name, os: ['darwin'], cpu: [arch] })
    )
  }
  await writeFile(join(root, 'Kun.app', 'Contents', 'MacOS', 'Kun'), 'main')
  await writeFile(join(bindingPackage, 'lib', `sharp-darwin-${arch}-0.35.3.node`), 'binding')
  await writeFile(join(libvipsPackage, 'lib', 'libvips-cpp.test.dylib'), 'libvips')
  await writeFile(join(canvasPackage, `skia.darwin-${arch}.node`), 'canvas')
  const cuaDriver = join(cuaPackage, 'libcua_driver_sdk.dylib')
  const cuaRuntime = join(cuaPackage, 'cua_driver_node_runtime.node')
  const opentui = join(opentuiPackage, 'libopentui.dylib')
  await writeFile(cuaDriver, 'cua driver')
  await writeFile(cuaRuntime, 'cua runtime')
  await writeFile(opentui, 'opentui')
  return { root, resources, modules, cuaPackage, cuaDriver, cuaRuntime, opentui }
}

for (const arch of ['x64', 'arm64']) {
  test(`accepts a packaged app whose native payloads match ${arch}`, async (t) => {
    const value = await fixture(arch)
    t.after(() => rm(value.root, { recursive: true, force: true }))
    const inspected = []
    const result = verifyPackagedMacosNativeArchitecture({
      resourcesDir: value.resources,
      arch,
      inspect: (path) => {
        inspected.push(path)
        return `Mach-O 64-bit bundle ${arch === 'x64' ? 'x86_64' : 'arm64'}`
      }
    })
    assert.equal(result.arch, arch)
    assert.equal(inspected.length, 7)
    for (const key of ['cuaDriver', 'cuaRuntime', 'opentui']) {
      assert.equal(result[key], value[key])
      assert.ok(inspected.includes(value[key]))
    }
  })

  test(`accepts published universal CUA binaries that contain ${arch}`, async (t) => {
    const value = await fixture(arch)
    t.after(() => rm(value.root, { recursive: true, force: true }))
    verifyPackagedMacosNativeArchitecture({
      resourcesDir: value.resources,
      arch,
      inspect: (path) => path === value.cuaDriver || path === value.cuaRuntime
        ? 'Mach-O universal binary with 2 architectures: x86_64 arm64'
        : `Mach-O 64-bit bundle ${arch === 'x64' ? 'x86_64' : 'arm64'}`
    })
  })
}

for (const key of ['cuaDriver', 'cuaRuntime', 'opentui']) {
  test(`rejects a missing packaged ${key} binary`, async (t) => {
    const value = await fixture('x64')
    t.after(() => rm(value.root, { recursive: true, force: true }))
    await rm(value[key])
    assert.throws(() => verifyPackagedMacosNativeArchitecture({
      resourcesDir: value.resources,
      arch: 'x64',
      inspect: () => 'Mach-O 64-bit bundle x86_64'
    }), /missing.*(?:CUA Driver|OpenTUI)/)
  })

  test(`rejects a packaged ${key} binary without the target architecture`, async (t) => {
    const value = await fixture('x64')
    t.after(() => rm(value.root, { recursive: true, force: true }))
    assert.throws(() => verifyPackagedMacosNativeArchitecture({
      resourcesDir: value.resources,
      arch: 'x64',
      inspect: (path) => path === value[key]
        ? 'Mach-O 64-bit bundle arm64'
        : 'Mach-O 64-bit bundle x86_64'
    }), /expected.*darwin\/x64.*arm64/i)
  })
}

test('rejects CUA packages with host architecture metadata', async (t) => {
  const value = await fixture('x64')
  t.after(() => rm(value.root, { recursive: true, force: true }))
  await writeFile(join(value.cuaPackage, 'package.json'), JSON.stringify({
    os: ['darwin'], cpu: ['arm64']
  }))
  assert.throws(() => verifyPackagedMacosNativeArchitecture({
    resourcesDir: value.resources,
    arch: 'x64',
    inspect: () => 'Mach-O universal binary with 2 architectures: x86_64 arm64'
  }), /CUA Driver.*expected darwin\/x64/)
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

test('universal CUA support still requires Mach-O and the requested architecture', () => {
  for (const description of [
    'Mach-O universal binary with 2 architectures: arm64 arm64e',
    'ELF 64-bit LSB shared object, x86_64',
    'Mach-O 64-bit bundle arm64'
  ]) {
    assert.throws(() => assertMachOArchitecture(
      '/tmp/cua_driver_node_runtime.node', 'x64', () => description, { allowUniversal: true }
    ), /Expected.*darwin\/x64/)
  }
})
