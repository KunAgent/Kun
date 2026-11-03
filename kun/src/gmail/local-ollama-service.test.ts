import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { ManagedLocalGmailOllama, KUN_GMAIL_OLLAMA_BINARY, type LocalOllamaDependencies } from './local-ollama-service.js'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
async function fixture(options: { model?: boolean; remote?: boolean; noCloud?: boolean; owned?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'kun-gmail-local-model-'))
  const child = Object.assign(new EventEmitter(), {
    pid: 24_681, stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null as number | null, signalCode: null, killed: false
  }) as unknown as ChildProcess
  let model = options.model ?? false
  let owned = options.owned ?? true
  let clock = 0
  let resolvePull!: (value: Response) => void
  const pull = new Promise<Response>((resolve) => { resolvePull = resolve })
  const calls: { path: string; body?: unknown; origin: string }[] = []
  const children = [child]
  let launches = 0
  const spawn = vi.fn<LocalOllamaDependencies['spawn']>(async () => {
    const index = launches++
    const next = index === 0 ? child : Object.assign(new EventEmitter(), {
      pid: 24_681 + index, stdout: new PassThrough(), stderr: new PassThrough(),
      exitCode: null, signalCode: null, killed: false
    }) as unknown as ChildProcess
    if (index > 0) children.push(next)
    setImmediate(() => { if (options.noCloud !== false) next.stderr?.emit('data', Buffer.from('Ollama cloud disabled: true\n')) })
    return next
  })
  const stop = vi.fn<LocalOllamaDependencies['stop']>(async (target) => { Object.assign(target, { exitCode: 0, killed: true }); target.emit('exit', 0) })
  const assertEncrypted = vi.fn(async () => undefined)
  const assertPortOwner = vi.fn(async () => { if (!owned) throw new Error('Foreign listener') })
  let nextPort = 43_123
  const dependencies: Partial<LocalOllamaDependencies> = {
    platform: 'darwin', installed: async () => true, assertEncrypted, reservePort: async () => nextPort++,
    spawn, stop, isOwned: () => owned, assertPortOwner, now: () => (clock += 100),
    pause: async () => { await new Promise((resolve) => setImmediate(resolve)) },
    directFetch: (_origin, assertLive) => async (input, init) => {
      assertLive()
      const request = new Request(input, init)
      const path = new URL(request.url).pathname
      const body = request.method === 'POST' ? await request.json() : undefined
      calls.push({ path, body, origin: new URL(request.url).origin })
      if (path === '/api/version') return json({ version: '0.32.1' })
      if (path === '/api/show') return model ? json({ model_info: { 'general.architecture': 'qwen3' },
        modelfile: `FROM ${join(directory, 'gmail-model-cache', 'blobs', 'sha256-' + 'a'.repeat(64))}\nPARAMETER num_ctx 32768`,
        ...(options.remote ? { remote_model: 'qwen3:4b', remote_host: 'https://ollama.com' } : {}) }) : json({ error: 'not found' }, 404)
      if (path === '/api/pull') { const result = await pull; model = true; return result }
      return json({ choices: [] })
    }
  }
  const start = () => ManagedLocalGmailOllama.start(join(directory, 'records'), dependencies)
  return { directory, child, children, dependencies, spawn, stop, assertEncrypted, assertPortOwner, calls, start,
    completePull: () => resolvePull(json({ status: 'success' })), removeOwnership: () => { owned = false },
    cleanup: async (service?: ManagedLocalGmailOllama) => {
      resolvePull(json({ status: 'success' }))
      await service?.dispose()
      await rm(directory, { recursive: true, force: true })
    } }
}

