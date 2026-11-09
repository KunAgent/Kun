/** @vitest-environment jsdom */
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalCreatePayload, TerminalCreateResult, TerminalWritePayload, TerminalResizePayload } from '@shared/terminal'
import type { IPty } from 'node-pty'
import { defaultTerminalSettings } from '@shared/app-settings-terminal'
import { resolveProfileLaunch } from '@shared/app-settings-terminal-dock'
import { terminalCreatePayloadSchema } from '../../../../main/ipc/app-ipc-schemas'
import { registerTerminalPtyIpc, type TerminalPtyController } from '../../../../main/terminal/terminal-pty-ipc'
import { openAgent, openLocalShell, ptySessionIdFor } from './terminal-dock-actions'
import { terminalAgentEntries } from './terminal-agent-catalog'
import { configureTerminals, disposeTerminal, ensureTerminalInstance, terminalRuntimeConfig } from './terminal-instance-registry'
import { readSessionStatus, useTerminalDockStore, workspaceTerminals } from './terminal-dock-store'
import { applyTerminalOpenRequest } from './terminal-open'

const mock = vi.hoisted(() => ({ shell: 'powershell', prompts: [] as Array<() => void> }))
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options = {}; cols = 80; rows = 24
  loadAddon() {} open() {} write() {} dispose() {} getSelection() { return '' }
  registerLinkProvider() { return { dispose() {} } }
  onBell() { return { dispose() {} } } onSelectionChange() { return { dispose() {} } }
  onData() { return { dispose() {} } } onResize() { return { dispose() {} } }
} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('./terminal-panel-support', () => ({ attachTerminalClipboardKeys() {}, TERMINAL_FONT_FAMILY: 'monospace' }))
vi.mock('./terminal-search', () => ({ TerminalSearchController: class {} }))
vi.mock('./terminal-shell-commands', () => ({ readBufferLines: () => [], ShellCommandTracker: class {
  constructor(_term: unknown, options: { onPrompt: () => void }) { mock.prompts.push(options.onPrompt) }
  dispose() {}
} }))
vi.mock('./terminal-links', () => ({ createFileLinkProvider: () => ({}), isLocalPreviewUrl: () => false }))
vi.mock('../../lib/terminal-output-attachment', () => ({ attachTerminalOutput: vi.fn(), selectRelevantLines: vi.fn() }))
vi.mock('../../agent/registry', () => ({ getProvider: () => ({}) }))
vi.mock('../../store/harness-store', () => ({ loadHarnesses: vi.fn() }))
vi.mock('../../../../main/terminal/pty-environment', async (original) => {
  const actual = await original<typeof import('../../../../main/terminal/pty-environment')>()
  return { ...actual,
    buildShellEnv: () => ({ Path: 'base-path', PATH: 'duplicate-path', BASE: 'inherited' }),
    resolveTerminalShellCandidates: () => actual.resolveTerminalShellCandidates('win32', {
      env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' },
      lookup: (() => ({ status: 1, stdout: '' })) as never,
      fileExists: (file) => mock.shell === 'bash'
        ? file === 'C:\\Program Files\\Git\\bin\\bash.exe'
        : file === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    })
  }
})
vi.mock('../../../../main/terminal/pty-launch-gate', () => ({
  spawnPtyBehindGate: vi.fn(async (module: { spawn: (file: string, args: string[], options: unknown) => IPty }, file: string, args: string[], options: unknown) => {
    const pty = module.spawn(file, args, options)
    return { pty, ready: Promise.resolve(), exited: new Promise((done) => pty.onExit(done)),
      release: vi.fn(), takeInitialOutput: () => '', ownership: { stop: async () => undefined } }
  })
}))
vi.mock('../../../../../kun/src/process/owned-process.js', () => ({ registerOwnedProcessGroup: vi.fn() }))

const scope = { workspaceRoot: 'C:\\Work', workspaceKey: 'profile-test' }
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const profile = {
  id: 'custom-test', name: 'Custom Agent', command: 'C:\\Program Files\\Agent\\agent.exe',
  args: '--task {task} "two words" "it\'s" "$HOME&;`x`"', icon: 'terminal', cwd: 'C:\\Work',
  env: [{ key: 'HTTPS_PROXY', value: 'http://proxy/?a=1&b=2' }, { key: 'Path', value: 'C:\\Tools;C:\\Windows' }]
}
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
let controller: TerminalPtyController
let ids: string[] = []

