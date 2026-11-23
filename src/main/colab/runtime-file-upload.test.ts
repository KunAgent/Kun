import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UPLOAD_CHUNK_BYTES as chunkSize, uploadRuntimeFiles } from './runtime-file-upload'

const access = async () => ({ baseUrl: 'https://runtime.example/base', headers: { Authorization: 'token fixture' } })
const name = '模型 100% #1.gguf'
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'kun-upload-test-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

async function localFile(remotePath: string, bytes: Buffer) {
  const localPath = join(root, remotePath.split('/').pop()!)
  await writeFile(localPath, bytes)
  return { localPath, remotePath }
}

function contents(options: { ignoreChunk?: boolean; noSize?: boolean; failChunk?: number } = {}) {
  const files = new Map<string, Buffer>()
  const dirs = new Set<string>()
  const puts: { bytes: number; chunk?: number }[] = []
  const calls: { url: URL; method: string; path: string }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    expect(url.pathname).toMatch(/^\/base\/api\/contents\//)
    expect(init?.redirect).toBe('manual')
    const path = url.pathname.split('/').slice(4).map(decodeURIComponent).join('/')
    const method = init?.method ?? 'GET'
    calls.push({ url, method, path })
    const body = JSON.parse(String(init?.body ?? '{}'))
    let target = path
    if (method === 'GET') {
      expect(url.searchParams.get('content')).toBe('0')
      if (!files.has(path) && !dirs.has(path)) return new Response(null, { status: 404 })
    } else if (method === 'PUT') {
      if (body.type === 'directory') dirs.add(path)
      else {
        const bytes = Buffer.from(body.content, 'base64')
        puts.push({ bytes: bytes.length, chunk: body.chunk })
        if (options.failChunk !== undefined && options.failChunk === body.chunk) {
          return new Response('private server diagnostics', { status: 507 })
        }
        const prev = !options.ignoreChunk && body.chunk && body.chunk !== 1 ? files.get(path) : undefined
        files.set(path, prev ? Buffer.concat([prev, bytes]) : bytes)
      }
    } else if (method === 'PATCH') {
      target = body.path
      if (files.has(target)) return new Response(null, { status: 409 })
      files.set(target, files.get(path)!)
      files.delete(path)
    } else if (method === 'DELETE') {
      files.delete(path)
      return new Response(null, { status: 204 })
    }
    return Response.json({ path: target, type: dirs.has(target) ? 'directory' : 'file',
      size: options.noSize ? undefined : files.get(target)?.length })
  }
  return { files, puts, calls, fetchImpl }
}

describe('runtime file uploads', () => {
  it('uses bounded sequential requests, confirms bytes before rename, and preserves the exact binary', async () => {
    const server = contents()
    const data = randomBytes(chunkSize * 2 + 17)
    const file = await localFile(`content/models/${name}`, data)
    const onProgress = vi.fn()
    const result = await uploadRuntimeFiles([file], access, { onProgress }, server.fetchImpl)
    expect(result).toEqual({ ok: true, uploadedCount: 1 })
    expect(server.puts).toEqual([{ bytes: chunkSize, chunk: 1 }, { bytes: chunkSize, chunk: 2 }, { bytes: 17, chunk: -1 }])
    expect(server.calls.slice(-2).map((c) => c.method)).toEqual(['GET', 'PATCH'])
    expect(onProgress.mock.calls.map(([p]) => p.transferredBytes)).toEqual([0, chunkSize, 2 * chunkSize, data.length])
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
    expect(hash(server.files.get(file.remotePath)!)).toBe(hash(data))
    expect([...server.files.keys()]).toEqual([file.remotePath])
  })

  it('keeps small, empty and single-chunk files compatible with ordinary PUTs', async () => {
    const server = contents()
    const empty = await localFile('empty', Buffer.alloc(0))
    const notebook = await localFile('copy.ipynb', Buffer.from('{"cells":[]}'))
    const exact = await localFile('exact.bin', Buffer.alloc(chunkSize))
    expect(await uploadRuntimeFiles([empty, notebook, exact], access, {}, server.fetchImpl)).toEqual({ ok: true, uploadedCount: 3 })
    expect(server.puts.map((p) => p.chunk)).toEqual([undefined, undefined, undefined])
    expect(server.files.get(notebook.remotePath)?.toString()).toBe('{"cells":[]}')
  })

  it.each([{ ignoreChunk: true }, { noSize: true }])('never publishes an unverifiable multipart upload (%o)', async (options) => {
    const server = contents(options)
    const file = await localFile(name, Buffer.alloc(chunkSize + 1))
    expect(await uploadRuntimeFiles([file], access, {}, server.fetchImpl)).toMatchObject({ ok: false, uploadedCount: 0 })
    expect(server.calls.map((c) => c.method)).not.toContain('PATCH')
    expect(server.files.size).toBe(0)
  })

  it('stops at the failed chunk, reports partial batch success, and does not expose remote diagnostics', async () => {
    const server = contents({ failChunk: -1 })
    const small = await localFile('config.json', Buffer.from('{}'))
    const file = await localFile(name, Buffer.alloc(chunkSize + 10))
    expect(await uploadRuntimeFiles([small, file], access, {}, server.fetchImpl)).toEqual({
      ok: false, uploadedCount: 1, message: `${name}: Runtime file request failed (HTTP 507).`
    })
    expect([...server.files.keys()]).toEqual(['config.json'])
    expect(server.puts).toHaveLength(3)
  })

  it('cancels after an acknowledged chunk without publishing, and cleans up only its own staging file', async () => {
    const server = contents()
    server.files.set('keep.part', Buffer.from('keep'))
    const controller = new AbortController()
    const file = await localFile(name, Buffer.alloc(chunkSize * 2))
    expect(await uploadRuntimeFiles([file], access, {
      signal: controller.signal, onProgress: ({ transferredBytes }) => { if (transferredBytes) controller.abort() }
    }, server.fetchImpl)).toEqual({ ok: false, canceled: true, uploadedCount: 0 })
    expect(server.puts).toHaveLength(1)
    expect([...server.files.keys()]).toEqual(['keep.part'])
  })

  it('does not replace existing models; a missing local file fails the batch', async () => {
    const server = contents()
    server.files.set(name, Buffer.from('original'))
    const file = await localFile(name, Buffer.alloc(chunkSize + 1))
    expect(await uploadRuntimeFiles([file], access, {}, server.fetchImpl)).toMatchObject({ ok: false, uploadedCount: 0 })
    expect(server.puts).toHaveLength(0)
    expect(server.files.get(name)?.toString()).toBe('original')
    expect(await uploadRuntimeFiles([{ ...file, localPath: join(root, 'missing') }], access, {}, server.fetchImpl)).toMatchObject({ ok: false })
  })

  it('uses the Colab runtime-proxy query and does not follow redirects or return credential-bearing URLs', async () => {
    const file = await localFile('content/model.bin', Buffer.alloc(3))
    const params = async () => ({ baseUrl: 'https://example.test', proxyToken: 'fixture-secret' })
    const mock: typeof fetch = async (input, init) => {
      const url = new URL(String(input))
      expect(url.searchParams.get('colab-runtime-proxy-token')).toBe('fixture-secret')
      expect(url.searchParams.get('authuser')).toBe('0')
      expect(init?.redirect).toBe('manual')
      return new Response(null, { status: 302, headers: { Location: 'https://other.test' } })
    }
    expect(await uploadRuntimeFiles([file], params, {}, mock)).toEqual({
      ok: false, uploadedCount: 0, message: 'model.bin: Runtime file request failed (HTTP 302).'
    })
  })
})
