#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync, readdirSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')

const SUPPORTED_ARCHITECTURES = new Set(['x64', 'arm64'])

function argumentValue(name, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name)
  if (index < 0) return undefined
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function requirePath(path, label) {
  if (!existsSync(path)) throw new Error(`Packaged macOS app is missing ${label}: ${path}`)
  return path
}

function assertTargetManifest(path, arch, label) {
  const manifest = readJson(requirePath(path, `${label} manifest`))
  if (!Array.isArray(manifest.os) || !manifest.os.includes('darwin') ||
      !Array.isArray(manifest.cpu) || !manifest.cpu.includes(arch)) {
    throw new Error(`${label} does not declare the expected darwin/${arch} target`)
  }
}

function assertMachOArchitecture(path, arch, inspect = (candidate) =>
  execFileSync('file', ['-b', candidate], { encoding: 'utf8' }).trim()) {
  const description = String(inspect(path))
  const required = arch === 'x64' ? /\bx86_64\b/ : /\barm64\b/
  const forbidden = arch === 'x64' ? /\barm64\b/ : /\bx86_64\b/
  if (!/\bMach-O\b/.test(description) || !required.test(description) || forbidden.test(description)) {
    throw new Error(`Expected ${path} to be a darwin/${arch} Mach-O file, got: ${description}`)
  }
  return description
}

function verifyPackagedMacosNativeArchitecture({ resourcesDir, arch, inspect }) {
  if (!SUPPORTED_ARCHITECTURES.has(arch)) {
    throw new Error(`--arch must be one of: ${[...SUPPORTED_ARCHITECTURES].join(', ')}`)
  }
  const resources = resolve(resourcesDir)
  const contents = dirname(resources)
  requirePath(join(resources, 'app.asar'), 'app.asar')
  const unpackedModules = join(resources, 'app.asar.unpacked', 'node_modules')
  requirePath(join(unpackedModules, 'sharp', 'package.json'), 'Sharp package')

  const bindingPackage = join(unpackedModules, '@img', `sharp-darwin-${arch}`)
  const libvipsPackage = join(unpackedModules, '@img', `sharp-libvips-darwin-${arch}`)
  const canvasPackage = join(unpackedModules, '@napi-rs', `canvas-darwin-${arch}`)
  assertTargetManifest(join(bindingPackage, 'package.json'), arch, 'Sharp binding')
  assertTargetManifest(join(libvipsPackage, 'package.json'), arch, 'Sharp libvips')
  assertTargetManifest(join(canvasPackage, 'package.json'), arch, 'Canvas binding')

  const mainExecutable = requirePath(join(contents, 'MacOS', 'Kun'), 'main executable')
  const binding = requirePath(
    join(bindingPackage, 'lib', `sharp-darwin-${arch}.node`),
    'Sharp native binding'
  )
  const libvipsDirectory = join(libvipsPackage, 'lib')
  const libvipsName = readdirSync(requirePath(libvipsDirectory, 'Sharp libvips directory'))
    .find((name) => name.endsWith('.dylib'))
  if (!libvipsName) throw new Error(`Packaged macOS app is missing a libvips dylib in ${libvipsDirectory}`)
  const libvips = join(libvipsDirectory, libvipsName)
  const canvas = requirePath(
    join(canvasPackage, `skia.darwin-${arch}.node`),
    'Canvas native binding'
  )

  for (const path of [mainExecutable, binding, libvips, canvas]) {
    assertMachOArchitecture(path, arch, inspect)
  }
  return { arch, mainExecutable, binding, libvips, canvas }
}

function main() {
  const result = verifyPackagedMacosNativeArchitecture({
    resourcesDir: argumentValue('--resources'),
    arch: argumentValue('--arch')
  })
  process.stdout.write(
    `Packaged macOS native architecture OK: darwin/${result.arch}, ` +
    'Sharp, libvips, and Canvas match the app\n'
  )
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  assertMachOArchitecture,
  verifyPackagedMacosNativeArchitecture
}
