import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { IPty } from 'node-pty'

vi.mock('../../../kun/src/process/owned-process.js', () => ({
  registerOwnedProcessGroup: vi.fn(async () => ({ stop: vi.fn(async () => {}) }))
}))

import { registerTerminalPtyIpc } from './terminal-pty-ipc'

type PtySpawn = Pick<typeof import('node-pty'), 'spawn'>['spawn']

type FakePtyModule = {
  spawn: PtySpawn
  written: string[]
  dataCb?: (chunk: string) => void
  exitCb?: (result: { exitCode: number; signal?: number }) => void
  spawnArgs?: { file: string; args: string[]; options: { env?: Record<string, string> } }
}

function fakePtyModule(): FakePtyModule {
  const holder: FakePtyModule = {
    written: [],
    spawn(file: string, args: string | string[], options): IPty {
      const argv = Array.isArray(args) ? args : [args]
      // POSIX gate wraps the spawn as `/bin/sh -c script kun-pty-gate
      // <marker> <token> <file> ...argv` — echo the marker back so the gate
      // opens, exactly like the real stty/printf handshake.
      const marker = argv[3] ?? ''
      const pty = {
        pid: 4242,
        onData: (cb: (chunk: string) => void) => {
          holder.dataCb = cb
          queueMicrotask(() => cb(`${marker}\n`))
          return { dispose: vi.fn() }
        },
        onExit: (cb: (result: { exitCode: number; signal?: number }) => void) => {
          holder.exitCb = cb
          return { dispose: vi.fn() }
        },
        write: (data: string) => { holder.written.push(data) },
        resize: vi.fn(),
        kill: vi.fn(),
        process: 'sh'
      } as unknown as IPty
      holder.spawnArgs = { file, args: argv, options: options as { env?: Record<string, string> } }
      return pty
    }
  }
  return holder
}

type RuntimeFetch = (path: string, init?: { method?: string; body?: string }) => Promise<Response>

function setup(runtimeFetch: RuntimeFetch, ptyModule: FakePtyModule = fakePtyModule()) {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const sender = Object.assign(new EventEmitter(), {
    isDestroyed: (): boolean => false,
    send: vi.fn()
  })
  registerTerminalPtyIpc({
    ipcMain: {
      handle: (name: string, handler: (...args: never[]) => unknown) => handlers.set(name, handler)
    } as never,
    getMainWindow: () => null,
    logError: vi.fn(),
    runtimeFetch,
    loadPty: async () => ptyModule
  })
  return {
    ptyModule,
    call: (name: string, args: unknown) =>
      handlers.get(name)!({ sender } as never, args as never)
  }
}

const HARNESSES = {
  harnesses: [{
    definition: {
      id: 'claude-code',
      detect: { command: 'claude' },
      terminal: { argv: ['--dangerously-skip-permissions'], taskFlag: '-t' }
    },
    status: { resolvedCommand: '/usr/local/bin/claude', installed: 'yes' }
  }]
}

function fakeRuntime(calls: Array<{ path: string; body: unknown }>): RuntimeFetch {
  return async (path, init) => {
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : undefined })
    if (path === '/v1/harnesses') {
      return new Response(JSON.stringify(HARNESSES), { status: 200 })
    }
    if (path === '/v1/execution-units') {
      return new Response(JSON.stringify({
        unitId: 'tu_77',
        tokens: { workerCallback: 'kgw_worker', hookIngest: 'kgw_hook' },
        endpoint: 'http://127.0.0.1:18899',
        launch: { args: ['--settings', '/tmp/ade/hooks/tu_77.json'], env: { KUN_HOOK_DIR: '/tmp/ade/hooks/tu_77' } }
      }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }
}

describe('terminal agent PTY launch', () => {
  it('registers the unit, injects callback env, and launches the harness command', async () => {
    const calls: Array<{ path: string; body: unknown }> = []
    const { ptyModule, call } = setup(fakeRuntime(calls))
    const result = await call('terminal:create', {
      sessionId: 'agent-1',
      cwd: '/ws/task',
      agent: { harnessId: 'claude-code', title: 'claude term', task: 'fix the flake' }
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(calls[0].path).toBe('/v1/harnesses')
    expect(calls[1]).toMatchObject({
      path: '/v1/execution-units',
      body: {
        kind: 'terminal-agent',
        harnessId: 'claude-code',
        title: 'claude term',
        workspace: { path: '/ws/task', kind: 'local' }
      }
    })
    // args: gate argv = [marker, token, file, ...argv] — the harness command
    // comes from resolvedCommand, flags+task and hook extras follow.
    const spawned = ptyModule.spawnArgs!
    expect(spawned.args[5]).toBe('/usr/local/bin/claude')
    expect(spawned.args.slice(6)).toEqual([
      '--dangerously-skip-permissions', '-t', 'fix the flake',
      '--settings', '/tmp/ade/hooks/tu_77.json'
    ])
    const env = spawned.options.env ?? {}
    expect(env.KUN_UNIT_ID).toBe('tu_77')
    expect(env.KUN_WORKER_TOKEN).toBe('kgw_worker')
    expect(env.KUN_HOOK_TOKEN).toBe('kgw_hook')
    expect(env.KUN_WORKER_ENDPOINT).toBe('http://127.0.0.1:18899')
    expect(env.KUN_HOOK_DIR).toBe('/tmp/ade/hooks/tu_77')
  })

  it('reports exit and interrupt hints for agent sessions only', async () => {
    const calls: Array<{ path: string; body: unknown }> = []
    const { ptyModule, call } = setup(fakeRuntime(calls))
    await call('terminal:create', {
      sessionId: 'agent-1',
      agent: { harnessId: 'claude-code', title: 'claude term' }
    })
    // A bare Ctrl+C write posts an interrupt hint (throttled to one per 1.5s).
    await call('terminal:write', { sessionId: 'agent-1', data: '\x03' })
    await call('terminal:write', { sessionId: 'agent-1', data: '\x03' })
    const hints = calls.filter((c) => c.path.endsWith('/interrupt-hint'))
    expect(hints).toHaveLength(1)
    ptyModule.exitCb?.({ exitCode: 2 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls.at(-1)).toMatchObject({
      path: '/v1/execution-units/tu_77/exit',
      body: { exitCode: 2 }
    })
  })

  it('does not emit agent traffic for plain terminals', async () => {
    const calls: Array<{ path: string; body: unknown }> = []
    const { call } = setup(fakeRuntime(calls))
    await call('terminal:create', { sessionId: 'plain-1', cwd: '/ws' })
    await call('terminal:write', { sessionId: 'plain-1', data: '\x03' })
    expect(calls).toHaveLength(0)
  })

  it('closes the registered unit when the agent spawn fails', async () => {
    const calls: Array<{ path: string; body: unknown }> = []
    const ptyModule = fakePtyModule()
    ptyModule.spawn = () => { throw new Error('spawn EACCES') }
    const { call } = setup(fakeRuntime(calls), ptyModule)
    const result = await call('terminal:create', {
      sessionId: 'agent-x',
      agent: { harnessId: 'claude-code', title: 't' }
    }) as { ok: boolean; message: string }
    expect(result.ok).toBe(false)
    expect(calls.at(-1)?.path).toBe('/v1/execution-units/tu_77/exit')
  })
})
