import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { readFile, writeFile } from 'node:fs/promises'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { createGoogleWorkspaceRunner, googleWorkspaceEnvironment } from './process.js'

function fixture(behavior: (child: ChildProcess, args: readonly string[], options: SpawnOptions) => void) {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() }) as unknown as ChildProcess
  const spawn = vi.fn(async (_binary: string, args: readonly string[], options: SpawnOptions) => {
    setImmediate(() => behavior(child, args, options))
    return child
  })
  const stop = vi.fn(async () => { child.emit('close', null) })
  return { run: createGoogleWorkspaceRunner({ resolveBinary: async () => ({ path: '/bundled/gws', version: '0.22.5' }), spawn, stop }), spawn, stop }
}
afterEach(() => vi.restoreAllMocks())
describe('Google Workspace owned process boundary', () => {
  it('uses explicit argv with no shell or inherited injection environment', async () => {
    const args = ['gmail', 'users', 'messages', 'list', '--params', JSON.stringify({ q: '$(touch /tmp/bad); --upload secret' })]
    const f = fixture((child, _args, options) => {
      void readFile(`${options.cwd}/.env`, 'utf8').then(text => {
        expect(text).toBe('')
        child.stdout!.emit('data', Buffer.from('{"messages":[]}'))
        child.emit('close', 0)
      })
    })
    const result = await f.run(args)
    expect(JSON.parse(result.stdout.toString())).toEqual({ messages: [] })
    expect(f.spawn).toHaveBeenCalledWith('/bundled/gws', args, expect.objectContaining({ shell: false, stdio: ['ignore', 'pipe', 'pipe'] }))
    const options = f.spawn.mock.calls[0][2]
    expect(options.env?.PATH).toBe(options.cwd)
    await expect(readFile(`${options.cwd}/.env`)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('strips proxy, secrets, credentials, logging and loader overrides, and disables ADC fallback', () => {
    const env = googleWorkspaceEnvironment('/safe', {
      GOOGLE_WORKSPACE_CLI_TOKEN: 'secret', GOOGLE_WORKSPACE_CLI_CLIENT_SECRET: 'secret',
      GOOGLE_WORKSPACE_CLI_CONFIG_DIR: '/evil', GOOGLE_APPLICATION_CREDENTIALS: '/secret',
      HTTP_PROXY: 'http://evil', HTTPS_PROXY: 'http://evil', ALL_PROXY: 'http://evil',
      LD_PRELOAD: '/evil.so', DYLD_INSERT_LIBRARIES: '/evil', NODE_OPTIONS: '--require=/evil',
      GWS_LOG: 'trace', RUST_LOG: 'trace', PATH: '/evil', USER: 'test'
    })
    expect(env).not.toHaveProperty('GOOGLE_WORKSPACE_CLI_TOKEN')
    expect(env).not.toHaveProperty('GOOGLE_WORKSPACE_CLI_CONFIG_DIR')
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe('/safe/adc-disabled')
    expect(JSON.stringify(env)).not.toMatch(/secret|evil|trace/)
  })
  it.each([1, 2, 3, 4, 5])('normalizes exit code %s without leaking raw stderr/stdout', async code => {
    const f = fixture(child => {
      child.stdout!.emit('data', Buffer.from('{"error":"client_secret=private"}'))
      child.stderr!.emit('data', Buffer.from('https://accounts.google.com/o/oauth2/auth?code=private'))
      child.emit('close', code)
    })
    await expect(f.run(['auth', 'status'])).rejects.not.toThrow(/private|client_secret|accounts.google/)
  })
  it('kills on bounded output and timeout', async () => {
    const large = fixture(child => child.stdout!.emit('data', Buffer.alloc(10)))
    await expect(large.run(['--version'], { maxOutputBytes: 5 })).rejects.toMatchObject({ code: 'output_limit' })
    expect(large.stop).toHaveBeenCalledOnce()
    const stalled = fixture(() => undefined)
    await expect(stalled.run(['--version'], { timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout' })
    expect(stalled.stop).toHaveBeenCalledOnce()
  })
  it('cancels before spawn and while running', async () => {
    const f = fixture(() => undefined)
    const controller = new AbortController()
    controller.abort()
    await expect(f.run(['auth', 'login'], { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' })
    expect(f.spawn).not.toHaveBeenCalled()
    const active = new AbortController()
    const promise = f.run(['auth', 'login'], { signal: active.signal })
    await vi.waitFor(() => expect(f.spawn).toHaveBeenCalledOnce())
    active.abort()
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' })
    expect(f.stop).toHaveBeenCalledOnce()
  })
  it('reads binary bytes only from its generated private output and removes them', async () => {
    const bytes = Buffer.from([0, 255, 128, 65])
    const f = fixture((child, args) => {
      expect(args.at(-2)).toBe('--output')
      void writeFile(args.at(-1)!, bytes).then(() => {
        child.stdout!.emit('data', Buffer.from('{"saved_file":"untrusted-other-path"}'))
        child.emit('close', 0)
      })
    })
    const result = await f.run(['drive', 'files', 'get'], { media: true })
    expect(result.stdout).toEqual(bytes)
    await expect(readFile(f.spawn.mock.calls[0][1].at(-1)!)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects JSON-as-media rather than pretending stdout is original bytes', async () => {
    const f = fixture(child => { child.stdout!.emit('data', Buffer.from('{"value":1}')); child.emit('close', 0) })
    await expect(f.run(['drive', 'files', 'get'], { media: true })).rejects.toMatchObject({ code: 'process' })
  })
})
