'use strict'

const {
  buildPackagedRuntimeIntegrity,
  verifyPackagedRuntimeIntegrity,
  writePackagedRuntimeIntegrity
} = require('./packaged-runtime-integrity.cjs')

function normalizePlatform(platform) {
  return platform === 'win' ? 'win32' : platform
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 1) return 'x64'
  if (arch === 'arm64' || arch === 3) return 'arm64'
  throw new Error(`[after-pack] Unsupported packaged resource arch: ${arch}`)
}

// Runs after every pruning step has settled the payload, so the manifest
// describes what actually ships. A runtime whose compiled imports cannot be
// resolved from the packaged node_modules fails the pack here instead of on a
// user's machine after an update.
function writeRuntimeIntegrityManifest(context, resourcesDir) {
  const manifest = buildPackagedRuntimeIntegrity({
    resourcesDir,
    platform: normalizePlatform(context.electronPlatformName),
    arch: normalizeArch(context.arch)
  })
  writePackagedRuntimeIntegrity(resourcesDir, manifest)
  const verified = verifyPackagedRuntimeIntegrity({ resourcesDir, manifest, mode: 'hash' })
  if (!verified.ok) {
    throw new Error(
      '[after-pack] Packaged Kun runtime failed integrity verification:\n' +
        verified.problems.join('\n')
    )
  }
  console.log(
    `[after-pack] Kun runtime integrity: ${manifest.files.length} files, ` +
      `${manifest.modules.length} packages.`
  )
}

module.exports = { writeRuntimeIntegrityManifest }