function setup() {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  const listeners = new Set<(data: { sessionId: string; data: string }) => void>()
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false,
    send: (channel: string, payload: { sessionId: string; data: string }) => {
      if (channel === 'terminal:data') listeners.forEach((listener) => listener(payload))
    }
  })
  const writes: string[] = []
  const spawn = vi.fn((_file: string, _args: string[], _options: { env: NodeJS.ProcessEnv }) => {
    const exits = new Set<(result: { exitCode: number }) => void>()
    return { pid: 4242, process: 'powershell.exe',
      write: (data: string) => writes.push(data), resize: vi.fn(),
      onData: () => ({ dispose() {} }),
      onExit: (callback: (result: { exitCode: number }) => void) => { exits.add(callback); return { dispose: () => exits.delete(callback) } },
      kill: () => exits.forEach((callback) => callback({ exitCode: 0 }))
    }
  })
  const runtimeFetch = vi.fn()
  controller = registerTerminalPtyIpc({ ipcMain: { handle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(channel, handler) } as never,
    getMainWindow: () => null, logError: vi.fn(), runtimeFetch, loadPty: async () => ({ spawn }) as never })
  const call = (channel: string, payload: unknown) => handlers.get(channel)!({ sender }, payload)
  const create = vi.fn((payload: TerminalCreatePayload) => call('terminal:create', payload) as Promise<TerminalCreateResult>)
  Object.assign(window, { kunGui: {
    platform: 'win32', createTerminal: create,
    writeToTerminal: vi.fn((payload: TerminalWritePayload) => call('terminal:write', payload)),
    resizeTerminal: vi.fn((payload: TerminalResizePayload) => call('terminal:resize', payload)),
    disposeTerminal: vi.fn((id: string) => call('terminal:dispose', id)),
    onTerminalData: (listener: (data: { sessionId: string; data: string }) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    onTerminalExit: () => () => undefined
  } })
  return { call, create, spawn, writes, runtimeFetch }
}

function latestPane() { return workspaceTerminals(scope.workspaceKey).tabs.at(-1)!.panes[0]! }
function startPane() {
  const pane = latestPane()
  const id = ptySessionIdFor(scope.workspaceRoot, pane)
  ids.push(id)
  ensureTerminalInstance({ ptySessionId: id, pane, workspaceRoot: scope.workspaceRoot })
  return { pane, id }
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  localStorage.clear()
  mock.shell = 'powershell'; mock.prompts = []; ids = []
  useTerminalDockStore.setState({ workspaces: {}, status: {} })
  const settings = defaultTerminalSettings()
  settings.behavior.shellIntegration = false
  // An unrecognized user preference must fall back to the shell main really selects.
  settings.behavior.shell = 'C:\\Missing\\bash.exe'
  configureTerminals({ ...terminalRuntimeConfig(), settings })
})
afterEach(async () => {
  for (const id of ids) disposeTerminal(id, { killPty: false })
  await controller?.disposeAllAndWait()
  vi.clearAllTimers(); vi.useRealTimers()
  Object.defineProperty(process, 'platform', platform)
  vi.restoreAllMocks()
})

