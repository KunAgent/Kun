import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSystemTerminal, systemTerminalCommands } from './terminal-dock-ipc'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})

describe('system terminal launch', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('tries the next candidate after spawn followed by immediate nonzero exit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-terminal-events-'))
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const started: string[] = []
      for (const exitCode of [2, 0]) {
        vi.mocked(spawn).mockImplementationOnce((file) => {
          started.push(file)
          const child = new EventEmitter() as ChildProcess
          child.unref = vi.fn()
          queueMicrotask(() => { child.emit('spawn'); child.emit('exit', exitCode, null) })
          return child
        })
      }
      expect(await openSystemTerminal(directory, 'linux')).toBe(true)
      expect(started).toEqual(['x-terminal-emulator', 'gnome-terminal'])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('exited during startup (2)'))
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it.skipIf(process.platform !== 'linux')('falls back when a real Linux terminal immediately exits nonzero', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-terminal-test-'))
    try {
      const receipt = join(directory, 'receipt')
      await writeFile(join(directory, 'x-terminal-emulator'), '#!/bin/sh\nexit 2\n', { mode: 0o755 })
      await writeFile(join(directory, 'gnome-terminal'), `#!/bin/sh\npwd > "${receipt}"\n`, { mode: 0o755 })
      vi.stubEnv('PATH', directory)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      expect(await openSystemTerminal(directory, 'linux')).toBe(true)
      expect((await readFile(receipt, 'utf8')).trim()).toBe(await realpath(directory))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('exited during startup (2)'))
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('uses only portable arguments for the generic Linux terminal', () => {
    expect(systemTerminalCommands('/w', 'linux')[0]).toEqual({ file: 'x-terminal-emulator', args: [] })
  })
  it('picks a native terminal command per platform', () => {
    expect(systemTerminalCommands('/w', 'darwin')).toEqual([{ file: 'open', args: ['-a', 'Terminal', '/w'] }])
    expect(systemTerminalCommands('C:\\w', 'win32')[0]).toEqual({ file: 'wt.exe', args: ['-d', 'C:\\w'] })
    expect(systemTerminalCommands('/w', 'linux').map((command) => command.file)).toContain('x-terminal-emulator')
  })

  it('refuses relative or missing directories', async () => {
    expect(await openSystemTerminal('relative/dir', 'linux')).toBe(false)
    expect(await openSystemTerminal('/definitely/not/here/kun', 'linux')).toBe(false)
  })
})
