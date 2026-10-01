// Build-time only. Never called by the app or used as a runtime installer.
const { createHash, randomUUID } = require('node:crypto')
const { chmod, lstat, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const { join, posix } = require('node:path')
const { gunzipSync } = require('node:zlib')

const RESOURCE_ROOT = join(__dirname, '..', 'resources', 'google-workspace')
const MANIFEST_PATH = join(RESOURCE_ROOT, 'manifest.json')
const CURRENT_ROOT = join(RESOURCE_ROOT, 'current')
const VERSION = '0.22.5'
const RELEASE_BASE = `https://github.com/googleworkspace/cli/releases/download/v${VERSION}/`
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
const MAX_EXPANDED_BYTES = 128 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 128
const TARGETS = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-x64': 'x86_64-pc-windows-msvc'
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function executableName(platform) {
  return platform === 'win32' ? 'gws.exe' : 'gws'
}

function parseArgs(argv) {
  const result = { platform: process.platform, arch: process.arch }
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    if (!['--platform', '--arch'].includes(flag) || !argv[index + 1]) {
      throw new Error(`Invalid Google Workspace prepare argument: ${flag}`)
    }
    result[flag.slice(2)] = argv[index + 1]
  }
  if (result.platform === 'mac') result.platform = 'darwin'
  if (result.platform === 'win') result.platform = 'win32'
  return result
}

function validateManifest(manifest, platform, arch) {
  const key = `${platform}-${arch}`
  const target = TARGETS[key]
  const asset = manifest?.assets?.[key]
  if (!target || !asset) throw new Error(`Google Workspace CLI does not support build target ${key}`)
  const archiveType = platform === 'win32' ? 'zip' : 'tar.gz'
  const name = `google-workspace-cli-${target}.${archiveType}`
  if (manifest.schemaVersion !== 1 || manifest.version !== VERSION ||
      manifest.releaseTag !== `v${VERSION}` || manifest.license !== 'Apache-2.0' ||
      asset.name !== name || asset.url !== RELEASE_BASE + name ||
      asset.archiveType !== archiveType ||
      asset.executablePath !== (platform === 'win32' ? 'gws.exe' : './gws') ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) || !/^[a-f0-9]{64}$/.test(asset.archiveSha256) ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_EXPANDED_BYTES ||
      !Number.isSafeInteger(asset.archiveSize) || asset.archiveSize <= 0 ||
      asset.archiveSize > MAX_ARCHIVE_BYTES) {
    throw new Error(`Invalid pinned Google Workspace CLI manifest for ${key}`)
  }
  return asset
}

function archivePath(name) {
  if (typeof name !== 'string' || !name || /[\\\0:]/.test(name) ||
      name.startsWith('/') || name.split('/').includes('..')) {
    throw new Error(`Unsafe Google Workspace archive path: ${name}`)
  }
  const normalized = posix.normalize(name).replace(/\/$/, '')
  if (normalized.startsWith('../')) throw new Error('Archive traversal is forbidden')
  return normalized
}

async function collectStream(stream, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > limit) throw new Error('Google Workspace archive entry exceeds size limit')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function extractTar(bytes, asset) {
  const tar = require('tar-stream')
  // Bound decompression before parsing. Only the executable is retained and no
  // archive pathname is ever passed to the filesystem.
  const expanded = gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED_BYTES })
  return new Promise((resolve, reject) => {
    const extract = tar.extract()
    let binary
    let count = 0
    extract.on('error', reject)
    extract.on('entry', (header, stream, next) => {
      const processEntry = async () => {
        if (++count > MAX_ARCHIVE_ENTRIES) throw new Error('Too many Google Workspace archive entries')
        const name = archivePath(header.name)
        if (!['file', 'directory'].includes(header.type)) {
          throw new Error('Google Workspace archive links and special files are forbidden')
        }
        if (name === archivePath(asset.executablePath)) {
          if (binary || header.type !== 'file' || header.size !== asset.size) {
            throw new Error('Invalid or duplicate Google Workspace archive executable')
          }
          binary = await collectStream(stream, asset.size)
        } else {
          for await (const _chunk of stream) { /* Drain without writing files. */ }
        }
      }
      processEntry().then(next, (error) => extract.destroy(error))
    })
    extract.on('finish', () => {
      if (!binary) reject(new Error('Google Workspace archive executable is missing'))
      else resolve(binary)
    })
    extract.end(expanded)
  })
}

