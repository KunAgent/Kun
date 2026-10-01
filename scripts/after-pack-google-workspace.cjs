const { createHash } = require('node:crypto')
const { chmodSync, lstatSync, readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { isDeepStrictEqual } = require('node:util')
const { _internals: { validateManifest, executableName } } = require('./prepare-google-workspace.cjs')
const TRUSTED_MANIFEST = require('../resources/google-workspace/manifest.json')
const LEGAL_ROOT = join(__dirname, '..', 'resources', 'google-workspace', 'legal')
const LEGAL_FILES = ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.txt']

function normalizeTarget(context) {
  const platform = { mac: 'darwin', win: 'win32' }[context.electronPlatformName] || context.electronPlatformName
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch] || context.arch
  return { platform, arch }
}

function resourceRoot(context) {
  const { platform } = normalizeTarget(context)
  const resources = platform === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  return join(resources, 'google-workspace')
}

function regularFile(path, label) {
  let details
  try { details = lstatSync(path) } catch { throw new Error(`[after-pack] Missing Google Workspace ${label}`) }
  if (!details.isFile() || details.isSymbolicLink() || details.size <= 0) {
    throw new Error(`[after-pack] Google Workspace ${label} must be a non-empty regular file`)
  }
  return details
}

function readManifest(root, platform, arch, trustedManifest = TRUSTED_MANIFEST) {
  for (const name of ['manifest.json', 'selected.json']) regularFile(join(root, name), name)
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  const selected = JSON.parse(readFileSync(join(root, 'selected.json'), 'utf8'))
  if (!isDeepStrictEqual(manifest, trustedManifest)) {
    throw new Error('[after-pack] Google Workspace manifest differs from the pinned build manifest')
  }
  const asset = validateManifest(manifest, platform, arch)
  if (selected.schemaVersion !== 1 || selected.version !== manifest.version ||
      selected.releaseTag !== manifest.releaseTag || selected.platform !== platform ||
      selected.arch !== arch || selected.asset !== asset.name ||
      selected.archiveSha256 !== asset.archiveSha256 || selected.size !== asset.size ||
      selected.sha256 !== asset.sha256) {
    throw new Error('[after-pack] Google Workspace selected target does not match pinned manifest')
  }
  return { asset, selected }
}

function binaryDigest(path) {
  regularFile(path, 'executable')
  const bytes = readFileSync(path)
  return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

function validateBundledGoogleWorkspace(context, trustedManifest = TRUSTED_MANIFEST) {
  const { platform, arch } = normalizeTarget(context)
  const root = resourceRoot(context)
  const { asset, selected } = readManifest(root, platform, arch, trustedManifest)
  // Reject pre-existing attestations: they are created only after this check.
  if (selected.packagedSha256 !== undefined || selected.packagedSize !== undefined) {
    throw new Error('[after-pack] Google Workspace contains a premature signing attestation')
  }
  const name = executableName(platform)
  const path = join(root, name)
  const actual = binaryDigest(path)
  if (actual.sha256 !== asset.sha256 || actual.size !== asset.size) {
    throw new Error('[after-pack] Google Workspace executable SHA-256 or size mismatch')
  }
  const binaries = readdirSync(root).filter((entry) => ['gws', 'gws.exe'].includes(entry))
  if (binaries.length !== 1 || binaries[0] !== name) {
    throw new Error('[after-pack] Expected exactly one target Google Workspace executable')
  }
  for (const name of LEGAL_FILES) {
    regularFile(join(root, 'legal', name), name)
    if (!readFileSync(join(root, 'legal', name)).equals(readFileSync(join(LEGAL_ROOT, name)))) {
      throw new Error(`[after-pack] Google Workspace legal file differs from source: ${name}`)
    }
  }
  if (platform !== 'win32' && process.platform !== 'win32') chmodSync(path, 0o755)
}

// Called after executable signing but BEFORE the outer app's signature seals
// selected.json. Both original provenance and the actual shipped bytes remain
// available to the runtime verifier; signing never silently bypasses hashing.
function attestPackagedGoogleWorkspace(root, platform, arch, trustedManifest = TRUSTED_MANIFEST) {
  const { selected } = readManifest(root, platform, arch, trustedManifest)
  const actual = binaryDigest(join(root, executableName(platform)))
  const attested = { ...selected, packagedSize: actual.size, packagedSha256: actual.sha256 }
  writeFileSync(join(root, 'selected.json'), `${JSON.stringify(attested, null, 2)}\n`, { mode: 0o644 })
  return attested
}

async function signWindowsGoogleWorkspace(context) {
  const { platform, arch } = normalizeTarget(context)
  if (platform !== 'win32') return false
  const signIf = context.packager?.signIf
  if (typeof signIf !== 'function') {
    throw new Error('[after-pack] Windows packager cannot sign the bundled Google Workspace CLI')
  }
  const root = resourceRoot(context)
  const signed = await signIf.call(context.packager, join(root, 'gws.exe'))
  attestPackagedGoogleWorkspace(root, platform, arch)
  console.log(`[after-pack] Google Workspace executable ${signed ? 'signed' : 'unsigned'}; packaged digest recorded.`)
  return signed
}

exports.validateBundledGoogleWorkspace = validateBundledGoogleWorkspace
exports.signWindowsGoogleWorkspace = signWindowsGoogleWorkspace
exports.attestPackagedGoogleWorkspace = attestPackagedGoogleWorkspace
exports._internals = { normalizeTarget, resourceRoot, binaryDigest, readManifest, LEGAL_FILES }
