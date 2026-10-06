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
  const exitCallbacks = new Set<(result: { exitCode: number; signal?: number }) => void>()
  const emitExit = (result: { exitCode: number; signal?: number }): void => {
    for (const cb of [...exitCallbacks]) cb(result)
  }
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
          exitCallbacks.add(cb)
          holder.exitCb = emitExit
          return { dispose: () => exitCallbacks.delete(cb) }
        },
        write: (data: string) => { holder.written.push(data) },
        resize: vi.fn(),
        kill: vi.fn(() => emitExit({ exitCode: 1 })),
        process: 'sh'
      } as unknown as IPty
      holder.spawnArgs = { file, args: argv, options: options as { env?: Record<string, string> } }
      return pty
    }
  }
  return holder
}

type RuntimeFetch = (path: string, init?: { method?: string; body?: string }) => Promise<Response>

function setup(
  runtimeFetch: RuntimeFetch,
  ptyModule: FakePtyModule = fakePtyModule(),
  extra: { resolveKunCli?: () => Promise<{ binDir: string; cliPath: string } | null> } = {}
) {
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
    loadPty: async () => ptyModule,
    ...extra
  })
  return {
    ptyModule,
    call: (name: string, args: unknown) =>
      handlers.get(name)!({ sender } as never, args as never)
  }
}

