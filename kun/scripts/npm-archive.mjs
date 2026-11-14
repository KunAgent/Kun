import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, chmod, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import tar from 'tar-stream'

export function verifyArchive(bytes, integrity) {
  const [algorithm, expected] = integrity.split(/-(.*)/s)
  assert(['sha256', 'sha512'].includes(algorithm) && expected, 'Archive requires a pinned SHA-256 or SHA-512')
  const actual = createHash(algorithm).update(bytes).digest(algorithm === 'sha256' ? 'hex' : 'base64')
  assert.equal(actual, expected, 'Archive integrity mismatch')
}

export async function downloadArchive(url, integrity, cache) {
  assert(url.startsWith('https://'), 'Dependency archives must use HTTPS')
  const mirror = process.env.KUN_NPM_ARCHIVE_REGISTRY
  if (mirror && url.startsWith('https://registry.npmjs.org/')) {
    const base = new URL(mirror)
    assert(base.protocol === 'https:' && !base.username && !base.password && base.pathname === '/',
      'KUN_NPM_ARCHIVE_REGISTRY must be an HTTPS registry origin without credentials')
    url = base.origin + url.slice('https://registry.npmjs.org'.length)
  }
  await mkdir(cache, { recursive: true })
  const path = join(cache, `${createHash('sha256').update(integrity).digest('hex')}.tgz`)
  try {
    const bytes = await readFile(path)
    verifyArchive(bytes, integrity)
    return bytes
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  // Reuse only the original content-addressed npm tarball, never an installed
  // (possibly Electron-rebuilt) module tree. Integrity is checked again here.
  if (integrity.startsWith('sha512-')) {
    const hex = Buffer.from(integrity.slice(7), 'base64').toString('hex')
    for (const npmCache of new Set([process.env.npm_config_cache, join(homedir(), '.npm')].filter(Boolean))) {
      try {
        const bytes = await readFile(join(npmCache, '_cacache/content-v2/sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4)))
        verifyArchive(bytes, integrity)
        await writeFile(path, bytes)
        return bytes
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      process.stderr.write(`[kun-npm] Downloading ${new URL(url).pathname.split('/').at(-1)}\n`)
      const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
      assert(response.ok, `Archive download failed: HTTP ${response.status} ${url}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      verifyArchive(bytes, integrity)
      const temporary = `${path}.${process.pid}.tmp`
      await writeFile(temporary, bytes)
      await rename(temporary, path)
      return bytes
    } catch (error) { lastError = error }
  }
  throw lastError
}

export async function extractArchive(bytes, directory) {
  const root = resolve(directory)
  const extract = tar.extract()
  await mkdir(root, { recursive: true })
  const names = new Set()
  extract.on('entry', (header, stream, next) => {
    const write = async () => {
      const parts = header.name.replace(/\/$/, '').split('/')
      assert(!parts.some(p => p === '..' || p.includes('\\') || p.includes(':')) && !header.name.startsWith('/'),
        `Unsafe archive entry: ${header.name}`)
      // npm tarballs and prebuild archives both have one containing directory.
      const name = parts.slice(1).join('/')
      if (!name) { stream.resume(); return }
      const path = resolve(root, name)
      assert(path.startsWith(root + sep), `Archive escapes package: ${header.name}`)
      assert(!names.has(name), `Duplicate archive entry: ${header.name}`)
      names.add(name)
      assert(header.type === 'file' || header.type === 'directory', `Unsupported archive entry type: ${header.name}`)
      if (header.type === 'directory') { await mkdir(path, { recursive: true }); stream.resume(); return }
      await mkdir(dirname(path), { recursive: true })
      assert(header.size <= 512 * 1024 * 1024, `Archive entry is too large: ${header.name}`)
      await pipeline(stream, createWriteStream(path, { flags: 'wx', mode: header.mode & 0o777 }))
      await chmod(path, header.mode & 0o777)
    }
    write().then(() => next(), error => extract.destroy(error))
  })
  try { await pipeline(Readable.from(bytes), createGunzip(), extract) }
  catch (error) { await rm(root, { recursive: true, force: true }); throw error }
}