function extractZip(bytes, asset) {
  const yauzl = require('yauzl')
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(error)
      let binary
      let count = 0
      let expandedSize = 0
      function fail(error) { zip.close(); reject(error) }
      zip.on('error', fail)
      zip.on('entry', (entry) => {
        const processEntry = async () => {
          if (++count > MAX_ARCHIVE_ENTRIES) throw new Error('Too many Google Workspace archive entries')
          const name = archivePath(entry.fileName)
          const fileType = (entry.externalFileAttributes >>> 16) & 0o170000
          if ((entry.generalPurposeBitFlag & 1) ||
              ![0, 0o100000, 0o040000].includes(fileType)) {
            throw new Error('Google Workspace encrypted entries, links and special files are forbidden')
          }
          expandedSize += entry.uncompressedSize
          if (expandedSize > MAX_EXPANDED_BYTES) throw new Error('Google Workspace zip exceeds size limit')
          if (name === archivePath(asset.executablePath)) {
            if (binary || entry.fileName.endsWith('/') || fileType === 0o040000 ||
                entry.uncompressedSize !== asset.size) {
              throw new Error('Invalid or duplicate Google Workspace archive executable')
            }
            const stream = await new Promise((resolveStream, rejectStream) => {
              zip.openReadStream(entry, (error, stream) => error ? rejectStream(error) : resolveStream(stream))
            })
            binary = await collectStream(stream, asset.size)
          }
        }
        processEntry().then(() => zip.readEntry(), fail)
      })
      zip.on('end', () => {
        if (!binary) reject(new Error('Google Workspace archive executable is missing'))
        else resolve(binary)
      })
      zip.readEntry()
    })
  })
}

async function extractExecutable(bytes, asset) {
  if (bytes.length !== asset.archiveSize || digest(bytes) !== asset.archiveSha256) {
    throw new Error('Google Workspace archive SHA-256 or size mismatch')
  }
  let binary
  if (asset.archiveType === 'tar.gz') binary = await extractTar(bytes, asset)
  else if (asset.archiveType === 'zip') binary = await extractZip(bytes, asset)
  else throw new Error('Unsupported Google Workspace archive format')
  if (binary.length !== asset.size || digest(binary) !== asset.sha256) {
    throw new Error('Google Workspace executable SHA-256 or size mismatch')
  }
  return binary
}

async function fileMatches(path, asset) {
  try {
    const details = await lstat(path)
    return details.isFile() && !details.isSymbolicLink() && details.size === asset.size &&
      digest(await readFile(path)) === asset.sha256
  } catch { return false }
}

async function downloadAsset(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(180_000),
    headers: { 'user-agent': 'Kun-Google-Workspace-Packager/1' }
  })
  if (!response.ok) throw new Error(`Google Workspace download failed with HTTP ${response.status}`)
  if (Number(response.headers.get('content-length')) > MAX_ARCHIVE_BYTES) {
    throw new Error('Google Workspace download exceeds size limit')
  }
  if (!response.body) throw new Error('Google Workspace download has no body')
  return collectStream(response.body, MAX_ARCHIVE_BYTES)
}

async function writeAtomic(path, bytes, mode) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, bytes, { mode, flag: 'wx' })
    await rename(temporaryPath, path)
  } finally { await rm(temporaryPath, { force: true }) }
}

async function prepareGoogleWorkspace({ platform, arch }, options = {}) {
  const manifest = options.manifest || JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
  const asset = validateManifest(manifest, platform, arch)
  const currentRoot = options.currentRoot || CURRENT_ROOT
  await mkdir(currentRoot, { recursive: true, mode: 0o755 })
  if (!(await lstat(currentRoot)).isDirectory()) throw new Error('Google Workspace output must be a real directory')
  const selectedPath = join(currentRoot, 'selected.json')
  // A failed preparation must not leave a usable stale target selection.
  await rm(selectedPath, { force: true })
  const outputPath = join(currentRoot, executableName(platform))
  await rm(join(currentRoot, platform === 'win32' ? 'gws' : 'gws.exe'), { force: true })
  if (!await fileMatches(outputPath, asset)) {
    const bytes = await (options.download || downloadAsset)(asset.url)
    const binary = await extractExecutable(bytes, asset)
    await writeAtomic(outputPath, binary, 0o755)
  }
  if (platform !== 'win32') await chmod(outputPath, 0o755)
  const selected = {
    schemaVersion: 1,
    version: manifest.version,
    releaseTag: manifest.releaseTag,
    platform,
    arch,
    asset: asset.name,
    archiveSha256: asset.archiveSha256,
    size: asset.size,
    sha256: asset.sha256
  }
  await writeAtomic(selectedPath, `${JSON.stringify(selected, null, 2)}\n`, 0o644)
  console.log(`[google-workspace] prepared ${manifest.version} for ${platform}-${arch} (${asset.size} bytes)`)
  return selected
}

if (require.main === module) {
  Promise.resolve().then(() => prepareGoogleWorkspace(parseArgs(process.argv.slice(2)))).catch((error) => {
    console.error(`[google-workspace] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}

exports._internals = {
  VERSION, TARGETS, digest, executableName, parseArgs, validateManifest,
  archivePath, extractExecutable, fileMatches, prepareGoogleWorkspace
}