describe('app-owned cloud-disabled Gmail model', () => {
  it('isolates an existing proxy in an asset-only sibling and destroys it before inference becomes ready', async () => {
    const f = await fixture()
    f.dependencies.downloadProxy = async () => 'http://127.0.0.1:10808'
    const service = await f.start()
    try {
      service?.prepare()
      await vi.waitFor(() => expect(f.calls.filter((call) => call.path === '/api/pull')).toHaveLength(1))
      expect(f.spawn).toHaveBeenCalledTimes(2)
      expect(f.spawn.mock.calls[0][2]?.env).not.toHaveProperty('HTTPS_PROXY')
      expect(f.spawn.mock.calls[1][2]?.env).toMatchObject({ HTTPS_PROXY: 'http://127.0.0.1:10808/',
        NO_PROXY: '127.0.0.1,localhost', OLLAMA_NO_CLOUD: '1', OLLAMA_DEBUG: '0', OLLAMA_DEBUG_LOG_REQUESTS: '0' })
      expect(f.calls.find((call) => call.path === '/api/pull')?.origin).toBe('http://127.0.0.1:43124')
      const sibling = (service as unknown as { downloader: ManagedLocalGmailOllama }).downloader
      expect(() => sibling.proof()).toThrow('cannot provide')
      expect(() => service?.proof().assertCurrent()).toThrow()
      f.completePull()
      await vi.waitFor(() => expect(service?.status()).toMatchObject({ ready: true, preparing: false }))
      expect(f.children[1].killed).toBe(true)
      expect(f.child.killed).toBe(false)
      expect(service?.proof().origin).toBe('http://127.0.0.1:43123')
      expect(f.calls.every((call) => ['/api/version', '/api/show', '/api/pull'].includes(call.path))).toBe(true)
    } finally { await f.cleanup(service) }
  })

  it('cleans up the downloader when its asset metadata fails validation and rejects invalid proxy protocols', async () => {
    const f = await fixture({ remote: true })
    f.dependencies.downloadProxy = async () => 'https://test-user:fake-secret@proxy.example.com:8443'
    const service = await f.start()
    try {
      service?.prepare()
      await vi.waitFor(() => expect(f.calls.filter((call) => call.path === '/api/pull')).toHaveLength(1))
      f.completePull()
      await vi.waitFor(() => expect(service?.status()).toMatchObject({ ready: false, preparing: false, error: 'model_download_failed' }))
      expect(f.children[1].killed).toBe(true)
      expect(f.child.killed).toBe(false)
      expect(JSON.stringify(service?.status())).not.toContain('fake-secret')
    } finally { await f.cleanup(service) }
    const invalid = await fixture()
    invalid.dependencies.downloadProxy = async () => 'socks5://127.0.0.1:10808'
    const denied = await invalid.start()
    try {
      denied?.prepare()
      await vi.waitFor(() => expect(denied?.status()).toMatchObject({ preparing: false, error: 'model_download_failed' }))
      expect(invalid.spawn).toHaveBeenCalledTimes(1)
    } finally { await invalid.cleanup(denied) }
  })

  it('aborts and reclaims a private asset downloader when the main service is disposed', async () => {
    const f = await fixture()
    f.dependencies.downloadProxy = async () => 'http://127.0.0.1:10808'
    const service = await f.start()
    try {
      service?.prepare()
      await vi.waitFor(() => expect(f.calls.filter((call) => call.path === '/api/pull')).toHaveLength(1))
      const closing = service!.dispose()
      f.completePull()
      await closing
      expect(f.children.every((process) => process.killed)).toBe(true)
      expect(service?.status()).toMatchObject({ running: false, ready: false, error: 'stopped' })
    } finally { await f.cleanup(service) }
  })

  it('starts a fixed owned binary with isolated cache and no inherited secrets/proxy preferences', async () => {
    const f = await fixture({ model: true })
    const service = await f.start()
    try {
      expect(service?.status()).toMatchObject({ running: true, ready: true, preparing: false, model: 'qwen3:4b' })
      const [binary, args, options] = f.spawn.mock.calls[0]
      expect(binary).toBe(KUN_GMAIL_OLLAMA_BINARY)
      expect(args).toEqual(['serve'])
      expect(options?.env).toMatchObject({ OLLAMA_HOST: 'http://127.0.0.1:43123', OLLAMA_NO_CLOUD: '1',
        OLLAMA_DEBUG: '0', OLLAMA_DEBUG_LOG_REQUESTS: '0', OLLAMA_CREATE_REMOTE: '0', OLLAMA_ORIGINS: '' })
      expect(options?.env?.OLLAMA_MODELS).toBe(join(f.directory, 'gmail-model-cache'))
      expect(options?.env).not.toHaveProperty('HTTPS_PROXY')
      expect(options?.env).not.toHaveProperty('OPENAI_API_KEY')
      expect(f.assertPortOwner).toHaveBeenCalledWith(43123, 24681)
      expect(f.calls.some((call) => call.path === '/api/pull')).toBe(false)
      expect(() => service?.proof().assertCurrent()).not.toThrow()
      await expect(service!.proof().directFetch(`${service!.origin}/api/create`, { method: 'POST', body: '{}' })).rejects.toThrow()
      f.removeOwnership()
      expect(() => service?.proof().assertCurrent()).toThrow()
    } finally { await f.cleanup(service) }
  })

  it('requires explicit preparation and verifies local provenance after the background download', async () => {
    const f = await fixture()
    const service = await f.start()
    try {
      expect(service?.status()).toMatchObject({ running: true, ready: false, error: 'model_unavailable' })
      expect(() => service?.proof().assertCurrent()).toThrow()
      expect(service?.prepare()).toMatchObject({ preparing: true, ready: false })
      service?.prepare()
      await vi.waitFor(() => expect(f.calls.filter((call) => call.path === '/api/pull')).toHaveLength(1))
      expect(f.calls.find((call) => call.path === '/api/pull')?.body).toEqual({ model: 'qwen3:4b', stream: false })
      f.completePull()
      await vi.waitFor(() => expect(service?.status()).toMatchObject({ ready: true, preparing: false }))
      expect(() => service?.proof().assertCurrent()).not.toThrow()
      await service?.dispose()
      expect(() => service?.proof().assertCurrent()).toThrow()
    } finally { await f.cleanup(service) }
  })

  it('rejects remote model metadata even at the trusted owned origin', async () => {
    const f = await fixture({ model: true, remote: true })
    const service = await f.start()
    try {
      expect(service?.status().ready).toBe(false)
      expect(() => service?.proof().assertCurrent()).toThrow()
      service?.prepare()
      f.completePull()
      await vi.waitFor(() => expect(service?.status()).toMatchObject({ ready: false, preparing: false, error: 'model_download_failed' }))
    } finally { await f.cleanup(service) }
  })

  it('fails closed without the NO_CLOUD startup proof or encrypted cache', async () => {
    const f = await fixture({ model: true, noCloud: false })
    const service = await f.start()
    try {
      expect(service?.status()).toMatchObject({ running: false, ready: false, error: 'local_server_unavailable' })
      expect(f.stop).toHaveBeenCalled()
      expect(f.calls).toHaveLength(0)
    } finally { await f.cleanup(service) }
    const encrypted = await fixture()
    encrypted.dependencies.assertEncrypted = async () => { throw new Error('Not encrypted') }
    const denied = await encrypted.start()
    try {
      expect(denied?.status()).toMatchObject({ running: false, error: 'storage_unavailable' })
      expect(encrypted.spawn).not.toHaveBeenCalled()
    } finally { await encrypted.cleanup(denied) }
  })

  it('does not launch unsupported platforms or absent installed applications', async () => {
    const f = await fixture()
    try {
      expect(await ManagedLocalGmailOllama.start(join(f.directory, 'records'), { ...f.dependencies, platform: 'linux' })).toBeUndefined()
      expect(await ManagedLocalGmailOllama.start(join(f.directory, 'records'), { ...f.dependencies, installed: async () => false })).toBeUndefined()
      expect(f.spawn).not.toHaveBeenCalled()
    } finally { await f.cleanup() }
  })
})
