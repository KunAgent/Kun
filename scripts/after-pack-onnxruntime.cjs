'use strict'

const { existsSync, lstatSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

/**
 * onnxruntime-node publishes prebuilt binaries for every platform/arch pair
 * (~238 MB total). Local Kokoro speech only ever loads the one matching the
 * packaged target, so the rest are removed after packing.
 */
function prunePackedOnnxRuntimeBinaries(context, helpers) {
  const { unpackedAppRoot, normalizePlatform, normalizeArch } = helpers
  const packageRoot = join(unpackedAppRoot(context), 'node_modules', 'onnxruntime-node')
  if (!existsSync(packageRoot)) return
  const binRoot = join(packageRoot, 'bin')
  if (!existsSync(binRoot)) return
  const platform = normalizePlatform(context.electronPlatformName)
  const arch = normalizeArch(context.arch)
  let kept = false
  for (const abi of readdirSync(binRoot)) {
    const abiRoot = join(binRoot, abi)
    if (!lstatSync(abiRoot).isDirectory()) continue
    for (const platformName of readdirSync(abiRoot)) {
      const platformRoot = join(abiRoot, platformName)
      if (!lstatSync(platformRoot).isDirectory()) continue
      if (platformName !== platform) {
        rmSync(platformRoot, { recursive: true, force: true })
        continue
      }
      for (const archName of readdirSync(platformRoot)) {
        if (archName === arch) {
          kept = true
          continue
        }
        rmSync(join(platformRoot, archName), { recursive: true, force: true })
      }
    }
  }
  if (!kept) {
    throw new Error(
      `[after-pack] onnxruntime-node has no prebuilt binary for ${platform}/${arch}`
    )
  }
  console.log(`[after-pack] Kept only the ${platform}/${arch} ONNX Runtime binary.`)
}

module.exports = { prunePackedOnnxRuntimeBinaries }
