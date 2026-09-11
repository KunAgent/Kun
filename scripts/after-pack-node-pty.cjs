'use strict'

const { existsSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

// node-pty publishes macOS and Windows prebuilt native binaries, including
// ~58 MiB of Windows .pdb/.dll/.exe files plus the winpty build
// source tree. Its loader (lib/utils.js) only ever tries `build/Release`,
// `build/Debug`, then `prebuilds/<platform>-<arch>`, so every foreign prebuild
// and the C++ build source tree are dead weight in a packaged app.
const NODE_PTY_BUILD_SOURCE_PATHS = [
  'binding.gyp',
  'deps',
  'src',
  'scripts',
  'third_party',
  'node-addon-api'
]

// Build intermediates under `build/` and `build/Release` that are only needed
// to compile the native binding, not to load it at runtime. The actual
// binaries (`pty.node`, `spawn-helper`, and the Windows `conpty`/`winpty`
// artifacts) are deliberately not listed and therefore preserved.
const NODE_PTY_BUILD_INTERMEDIATE_PATHS = [
  'build/Makefile',
  'build/binding.Makefile',
  'build/config.gypi',
  'build/gyp-mac-tool',
  'build/pty.target.mk',
  'build/spawn-helper.target.mk',
  'build/Release/.deps',
  'build/Release/.forge-meta',
  'build/Release/obj.target',
  'build/Release/node-addon-api'
]

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`[after-pack] Missing ${label}: ${path}`)
  }
}

function prunePackedNodePtyPayload(context, helpers) {
  const { unpackedAppRoot, normalizePlatform, normalizeArch } = helpers
  const packageRoot = join(unpackedAppRoot(context), 'node_modules', 'node-pty')
  if (!existsSync(packageRoot)) return

  const platform = normalizePlatform(context.electronPlatformName)
  const arch = normalizeArch(context.arch)
  const targetPrebuild = `${platform}-${arch}`

  const prebuildsDir = join(packageRoot, 'prebuilds')
  if (existsSync(prebuildsDir)) {
    for (const entry of readdirSync(prebuildsDir)) {
      if (entry === targetPrebuild) continue
      rmSync(join(prebuildsDir, entry), { recursive: true, force: true })
      console.log(`[after-pack] Removed foreign node-pty prebuild: ${entry}`)
    }
  }

  for (const relativePath of NODE_PTY_BUILD_SOURCE_PATHS) {
    const target = join(packageRoot, relativePath)
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true })
    }
  }
  for (const relativePath of NODE_PTY_BUILD_INTERMEDIATE_PATHS) {
    const target = join(packageRoot, relativePath)
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true })
    }
  }

  console.log('[after-pack] Kept only the target node-pty native binary and runtime JavaScript.')
}

function validatePackedNodePtyPayload(context, helpers) {
  const { unpackedAppRoot, normalizePlatform, normalizeArch } = helpers
  const packageRoot = join(unpackedAppRoot(context), 'node_modules', 'node-pty')
  // node-pty is always packaged as a root dependency, but several packaging
  // fixtures exercise prune/validate without it; skip instead of failing there
  // (mirrors prunePackedOnnxRuntimeBinaries' optional-package behavior).
  if (!existsSync(packageRoot)) return

  const platform = normalizePlatform(context.electronPlatformName)
  const arch = normalizeArch(context.arch)
  const targetPrebuild = `${platform}-${arch}`

  assertExists(join(packageRoot, 'package.json'), 'node-pty package manifest')
  assertExists(join(packageRoot, 'lib', 'index.js'), 'node-pty runtime JavaScript')
  // Linux compiles locally and has no published prebuild. Follow the loader's
  // candidate directories and require a complete set of runtime artifacts.
  const candidates = ['build/Release', 'build/Debug', `prebuilds/${targetPrebuild}`]
  const requiredFiles = platform === 'win32'
    ? ['pty.node', 'winpty.dll', 'winpty-agent.exe', 'conpty.node', 'conpty_console_list.node']
    : ['pty.node', 'spawn-helper']
  if (!candidates.some((dir) => requiredFiles.every((file) => existsSync(join(packageRoot, dir, file))))) {
    throw new Error(
      `[after-pack] Missing node-pty ${targetPrebuild} runtime artifacts (${requiredFiles.join(', ')}); checked ${candidates.join(', ')}`
    )
  }

  const prebuildsDir = join(packageRoot, 'prebuilds')
  const unexpectedPrebuilds = existsSync(prebuildsDir)
    ? readdirSync(prebuildsDir).filter((entry) => entry !== targetPrebuild)
    : []
  if (unexpectedPrebuilds.length > 0) {
    throw new Error(
      `[after-pack] Unexpected foreign node-pty prebuilds: ${unexpectedPrebuilds.join(', ')}`
    )
  }

  for (const relativePath of NODE_PTY_BUILD_SOURCE_PATHS) {
    if (existsSync(join(packageRoot, relativePath))) {
      throw new Error(`[after-pack] Unexpected node-pty build source: ${relativePath}`)
    }
  }
}

function trimPackedNodePtyPayload(context, helpers) {
  prunePackedNodePtyPayload(context, helpers)
  validatePackedNodePtyPayload(context, helpers)
}

module.exports = {
  NODE_PTY_BUILD_SOURCE_PATHS,
  NODE_PTY_BUILD_INTERMEDIATE_PATHS,
  prunePackedNodePtyPayload,
  validatePackedNodePtyPayload,
  trimPackedNodePtyPayload
}
