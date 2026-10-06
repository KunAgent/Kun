import type { ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IPty } from 'node-pty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnPtyBehindGate } from './pty-launch-gate'
import { prepareWindowsOwnedPty, stopWindowsOwnedProcess } from '../../../kun/src/process/owned-process-windows.js'

vi.mock('../../../kun/src/process/owned-process-windows.js', () => ({
  prepareWindowsOwnedPty: vi.fn(),
  stopWindowsOwnedProcess: vi.fn(async () => undefined)
}))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.clearAllMocks()
})

describe('Windows PTY ownership adapter', () => {
  it('starts the native Job launcher and binds its PTY lifetime to the owned handle', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    let onExit!: (event: { exitCode: number }) => void
    let onData!: (data: string) => void
    const pty = {
      pid: 1001,
      onExit: vi.fn((listener) => { onExit = listener; return { dispose: vi.fn() } }),
      onData: vi.fn((listener) => { onData = listener; return { dispose: vi.fn() } }),
      kill: vi.fn()
    }
    let facade!: ChildProcess
    vi.mocked(prepareWindowsOwnedPty).mockResolvedValue({
      command: 'C:\\cache\\kun-owned-launcher.exe', args: [], env: { KUN_OWNED_LAUNCH_CONFIG: 'config' },
      bind: async (child) => { facade = child; Object.defineProperty(child, 'pid', { value: 1002 }); return child },
      abort: vi.fn(async () => undefined)
    })
    const spawn = vi.fn(() => pty as unknown as IPty)
    const launch = await spawnPtyBehindGate({ spawn }, 'powershell.exe', ['-NoLogo'], { cwd: 'C:\\work', env: { PATH: 'bin' } })
    await launch.ready
    expect(prepareWindowsOwnedPty).toHaveBeenCalledWith('powershell.exe', ['-NoLogo'], { cwd: 'C:\\work', env: { PATH: 'bin' } })
    expect(spawn).toHaveBeenCalledWith('C:\\cache\\kun-owned-launcher.exe', [], {
      cwd: 'C:\\work', env: { KUN_OWNED_LAUNCH_CONFIG: 'config' }
    })
    expect(facade.pid).toBe(1002)
    expect(pty.pid).toBe(1001)
    onData('Windows shell prompt')
    expect(launch.takeInitialOutput()).toBe('Windows shell prompt')
    onExit({ exitCode: 0 })
    expect(facade.exitCode).toBe(0)
    await launch.ownership!.stop()
    expect(stopWindowsOwnedProcess).toHaveBeenCalledWith(facade, { graceMs: 0, timeoutMs: 5_000 })
  })

  it('removes prepared launch state if ConPTY cannot start the native launcher', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const abort = vi.fn(async () => undefined)
    const bind = vi.fn()
    vi.mocked(prepareWindowsOwnedPty).mockResolvedValue({ command: 'launcher.exe', args: [], env: {}, bind, abort })
    await expect(spawnPtyBehindGate({ spawn: () => { throw new Error('ConPTY unavailable') } }, 'cmd.exe', [], {}))
      .rejects.toThrow('ConPTY unavailable')
    expect(abort).toHaveBeenCalledOnce()
    expect(bind).not.toHaveBeenCalled()
  })

  it('validates Agent admission after Windows preparation and before native spawn', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const order: string[] = []
    const bind = vi.fn(async (child: ChildProcess) => { order.push('bind'); return child })
    vi.mocked(prepareWindowsOwnedPty).mockImplementation(async () => {
      order.push('prepare')
      await Promise.resolve()
      return { command: 'launcher.exe', args: [], env: {}, bind, abort: vi.fn(async () => undefined) }
    })
    const pty = { pid: 1001, onExit: () => ({ dispose: vi.fn() }), onData: () => ({ dispose: vi.fn() }), kill: vi.fn() }
    const spawn = vi.fn(() => { order.push('spawn'); return pty as unknown as IPty })
    const validate = vi.fn(async () => { order.push('validate') })
    const launch = await spawnPtyBehindGate({ spawn }, 'C:\\agents\\agent.exe', [], {}, () => false, validate)
    await launch.ready
    expect(order).toEqual(['prepare', 'validate', 'spawn', 'bind'])
    expect(validate).toHaveBeenCalledOnce()
  })

  it('aborts prepared Windows state without spawning when proof becomes invalid during preparation', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    let enabled = true
    const abort = vi.fn(async () => undefined)
    const bind = vi.fn()
    vi.mocked(prepareWindowsOwnedPty).mockImplementation(async () => {
      await Promise.resolve()
      enabled = false
      return { command: 'launcher.exe', args: [], env: {}, bind, abort }
    })
    const spawn = vi.fn()
    const validate = vi.fn(async () => { if (!enabled) throw new Error('Agent profile changed before launch') })
    await expect(spawnPtyBehindGate({ spawn }, 'C:\\agents\\agent.exe', [], {}, () => false, validate))
      .rejects.toThrow('Agent profile changed before launch')
    expect(validate).toHaveBeenCalledOnce()
    expect(spawn).not.toHaveBeenCalled()
    expect(bind).not.toHaveBeenCalled()
    expect(abort).toHaveBeenCalledOnce()
  })
})


describe('POSIX PTY startup gate', () => {
  it.skipIf(platform.value === 'win32')('does not run the configured shell before launch admission is released', async () => {
    const native = await import('node-pty')
    const directory = await mkdtemp(join(tmpdir(), 'kun-pty-gate-'))
    const marker = join(directory, 'executed')
    const launch = await spawnPtyBehindGate(native, '/bin/sh', ['-c', 'printf started > "$1"; exec sleep 60', 'fixture', marker], { cwd: directory, env: process.env })
    try {
      await launch.ready
      await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      launch.release()
      const deadline = Date.now() + 3_000
      let content = ''
      while (Date.now() < deadline) {
        content = await readFile(marker, 'utf8').catch(() => '')
        if (content) break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      expect(content).toBe('started')
    } finally {
      launch.pty.kill()
      await launch.exited
      await rm(directory, { recursive: true, force: true })
    }
  })
})
