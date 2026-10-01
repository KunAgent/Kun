const assert = require('node:assert/strict')
const test = require('node:test')
const { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { gzipSync } = require('node:zlib')
const tar = require('tar-stream')
const { _internals: {
  TARGETS, digest, parseArgs, validateManifest, archivePath, extractExecutable,
  fileMatches, prepareGoogleWorkspace
} } = require('./prepare-google-workspace.cjs')
const pinned = require('../resources/google-workspace/manifest.json')
const BINARY = Buffer.from('fixture Google Workspace executable')

async function tarArchive(entries = [{ name: './gws', data: BINARY }]) {
  const pack = tar.pack()
  const chunks = []
  const done = new Promise((resolve, reject) => {
    pack.on('data', (chunk) => chunks.push(chunk))
    pack.on('end', () => resolve(gzipSync(Buffer.concat(chunks))))
    pack.on('error', reject)
  })
  for (const entry of entries) {
    pack.entry({ name: entry.name, type: entry.type || 'file', linkname: entry.linkname }, entry.data || Buffer.alloc(0))
  }
  pack.finalize()
  return done
}

async function zipArchive(entries = [{ name: 'gws.exe', data: BINARY }]) {
  const JSZip = require('jszip')
  const zip = new JSZip()
  for (const entry of entries) {
    zip.file(entry.name, entry.data || BINARY, { unixPermissions: entry.permissions || 0o100755 })
  }
  return zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
}

function assetFor(archive, key = 'linux-x64') {
  return { ...pinned.assets[key], archiveSize: archive.length, archiveSha256: digest(archive),
    size: BINARY.length, sha256: digest(BINARY) }
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'kun-gws-prepare-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('manifest pins exactly five official v0.22.5 targets with archive and binary hashes', () => {
  assert.deepEqual(Object.keys(pinned.assets).sort(), Object.keys(TARGETS).sort())
  assert.equal(pinned.sourceCommit, '705fb0ecac6f4249679958f6325b809b63fdde17')
  for (const key of Object.keys(TARGETS)) {
    const [platform, arch] = key.split('-')
    assert.equal(validateManifest(pinned, platform, arch), pinned.assets[key])
  }
  assert.throws(() => validateManifest(pinned, 'win32', 'arm64'), /does not support/)
  assert.throws(() => validateManifest({ ...pinned, version: 'latest' }, 'linux', 'x64'), /Invalid pinned/)
  const tampered = structuredClone(pinned)
  tampered.assets['linux-x64'].url = 'https://example.com/gws'
  assert.throws(() => validateManifest(tampered, 'linux', 'x64'), /Invalid pinned/)
})

test('target arguments fail closed instead of silently accepting typos', () => {
  assert.deepEqual(parseArgs(['--platform', 'mac', '--arch', 'arm64']), { platform: 'darwin', arch: 'arm64' })
  assert.equal(parseArgs(['--platform', 'win']).platform, 'win32')
  assert.throws(() => parseArgs(['--arch']), /Invalid/)
  assert.throws(() => parseArgs(['--latest', 'true']), /Invalid/)
})

test('archive paths reject traversal, absolute paths and platform-specific ambiguity', () => {
  for (const path of ['../gws', './x/../../gws', '/gws', 'C:/gws', 'x\\gws', 'x\0gws']) {
    assert.throws(() => archivePath(path), /Unsafe|traversal/)
  }
  assert.equal(archivePath('./gws'), 'gws')
})

test('tar and zip select only a checksum-verified regular executable', async () => {
  for (const key of ['linux-x64', 'win32-x64']) {
    const archive = key === 'linux-x64' ? await tarArchive() : await zipArchive()
    assert.deepEqual(await extractExecutable(archive, assetFor(archive, key)), BINARY)
    const asset = assetFor(archive, key)
    await assert.rejects(extractExecutable(archive, { ...asset, archiveSha256: 'a'.repeat(64) }), /archive SHA-256/)
    await assert.rejects(extractExecutable(archive, { ...asset, sha256: 'a'.repeat(64) }), /executable SHA-256/)
    await assert.rejects(extractExecutable(archive, { ...asset, size: BINARY.length + 1 }), /Invalid or duplicate/)
  }
})

test('tar rejects links, duplicate executables, traversal and missing executables', async () => {
  for (const entries of [
    [{ name: './gws', type: 'symlink', linkname: '/bin/sh' }],
    [{ name: './gws', type: 'link', linkname: 'other' }],
    [{ name: './gws', data: BINARY }, { name: 'gws', data: BINARY }],
    [{ name: '../gws', data: BINARY }],
    [{ name: 'README.md', data: BINARY }]
  ]) {
    const archive = await tarArchive(entries)
    await assert.rejects(extractExecutable(archive, assetFor(archive)), /forbidden|duplicate|Unsafe|missing/)
  }
})

test('zip rejects symlinks and traversal without creating any files', async () => {
  const linked = await zipArchive([{ name: 'gws.exe', permissions: 0o120777 }])
  await assert.rejects(extractExecutable(linked, assetFor(linked, 'win32-x64')), /forbidden/)
  const traversal = await zipArchive([{ name: '../gws.exe' }])
  await assert.rejects(extractExecutable(traversal, assetFor(traversal, 'win32-x64')), /invalid relative path|Unsafe/)
  const missing = await zipArchive([{ name: 'README.md' }])
  await assert.rejects(extractExecutable(missing, assetFor(missing, 'win32-x64')), /missing/)
})

test('preparation atomically materializes a pinned target and reuses only verified cache', async (t) => {
  const root = fixture(t)
  const archive = await tarArchive()
  const manifest = structuredClone(pinned)
  manifest.assets['linux-x64'] = assetFor(archive)
  let downloads = 0
  const options = { manifest, currentRoot: root, download: async () => { downloads += 1; return archive } }
  writeFileSync(join(root, 'gws.exe'), 'stale other platform')
  const selected = await prepareGoogleWorkspace({ platform: 'linux', arch: 'x64' }, options)
  assert.equal(downloads, 1)
  assert.equal(existsSync(join(root, 'gws.exe')), false)
  assert.equal(selected.sha256, digest(BINARY))
  assert.equal(selected.archiveSha256, digest(archive))
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'selected.json'))), selected)
  await prepareGoogleWorkspace({ platform: 'linux', arch: 'x64' }, options)
  assert.equal(downloads, 1)
  writeFileSync(join(root, 'gws'), 'corrupted')
  await prepareGoogleWorkspace({ platform: 'linux', arch: 'x64' }, options)
  assert.equal(downloads, 2)
})

test('failed prepare invalidates stale selection and rejects symlink caches', async (t) => {
  const root = fixture(t)
  const archive = await tarArchive()
  const asset = assetFor(archive)
  const manifest = { ...pinned, assets: { ...pinned.assets, 'linux-x64': asset } }
  writeFileSync(join(root, 'selected.json'), '{}')
  writeFileSync(join(root, 'external'), BINARY)
  symlinkSync(join(root, 'external'), join(root, 'gws'))
  assert.equal(await fileMatches(join(root, 'gws'), asset), false)
  await assert.rejects(prepareGoogleWorkspace({ platform: 'linux', arch: 'x64' }, {
    manifest, currentRoot: root, download: async () => Buffer.from('invalid')
  }), /archive SHA-256/)
  assert.equal(existsSync(join(root, 'selected.json')), false)
  assert.deepEqual(readFileSync(join(root, 'external')), BINARY)
})
