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
  const calls: { path: string; body?: unknown }[] = []
  const spawn = vi.fn<LocalOllamaDependencies['spawn']>(async () => {
    setImmediate(() => { if (options.noCloud !== false) child.stderr?.emit('data', Buffer.from('Ollama cloud disabled: true\n')) })
    return child
  })
  const stop = vi.fn<LocalOllamaDependencies['stop']>(async () => { Object.assign(child, { exitCode: 0, killed: true }); child.emit('exit', 0) })
  const assertEncrypted = vi.fn(async () => undefined)
  const assertPortOwner = vi.fn(async () => { if (!owned) throw new Error('Foreign listener') })
  const dependencies: Partial<LocalOllamaDependencies> = {
    platform: 'darwin', installed: async () => true, assertEncrypted, reservePort: async () => 43_123,
    spawn, stop, isOwned: () => owned, assertPortOwner, now: () => (clock += 100),
    pause: async () => { await new Promise((resolve) => setImmediate(resolve)) },
    directFetch: (_origin, assertLive) => async (input, init) => {
      assertLive()
      const request = new Request(input, init)
      const path = new URL(request.url).pathname
      const body = request.method === 'POST' ? await request.json() : undefined
      calls.push({ path, body })
      if (path === '/api/version') return json({ version: '0.32.1' })
      if (path === '/api/show') return model ? json({ model_info: { 'general.architecture': 'qwen3' },
        modelfile: `FROM ${join(directory, 'gmail-model-cache', 'blobs', 'sha256-' + 'a'.repeat(64))}\nPARAMETER num_ctx 32768`,
        ...(options.remote ? { remote_model: 'qwen3:4b', remote_host: 'https://ollama.com' } : {}) }) : json({ error: 'not found' }, 404)
      if (path === '/api/pull') { const result = await pull; model = true; return result }
      return json({ choices: [] })
    }
  }
  const start = () => ManagedLocalGmailOllama.start(join(directory, 'records'), dependencies)
  return { directory, child, dependencies, spawn, stop, assertEncrypted, assertPortOwner, calls, start,
    completePull: () => resolvePull(json({ status: 'success' })), removeOwnership: () => { owned = false },
    cleanup: async (service?: ManagedLocalGmailOllama) => {
      resolvePull(json({ status: 'success' }))
      await service?.dispose()
      await rm(directory, { recursive: true, force: true })
    } }
}

describe('app-owned cloud-disabled Gmail model', () => {
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
