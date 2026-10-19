'use strict'

const { execFileSync } = require('node:child_process')
const {
  chmodSync,
  closeSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync
} = require('node:fs')
const { join, relative } = require('node:path')

// Some npm packages that are already selected per architecture still publish
// universal (x86_64 + arm64) Mach-O files. @trycua/cua-driver-darwin-arm64, for
// example, ships a 46.6 MiB universal libcua_driver_sdk.dylib. A packaged app
// only ever loads the slice matching its own architecture, so the other slice
// is dead weight. `lipo -thin` copies the selected slice byte for byte, which
// keeps that slice's own code signature intact.
const FAT_MACHO_MAGICS = new Set([0xcafebabe, 0xcafebabf])
// Java class files share the 0xCAFEBABE magic, but their next word holds the
// class-file version (45 or newer). A universal Mach-O header stores its slice
// count there instead, which stays far below that.
const MAX_FAT_MACHO_SLICES = 16

function lipoArchitecture(arch) {
  if (arch === 'x64') return 'x86_64'
  if (arch === 'arm64') return 'arm64'
  throw new Error(`[after-pack] Unsupported Mach-O thinning arch: ${arch}`)
}

function isUniversalMachO(path) {
  const header = Buffer.alloc(8)
  const fd = openSync(path, 'r')
  let bytesRead
  try {
    bytesRead = readSync(fd, header, 0, header.length, 0)
  } finally {
    closeSync(fd)
  }
  if (bytesRead < header.length) return false
  const slices = header.readUInt32BE(4)
  return FAT_MACHO_MAGICS.has(header.readUInt32BE(0)) &&
    slices > 0 &&
    slices <= MAX_FAT_MACHO_SLICES
}

function universalMachOFiles(root) {
  const found = []
  const visit = (current) => {
    const details = lstatSync(current)
    if (details.isSymbolicLink()) return
    if (details.isDirectory()) {
      for (const entry of readdirSync(current)) visit(join(current, entry))
      return
    }
    if (details.isFile() && isUniversalMachO(current)) found.push(current)
  }
  visit(root)
  return found.sort()
}

function runLipo(args) {
  return execFileSync('lipo', args, { encoding: 'utf8' })
}

function thinPackedUniversalMachOFiles(context, helpers) {
  const { packedResourcesDir, normalizePlatform, normalizeArch, lipo = runLipo } = helpers
  if (normalizePlatform(context.electronPlatformName) !== 'darwin') return
  const target = lipoArchitecture(normalizeArch(context.arch))
  const resources = packedResourcesDir(context)
  for (const path of universalMachOFiles(resources)) {
    const architectures = lipo(['-archs', path]).trim().split(/\s+/)
    if (!architectures.includes(target)) {
      throw new Error(
        `[after-pack] Universal Mach-O has no ${target} slice (${architectures.join(', ')}): ${path}`
      )
    }
    const before = lstatSync(path)
    const thinned = `${path}.thin-${target}`
    rmSync(thinned, { force: true })
    lipo([path, '-thin', target, '-output', thinned])
    chmodSync(thinned, before.mode & 0o7777)
    renameSync(thinned, path)
    const after = lstatSync(path)
    console.log(
      `[after-pack] Thinned universal Mach-O to ${target}: ${relative(resources, path)} ` +
        `(${(before.size / 1048576).toFixed(1)} -> ${(after.size / 1048576).toFixed(1)} MiB)`
    )
  }
}

function validatePackedMachOArchitecture(context, helpers) {
  const { packedResourcesDir, normalizePlatform } = helpers
  if (normalizePlatform(context.electronPlatformName) !== 'darwin') return
  const resources = packedResourcesDir(context)
  const remaining = universalMachOFiles(resources)
  if (remaining.length > 0) {
    throw new Error(
      `[after-pack] Unexpected packaged universal Mach-O files: ${remaining
        .map((path) => relative(resources, path))
        .join(', ')}`
    )
  }
}

module.exports = {
  FAT_MACHO_MAGICS,
  MAX_FAT_MACHO_SLICES,
  isUniversalMachO,
  lipoArchitecture,
  thinPackedUniversalMachOFiles,
  universalMachOFiles,
  validatePackedMachOArchitecture
}
