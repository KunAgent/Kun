const assert = require('node:assert/strict')
const { mkdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const {
  assertMachOArchitecture,
  packagedOnnxRuntimeBinaries,
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
  await writeFile(join(bindingPackage, 'lib', `sharp-darwin-${arch}-0.35.3.node`), 'binding')
  await writeFile(join(libvipsPackage, 'lib', 'libvips-cpp.test.dylib'), 'libvips')
  await writeFile(join(canvasPackage, `skia.darwin-${arch}.node`), 'canvas')
  const onnxRoot = join(modules, 'onnxruntime-node', 'bin', 'napi-v6', 'darwin', arch)
  await mkdir(onnxRoot, { recursive: true })
  await writeFile(join(onnxRoot, 'onnxruntime_binding.node'), 'ort-binding')
  await writeFile(join(onnxRoot, 'libonnxruntime.1.22.0.dylib'), 'ort-library')
  return { root, resources, modules }
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

test('accepts the pruned ONNX Runtime tree and reports both binaries', async (t) => {
  const value = await fixture('arm64')
  t.after(() => rm(value.root, { recursive: true, force: true }))
  const result = packagedOnnxRuntimeBinaries(value.modules, 'arm64')
  assert.match(result.binding, /darwin\/arm64\/onnxruntime_binding\.node$/)
  assert.match(result.library, /darwin\/arm64\/libonnxruntime\.1\.22\.0\.dylib$/)
})

test('rejects an ONNX Runtime tree the afterPack prune did not narrow', async (t) => {
  const value = await fixture('arm64')
  t.after(() => rm(value.root, { recursive: true, force: true }))
  const abiRoot = join(value.modules, 'onnxruntime-node', 'bin', 'napi-v6')
  await mkdir(join(abiRoot, 'linux', 'x64'), { recursive: true })
  assert.throws(
    () => packagedOnnxRuntimeBinaries(value.modules, 'arm64'),
    /Expected only the darwin ONNX Runtime binaries/
  )
  await rm(join(abiRoot, 'linux'), { recursive: true, force: true })
  await mkdir(join(abiRoot, 'darwin', 'x64'), { recursive: true })
  assert.throws(
    () => packagedOnnxRuntimeBinaries(value.modules, 'arm64'),
    /Expected only the arm64 ONNX Runtime binaries/
  )
})

test('rejects an ONNX Runtime tree with no dylib beside the binding', async (t) => {
  const value = await fixture('arm64')
  t.after(() => rm(value.root, { recursive: true, force: true }))
  const archRoot = join(value.modules, 'onnxruntime-node', 'bin', 'napi-v6', 'darwin', 'arm64')
  await rm(join(archRoot, 'libonnxruntime.1.22.0.dylib'), { force: true })
  assert.throws(
    () => packagedOnnxRuntimeBinaries(value.modules, 'arm64'),
    /missing an ONNX Runtime dylib/
  )
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