describe('custom profile actions through real local terminal IPC', () => {
  it('uses process env and PowerShell invocation when Git Bash is absent, without Agent admission', async () => {
    const io = setup()
    const settings = { ...defaultTerminalSettings(), profiles: [profile] }
    const entry = terminalAgentEntries([], settings).find((item) => item.id === profile.id)!
    expect(openAgent(scope, entry, { task: "fix O'Brien & $HOME", report: true })).toBe(true)
    const { pane, id } = startPane()
    expect(pane.target.kind).toBe('local')
    // Even a prompt arriving before create resolves must not execute POSIX text.
    mock.prompts[0]!()
    expect(io.writes).toEqual([])
    await vi.waitFor(() => expect(readSessionStatus(id)?.phase).toBe('ready'))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(io.create).toHaveBeenCalledWith(expect.objectContaining({ env: Object.fromEntries(profile.env.map(({ key, value }) => [key, value])) }))
    expect(io.create.mock.calls[0][0]).not.toHaveProperty('agent')
    expect(io.spawn.mock.calls[0][0]).toBe(powershell)
    const env = io.spawn.mock.calls[0][2].env
    expect(env).toMatchObject({ HTTPS_PROXY: profile.env[0].value, Path: profile.env[1].value, BASE: 'inherited' })
    expect(Object.keys(env).filter((key) => key.toLowerCase() === 'path')).toEqual(['Path'])
    expect(io.writes).toEqual(["& 'C:\\Program Files\\Agent\\agent.exe' '--task' 'fix O''Brien & $HOME' 'two words' 'it''s' '$HOME&;`x`'\r"])
    expect(io.runtimeFetch).not.toHaveBeenCalled()
    mock.prompts[0]!()
    expect(io.writes).toHaveLength(1)
    await expect(io.call('terminal:create', { ...io.create.mock.calls[0][0], env: { HTTPS_PROXY: 'different' } }))
      .resolves.toMatchObject({ ok: false, message: expect.stringContaining('cannot be changed') })
    await expect(io.call('terminal:create', io.create.mock.calls[0][0]))
      .resolves.toMatchObject({ ok: true, replayed: true, shell: powershell })
  })

  it('keeps POSIX command quoting when the actual Windows shell is Git Bash', async () => {
    mock.shell = 'bash'
    const io = setup()
    const entry = terminalAgentEntries([], { ...defaultTerminalSettings(), profiles: [{ ...profile, command: 'agent' }] }).find((item) => item.id === profile.id)!
    openAgent(scope, entry, { task: "it's $HOME", report: false })
    const { id } = startPane()
    await vi.waitFor(() => expect(readSessionStatus(id)?.phase).toBe('ready'))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(io.spawn.mock.calls[0][0]).toMatch(/Git\\bin\\bash.exe$/)
    expect(io.writes[0]).toBe("agent --task 'it'\\''s $HOME' 'two words' 'it'\\''s' '$HOME&;`x`'\r")
    expect(io.writes[0]).not.toContain('HTTPS_PROXY=')
  })

  it('starts each settings Try Run in a fresh local pane rather than reusing cwd-only shells', async () => {
    const io = setup()
    openLocalShell(scope, undefined, { cwd: profile.cwd })
    const plain = latestPane()
    for (let count = 0; count < 2; count += 1) {
      applyTerminalOpenRequest(scope.workspaceKey, { cwd: profile.cwd, profileLaunch: resolveProfileLaunch(profile, ''), title: profile.name })
    }
    expect(workspaceTerminals(scope.workspaceKey).tabs).toHaveLength(3)
    expect(latestPane().id).not.toBe(plain.id)
    const { id } = startPane()
    await vi.waitFor(() => expect(readSessionStatus(id)?.phase).toBe('ready'))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(io.create.mock.calls[0][0].env?.HTTPS_PROXY).toBe(profile.env[0].value)
  })

  it('does not send a profile command after missing shell identity or retroactive instance changes', async () => {
    const io = setup()
    window.kunGui.createTerminal = vi.fn(async () => ({ ok: true as const, sessionId: 'no-shell' }))
    openAgent(scope, terminalAgentEntries([], { ...defaultTerminalSettings(), profiles: [profile] }).find((item) => item.id === profile.id)!, { task: '', report: false })
    const { pane, id } = startPane()
    await vi.waitFor(() => expect(readSessionStatus(id)?.phase).toBe('error'))
    ensureTerminalInstance({ ptySessionId: id, pane: { ...pane, profileLaunch: { ...pane.profileLaunch!, env: { A: 'changed' } } }, workspaceRoot: scope.workspaceRoot })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(readSessionStatus(id)?.error).toContain('new terminal')
    expect(io.writes).toEqual([])
  })

  it('does not add profile env or auto-run commands for a plain terminal', async () => {
    const io = setup()
    openLocalShell(scope)
    const { id } = startPane()
    await vi.waitFor(() => expect(readSessionStatus(id)?.phase).toBe('ready'))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(io.create.mock.calls[0][0]).not.toHaveProperty('env')
    expect(io.writes).toEqual([])
  })

  it('rejects a different environment while a same-id session is still starting', async () => {
    const io = setup()
    const first = io.call('terminal:create', { sessionId: 'pending-profile', env: { A: 'first' } })
    await expect(io.call('terminal:create', { sessionId: 'pending-profile', env: { A: 'second' } }))
      .resolves.toMatchObject({ ok: false, message: expect.stringContaining('already starting') })
    await expect(first).resolves.toMatchObject({ ok: true, shell: powershell })
    expect(io.spawn.mock.calls[0][2].env.A).toBe('first')
  })

  it('keeps environment schema bounds and rejects NUL values before spawning', () => {
    expect(terminalCreatePayloadSchema.safeParse({ sessionId: 'bad-key', env: { 'A;B': 'value' } }).success).toBe(false)
    expect(terminalCreatePayloadSchema.safeParse({ sessionId: 'nul', env: { A: 'a\0b' } }).success).toBe(false)
    expect(terminalCreatePayloadSchema.safeParse({ sessionId: 'too-many', env: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`A${index}`, 'x'])) }).success).toBe(false)
  })
})