function fakeRuntime(calls: Array<{ path: string; body: unknown }>): RuntimeFetch {
  return async (path, init) => {
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : undefined })
    if (path === '/v1/execution-units') {
      return new Response(JSON.stringify({
        unitId: 'tu_77',
        tokens: { workerCallback: 'kgw_worker', hookIngest: 'kgw_hook' },
        endpoint: 'http://127.0.0.1:18899',
        launch: { command: '/usr/local/bin/claude', argv: ['--dangerously-skip-permissions'], taskFlag: '-t', admissionId: 'proof_77',
          args: ['--settings', '/tmp/ade/hooks/tu_77.json'], env: { KUN_HOOK_DIR: '/tmp/ade/hooks/tu_77' } }
      }), { status: 200 })
    }
    if (path === '/v1/execution-units/tu_77/validate-launch') return new Response(JSON.stringify({ command: '/usr/local/bin/claude' }), { status: 200 })
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
    expect(calls[0]).toMatchObject({
      path: '/v1/execution-units',
      body: {
        kind: 'terminal-agent',
        harnessId: 'claude-code',
        title: 'claude term',
        workspace: { path: '/ws/task', kind: 'local' }
      }
    })
    // args: gate argv = [marker, token, file, ...argv] — the harness command
    // comes from the checked Runtime snapshot, flags+task and hooks follow.
    const spawned = ptyModule.spawnArgs!
    expect(spawned.args[5]).toBe('/usr/local/bin/claude')
    const taskArg = spawned.args[8]
    // The injected task carries the 05 §5.3 callback appendix.
    expect(taskArg).toMatch(/^fix the flake\n---\nReporting back to Kun/)
    expect(taskArg).toContain('$KUN_CLI" worker progress')
    expect(spawned.args.slice(6)).toEqual([
      '--dangerously-skip-permissions', '-t', taskArg,
      '--settings', '/tmp/ade/hooks/tu_77.json'
    ])
    const env = spawned.options.env ?? {}
    expect(env.KUN_UNIT_ID).toBe('tu_77')
    expect(env.KUN_WORKER_TOKEN).toBe('kgw_worker')
    expect(env.KUN_HOOK_TOKEN).toBe('kgw_hook')
    expect(env.KUN_WORKER_ENDPOINT).toBe('http://127.0.0.1:18899')
    expect(env.KUN_HOOK_DIR).toBe('/tmp/ade/hooks/tu_77')
    expect(calls.filter((call) => call.path.endsWith('/validate-launch'))).toEqual([
      { path: '/v1/execution-units/tu_77/validate-launch', body: { admissionId: 'proof_77' } },
      { path: '/v1/execution-units/tu_77/validate-launch', body: { admissionId: 'proof_77' } }
    ])
  })

  it('puts the bundled kun bin dir first on PATH and exports KUN_CLI', async () => {
    const calls: Array<{ path: string; body: unknown }> = []
    const resolveKunCli = vi.fn(async () => ({
      binDir: '/opt/kun/bin',
      cliPath: '/opt/kun/bin/kun'
    }))
    const { ptyModule, call } = setup(fakeRuntime(calls), fakePtyModule(), { resolveKunCli })
    const result = await call('terminal:create', {
      sessionId: 'agent-cli',
      agent: { harnessId: 'claude-code', title: 'claude term', task: 'fix it' }
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(resolveKunCli).toHaveBeenCalledOnce()
    const env = ptyModule.spawnArgs!.options.env ?? {}
    expect(env.KUN_CLI).toBe('/opt/kun/bin/kun')
    expect(env.PATH?.startsWith('/opt/kun/bin')).toBe(true)
  })

  it('still launches the agent when kun CLI resolution fails', async () => {
    const calls: Array<{ path: string; body: unknown }> = []
    const { ptyModule, call } = setup(fakeRuntime(calls), fakePtyModule(), {
      resolveKunCli: async () => { throw new Error('no cli') }
    })
    const result = await call('terminal:create', {
      sessionId: 'agent-cli-null',
      agent: { harnessId: 'claude-code', title: 'claude term' }
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    const env = ptyModule.spawnArgs!.options.env ?? {}
    expect(env.KUN_CLI).toBeUndefined()
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

  it('rejects disabled profiles at the Runtime boundary without spawning a PTY', async () => {
    const { ptyModule, call } = setup(async () => new Response(JSON.stringify({
      message: 'Test and enable this Agent profile before launching it'
    }), { status: 409 }))
    expect(await call('terminal:create', { sessionId: 'disabled-agent', agent: { harnessId: 'claude-code', title: 't' } }))
      .toMatchObject({ ok: false, message: expect.stringContaining('Test and enable') })
    expect(ptyModule.spawnArgs).toBeUndefined()
  })

  it('revalidates after asynchronous CLI setup and rejects an expired or disabled proof', async () => {
    const calls: Array<{ path: string; body: unknown }> = []
    const base = fakeRuntime(calls)
    let disabled = false
    const runtime: RuntimeFetch = async (path, init) => path.endsWith('/validate-launch') && disabled
      ? new Response(JSON.stringify({ message: 'Terminal Agent readiness proof expired; test it again' }), { status: 409 })
      : base(path, init)
    const { ptyModule, call } = setup(runtime, fakePtyModule(), {
      resolveKunCli: async () => { disabled = true; return null }
    })
    expect(await call('terminal:create', { sessionId: 'expired-agent', agent: { harnessId: 'claude-code', title: 't' } }))
      .toMatchObject({ ok: false, message: expect.stringContaining('readiness proof expired') })
    expect(ptyModule.spawnArgs).toBeUndefined()
    expect(calls.at(-1)).toMatchObject({ path: '/v1/execution-units/tu_77/exit' })
  })

  it('does not replace the checked command when Runtime validation reports a different executable', async () => {
    const calls: Array<{ path: string; body: unknown }> = []
    const base = fakeRuntime(calls)
    const runtime: RuntimeFetch = async (path, init) => path.endsWith('/validate-launch')
      ? new Response(JSON.stringify({ command: '/other/claude' }), { status: 200 }) : base(path, init)
    const { ptyModule, call } = setup(runtime)
    expect(await call('terminal:create', { sessionId: 'changed-command', agent: { harnessId: 'claude-code', title: 't' } }))
      .toMatchObject({ ok: false, message: expect.stringContaining('command changed before launch') })
    expect(ptyModule.spawnArgs).toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('never opens the owned POSIX gate when the profile changes during ownership registration', async () => {
    const calls: Array<{ path: string; body: unknown }> = []
    const base = fakeRuntime(calls)
    let validations = 0
    const runtime: RuntimeFetch = async (path, init) => {
      if (path.endsWith('/validate-launch') && ++validations === 2) return new Response(JSON.stringify({
        message: 'Agent profile changed before launch; test it again'
      }), { status: 409 })
      return base(path, init)
    }
    const { ptyModule, call } = setup(runtime)
    expect(await call('terminal:create', { sessionId: 'changed-after-spawn', agent: { harnessId: 'claude-code', title: 't' } }))
      .toMatchObject({ ok: false, message: expect.stringContaining('profile changed before launch') })
    expect(ptyModule.written).toEqual([])
    expect(calls.at(-1)).toMatchObject({ path: '/v1/execution-units/tu_77/exit' })
  })

  it('rejects a launch response without an admission token instead of guessing a command', async () => {
    const calls: Array<{ path: string; body: unknown }> = []
    const base = fakeRuntime(calls)
    const runtime: RuntimeFetch = async (path, init) => {
      const response = await base(path, init)
      if (path !== '/v1/execution-units') return response
      const body = await response.json()
      delete body.launch.admissionId
      return new Response(JSON.stringify(body), { status: 200 })
    }
    const { ptyModule, call } = setup(runtime)
    expect(await call('terminal:create', { sessionId: 'missing-admission', agent: { harnessId: 'claude-code', title: 't' } }))
      .toMatchObject({ ok: false, message: expect.stringContaining('checked terminal Agent command') })
    expect(ptyModule.spawnArgs).toBeUndefined()
  })
})
