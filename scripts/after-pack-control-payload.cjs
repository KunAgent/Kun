'use strict'

const {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, rmdirSync, unlinkSync
} = require('node:fs')
const { createRequire } = require('node:module')
const { dirname, join, relative, resolve, sep } = require('node:path')

const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'))
const { listPackage, uncache } = appBuilderRequire('@electron/asar')

/** npm prune resolves local archives even when the installed JS is already present.
 * Materialize only its declared inputs, outside ASAR, and remove them before signing.
 * The callback is synchronous, matching the existing execFileSync prune operation.
 */
function withPackedKunPruneArchives(projectDir, unpackedRoot, prune) {
  const manifest = JSON.parse(readFileSync(join(unpackedRoot, 'kun/package.json'), 'utf8'))
  const references = new Set()
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const spec of Object.values(manifest[field] || {})) {
      if (typeof spec !== 'string' || !spec.startsWith('file:') || !spec.endsWith('.tgz')) continue
      if (!/^file:\.\.\/vendor\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)+[A-Za-z0-9_-][A-Za-z0-9_.-]*\.tgz$/.test(spec))
        throw new Error('[after-pack] Unsupported local archive dependency: ' + spec)
      references.add(spec.slice('file:../'.length))
    }
  }
  const files = [], directories = []
  const project = realpathSync(projectDir), packed = realpathSync(unpackedRoot)
  function ensureDirectory(path) {
    if (path === packed) return
    ensureDirectory(dirname(path))
    if (existsSync(path)) {
      if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
        throw new Error('[after-pack] Unsafe prune archive directory: ' + path)
    } else { mkdirSync(path); directories.push(path) }
  }
  try {
    for (const name of references) {
      const source = resolve(project, name), destination = resolve(packed, name)
      if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink() ||
          !realpathSync(source).startsWith(project + sep))
        throw new Error('[after-pack] Unsafe prune archive source: ' + name)
      if (existsSync(destination)) throw new Error('[after-pack] Unexpected prepacked archive: ' + name)
      ensureDirectory(dirname(destination))
      files.push(destination)
      copyFileSync(source, destination)
    }
    return prune()
  } finally {
    for (const file of files.reverse()) if (existsSync(file)) unlinkSync(file)
    for (const directory of directories.reverse()) rmdirSync(directory)
  }
}

function forbiddenControlPayload(path) {
  const normalized = path.replaceAll('\\', '/').replace(/^\//, '')
  return /(?:^|\/)control-baselines(?:\/|$)/.test(normalized) ||
    /(?:^|\/)node_modules\/@kun\/control-runtime(?:\/|$)/.test(normalized) ||
    /(?:^|\/)vendor\/.*\.tgz$/.test(normalized)
}

/** Validate the final archive and real on-disk resources, not just config patterns. */
function validateNoBundledControlPayload(resourcesDir) {
  const archive = join(resourcesDir, 'app.asar')
  uncache(archive)
  const problems = listPackage(archive).filter(forbiddenControlPayload).slice(0, 20)
  function inspect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), name = relative(resourcesDir, path)
      if (forbiddenControlPayload(name)) { if (problems.length < 20) problems.push(name); continue }
      if (entry.isDirectory()) inspect(path)
    }
  }
  inspect(resourcesDir)
  if (problems.length) throw new Error('[after-pack] Downloadable control payload or build archives must not ship:\n' + problems.join('\n'))
}

module.exports = { withPackedKunPruneArchives, forbiddenControlPayload, validateNoBundledControlPayload }
