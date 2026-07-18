#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

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

function installedPackageVersion(root, name) {
  const manifestPath = join(root, 'node_modules', ...name.split('/'), 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`Install root dependencies before preparing macOS native packages: ${manifestPath}`)
  }
  const version = readJson(manifestPath).version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Installed ${name} has an invalid version: ${String(version)}`)
  }
  return version
}

function nativeInstallArguments(arch, versions) {
  if (!SUPPORTED_ARCHITECTURES.has(arch)) {
    throw new Error(`Unsupported macOS native architecture: ${arch}`)
  }
  return [
    'install',
    '--no-save',
    '--package-lock=false',
    '--ignore-scripts',
    '--include=optional',
    '--os=darwin',
    `--cpu=${arch}`,
    `sharp@${versions.sharp}`,
    `@napi-rs/canvas@${versions.canvas}`
  ]
}

function assertTargetPackage(root, scope, name, arch) {
  const manifestPath = join(root, 'node_modules', scope, name, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`macOS ${arch} native install is missing ${name}`)
  }
  const manifest = readJson(manifestPath)
  if (!Array.isArray(manifest.os) || !manifest.os.includes('darwin') ||
      !Array.isArray(manifest.cpu) || !manifest.cpu.includes(arch)) {
    throw new Error(`${name} does not declare the expected darwin/${arch} target`)
  }
}

function targetPackages(arch) {
  return [
    ['@img', `sharp-darwin-${arch}`],
    ['@img', `sharp-libvips-darwin-${arch}`],
    ['@napi-rs', `canvas-darwin-${arch}`]
  ]
}

function installStagedTargetPackages(stagingRoot, root, arch) {
  for (const [scope, name] of targetPackages(arch)) {
    const source = join(stagingRoot, 'node_modules', scope, name)
    if (!existsSync(join(source, 'package.json'))) {
      throw new Error(`Staged macOS ${arch} native install is missing ${scope}/${name}`)
    }
    const destination = join(root, 'node_modules', scope, name)
    rmSync(destination, { recursive: true, force: true })
    mkdirSync(join(root, 'node_modules', scope), { recursive: true })
    cpSync(source, destination, { recursive: true, verbatimSymlinks: true })
  }
  for (const otherArch of SUPPORTED_ARCHITECTURES) {
    if (otherArch === arch) continue
    for (const [scope, name] of targetPackages(otherArch)) {
      rmSync(join(root, 'node_modules', scope, name), { recursive: true, force: true })
    }
  }
}

function ensureMacosNativeDependencies({
  root = resolve(__dirname, '..'),
  arch,
  execute = execFileSync,
  environment = process.env
}) {
  if (!SUPPORTED_ARCHITECTURES.has(arch)) {
    throw new Error(`--arch must be one of: ${[...SUPPORTED_ARCHITECTURES].join(', ')}`)
  }
  const versions = {
    sharp: installedPackageVersion(root, 'sharp'),
    canvas: installedPackageVersion(root, '@napi-rs/canvas')
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const stagingRoot = mkdtempSync(join(tmpdir(), `kun-macos-native-${arch}-`))
  try {
    execute(npm, nativeInstallArguments(arch, versions), {
      cwd: stagingRoot,
      env: {
        ...environment,
        npm_config_audit: 'false',
        npm_config_fund: 'false'
      },
      stdio: 'inherit'
    })
    installStagedTargetPackages(stagingRoot, root, arch)
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
  assertTargetPackage(root, '@img', `sharp-darwin-${arch}`, arch)
  assertTargetPackage(root, '@img', `sharp-libvips-darwin-${arch}`, arch)
  assertTargetPackage(root, '@napi-rs', `canvas-darwin-${arch}`, arch)
  return { arch, versions }
}

function main() {
  const result = ensureMacosNativeDependencies({ arch: argumentValue('--arch') })
  process.stdout.write(
    `Prepared Sharp ${result.versions.sharp} and Canvas ${result.versions.canvas} ` +
    `for darwin/${result.arch}\n`
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
  ensureMacosNativeDependencies,
  installedPackageVersion,
  nativeInstallArguments
}
