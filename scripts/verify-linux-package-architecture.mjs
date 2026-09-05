#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ARCHITECTURES = {
  x64: {
    appImage: 'x86_64',
    deb: 'amd64',
    unpacked: 'linux-unpacked',
    filePattern: /(?:x86-64|x86_64)/i
  },
  arm64: {
    appImage: 'arm64',
    deb: 'arm64',
    unpacked: 'linux-arm64-unpacked',
    filePattern: /(?:ARM aarch64|ARM64|aarch64)/i
  }
}

export function linuxPackageNames(version, arch) {
  const target = ARCHITECTURES[arch]
  if (!target) throw new Error(`Unsupported Linux package architecture: ${arch}`)
  return {
    appImage: `Kun-${version}-linux-${target.appImage}.AppImage`,
    deb: `Kun-${version}-linux-${target.deb}.deb`,
    update: arch === 'x64' ? 'latest-linux.yml' : `latest-linux-${arch}.yml`,
    unpacked: target.unpacked
  }
}

export function assertArchitectureDescription(description, arch, label) {
  const target = ARCHITECTURES[arch]
  if (!target?.filePattern.test(description)) {
    throw new Error(`${label} is not Linux ${arch}: ${description}`)
  }
}

export function assertUpdateMetadata(source, appImageName, arch) {
  if (!source.includes(`url: ${appImageName}`)) {
    throw new Error(`Linux ${arch} update metadata does not reference ${appImageName}`)
  }
  const opposite = arch === 'arm64' ? /-linux-x86_64\.AppImage/u : /-linux-arm64\.AppImage/u
  if (opposite.test(source)) {
    throw new Error(`Linux ${arch} update metadata references the opposite architecture`)
  }
}

async function regularFile(path, label) {
  const details = await stat(path)
  if (!details.isFile() || details.size <= 0) throw new Error(`${label} is not a non-empty file: ${path}`)
  return path
}

async function collectNativeModules(root) {
  const modules = []
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name.endsWith('.node')) modules.push(path)
    }
  }
  await visit(root)
  return modules
}

function normalizedModulePath(path) {
  return path.replaceAll('\\', '/')
}

function targetNativeModuleGroups(arch) {
  return [
    {
      label: 'better-sqlite3',
      pattern: /\/node_modules\/better-sqlite3\/build\/Release\/better_sqlite3\.node$/u
    },
    {
      label: 'node-pty',
      pattern: /\/node_modules\/node-pty\/build\/Release\/pty\.node$/u
    },
    {
      label: '@napi-rs/canvas',
      pattern: new RegExp(`/node_modules/@napi-rs/canvas-linux-${arch}-gnu/[^/]+\\.node$`, 'u')
    },
    {
      label: 'sharp',
      pattern: new RegExp(`/node_modules/@img/sharp-linux-${arch}/lib/[^/]+\\.node$`, 'u')
    },
    ...(arch === 'x64'
      ? [{
          label: '@computer-use/libnut-linux',
          pattern: /\/node_modules\/@computer-use\/libnut-linux\/build\/Release\/libnut\.node$/u
        }]
      : [])
  ]
}

export function selectTargetNativeModules(paths, arch) {
  if (!ARCHITECTURES[arch]) throw new Error(`Unsupported Linux package architecture: ${arch}`)
  const modules = paths.map((path) => ({ path, normalized: normalizedModulePath(path) }))
  if (arch === 'arm64') {
    const incompatible = modules.find(({ normalized }) => (
      /\/node_modules\/@computer-use\/libnut-linux\/.*\.node$/u.test(normalized)
    ))
    if (incompatible) {
      throw new Error(`Linux ARM64 package contains the upstream x64-only libnut binding: ${incompatible.path}`)
    }
  }

  const selected = []
  for (const group of targetNativeModuleGroups(arch)) {
    const matches = modules.filter(({ normalized }) => group.pattern.test(normalized))
    if (matches.length === 0) {
      throw new Error(`Packaged Linux ${arch} application is missing required ${group.label} native module`)
    }
    selected.push(...matches.map(({ path }) => path))
  }
  return [...new Set(selected)]
}

function fileDescription(path) {
  return execFileSync('file', ['-b', path], { encoding: 'utf8' }).trim()
}

export async function verifyLinuxPackageArchitecture({ distDirectory, version, arch }) {
  const root = resolve(distDirectory)
  const names = linuxPackageNames(version, arch)
  const appImage = await regularFile(join(root, names.appImage), 'AppImage')
  const deb = await regularFile(join(root, names.deb), 'deb package')
  const update = await regularFile(join(root, names.update), 'update metadata')
  const unpacked = join(root, names.unpacked)
  const electron = await regularFile(join(unpacked, 'kun-gui.electron-bin'), 'Electron executable')
  const resources = join(unpacked, 'resources')
  const officeCli = await regularFile(join(resources, 'officecli', 'officecli'), 'OfficeCLI executable')
  const whisper = await regularFile(
    join(resources, 'whisper', `linux-${arch}`, 'whisper-cli'),
    'Whisper executable'
  )
  const nativeModules = await collectNativeModules(join(resources, 'app.asar.unpacked'))
  if (nativeModules.length === 0) throw new Error('Packaged Linux application contains no native modules')
  const selectedNativeModules = selectTargetNativeModules(nativeModules, arch)

  for (const [path, label] of [
    [appImage, 'AppImage runtime'],
    [electron, 'Electron executable'],
    [officeCli, 'OfficeCLI executable'],
    [whisper, 'Whisper executable'],
    ...selectedNativeModules.map((path) => [path, `native module ${basename(path)}`])
  ]) {
    assertArchitectureDescription(fileDescription(path), arch, label)
  }
  const debArch = execFileSync('dpkg-deb', ['-f', deb, 'Architecture'], { encoding: 'utf8' }).trim()
  if (debArch !== ARCHITECTURES[arch].deb) {
    throw new Error(`deb package architecture is ${debArch}, expected ${ARCHITECTURES[arch].deb}`)
  }
  assertUpdateMetadata(await readFile(update, 'utf8'), names.appImage, arch)
  const selectedOfficeCli = JSON.parse(await readFile(join(resources, 'officecli', 'selected.json'), 'utf8'))
  if (selectedOfficeCli?.platform !== 'linux' || selectedOfficeCli?.arch !== arch) {
    throw new Error(`OfficeCLI selected target does not match linux-${arch}`)
  }
  return { appImage, deb, update, nativeModuleCount: selectedNativeModules.length }
}

function parseArgs(argv) {
  const flags = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || !value) throw new Error(`Invalid argument near ${name ?? '(end)'}`)
    flags.set(name.slice(2), value)
  }
  const version = flags.get('version')
  const arch = flags.get('arch')
  if (!version || !arch) throw new Error('Usage: verify-linux-package-architecture --version <version> --arch x64|arm64 [--dist dist]')
  return { version, arch, distDirectory: flags.get('dist') ?? 'dist' }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyLinuxPackageArchitecture(parseArgs(process.argv.slice(2)))
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
