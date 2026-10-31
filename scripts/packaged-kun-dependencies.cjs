'use strict'

const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { join } = require('node:path')

// Resolve ASAR through electron-builder's own dependency, even when npm nests it.
const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'))
const { extractFile, uncache } = appBuilderRequire('@electron/asar')

function readJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`[packaged-kun-dependencies] Cannot read ${label}: ${path} (${error.message})`)
  }
}

// Workspace links are built separately; the versioned external @kun packages
// must match the root lockfile, not merely another installed copy.
function lockedKunDependencies(projectDir) {
  const manifest = readJsonFile(join(projectDir, 'package.json'), 'root package manifest')
  const lock = readJsonFile(join(projectDir, 'package-lock.json'), 'root lockfile')
  const locked = []
  for (const [name, spec] of Object.entries(manifest.dependencies || {})) {
    if (!name.startsWith('@kun/')) continue
    const entry = lock.packages?.[`node_modules/${name}`]
    if (!entry || lock.packages?.['']?.dependencies?.[name] !== spec) {
      throw new Error(`[packaged-kun-dependencies] ${name} does not match package-lock.json; update the lockfile and run npm ci.`)
    }
    if (entry.link === true) continue
    if (typeof entry.version !== 'string' || !entry.version || entry.dev === true ||
        (spec.startsWith('file:') && entry.resolved !== spec)) {
      throw new Error(`[packaged-kun-dependencies] Invalid locked production dependency ${name}; update the lockfile and run npm ci.`)
    }
    locked.push({ name, version: entry.version })
  }
  return locked
}

function assertDependencyVersion(expected, actual, location) {
  if (actual.name !== expected.name || actual.version !== expected.version) {
    throw new Error(
      `[packaged-kun-dependencies] ${expected.name} mismatch in ${location}: ` +
      `expected ${expected.name}@${expected.version} from package-lock.json, ` +
      `found ${actual.name || 'unknown'}@${actual.version || 'unknown'}. ` +
      'Run npm ci in the project root and rebuild the installer.'
    )
  }
}

function validateInstalledKunDependencies(projectDir) {
  for (const expected of lockedKunDependencies(projectDir)) {
    const manifestPath = join(projectDir, 'node_modules', ...expected.name.split('/'), 'package.json')
    const actual = readJsonFile(manifestPath, `installed ${expected.name} manifest; run npm ci`)
    assertDependencyVersion(expected, actual, manifestPath)
  }
}

function validatePackagedKunDependencies(projectDir, archivePath) {
  // electron-builder may produce another archive at the same path in this process.
  uncache(archivePath)
  for (const expected of lockedKunDependencies(projectDir)) {
    const manifestPath = join('node_modules', ...expected.name.split('/'), 'package.json')
    let actual
    try {
      actual = JSON.parse(extractFile(archivePath, manifestPath).toString('utf8'))
    } catch (error) {
      throw new Error(
        `[packaged-kun-dependencies] Cannot read ${expected.name} from ${archivePath}: ` +
        `${error.message}. Run npm ci in the project root and rebuild the installer.`
      )
    }
    assertDependencyVersion(expected, actual, `${archivePath}/${manifestPath}`)
  }
}

module.exports = { lockedKunDependencies, validateInstalledKunDependencies, validatePackagedKunDependencies }
