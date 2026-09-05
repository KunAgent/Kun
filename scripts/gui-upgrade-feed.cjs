'use strict'

const { createHash } = require('node:crypto')
const { createReadStream } = require('node:fs')
const { readFile, stat } = require('node:fs/promises')
const { createServer } = require('node:http')
const { basename, join } = require('node:path')
const { parse } = require('yaml')

async function digest(path, algorithm = 'sha512', encoding = 'base64') {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest(encoding)
}

async function validateFeed(directory, name, version) {
  const text = await readFile(join(directory, name), 'utf8')
  const metadata = parse(text)
  if (metadata.version !== version || !Array.isArray(metadata.files) || !metadata.files.length) {
    throw new Error(`${name} does not describe ${version}`)
  }
  for (const file of metadata.files) {
    if (typeof file.url !== 'string' || basename(file.url) !== file.url || /[\\/]/.test(file.url)) {
      throw new Error(`${name} must reference files within the candidate directory`)
    }
    const path = join(directory, file.url)
    if ((await stat(path)).size !== file.size || await digest(path) !== file.sha512) {
      throw new Error(`${name}: size or SHA-512 mismatch for ${file.url}`)
    }
  }
  return { metadata, text }
}

async function startCandidateFeed(directory, name, version) {
  const { metadata, text } = await validateFeed(directory, name, version)
  const allowed = new Set([name, ...metadata.files.flatMap((file) => [file.url, `${file.url}.blockmap`])])
  const server = createServer(async (request, response) => {
    try {
      const member = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1)
      if (!allowed.has(member)) { response.writeHead(404); response.end(); return }
      if (member === name) {
        response.writeHead(200, { 'content-type': 'text/yaml', 'cache-control': 'no-store' })
        response.end(text)
        return
      }
      const path = join(directory, member)
      const { size } = await stat(path)
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
      const start = range ? Number(range[1]) : 0
      const end = range && range[2] ? Number(range[2]) : size - 1
      if (start > end || end >= size) { response.writeHead(416); response.end(); return }
      response.writeHead(range ? 206 : 200, {
        'content-type': 'application/octet-stream', 'accept-ranges': 'bytes',
        'content-length': end - start + 1,
        ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {})
      })
      createReadStream(path, { start, end }).on('error', () => response.destroy()).pipe(response)
    } catch { response.writeHead(404); response.end() }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() })
  }
}

module.exports = { digest, validateFeed, startCandidateFeed }
