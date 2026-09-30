import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveWindowsExecutablePath } from './owned-process-windows.js'
import { quoteWindowsArgument, spawnWindowsOwnedProcess, stopWindowsOwnedProcess, shutdownWindowsOwnedProcesses, resumeWindowsOwnedProcessAdmission } from './owned-process-windows.js'

describe('Windows executable argument encoding', () => {
  it('uses the same case-insensitive PATH and command suffix lookup for detection and launch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-windows-command-'))
    try {
      await writeFile(join(directory, 'npm.cmd'), '@exit /b 0')
      expect(await resolveWindowsExecutablePath('npm', { env: { Path: directory } })).toBe(join(directory, 'npm.cmd'))
      expect(await resolveWindowsExecutablePath(join(directory, 'npm.cmd'), {})).toBe(join(directory, 'npm.cmd'))
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('preserves whitespace, trailing backslashes and embedded quotes without a shell', () => {
    expect(quoteWindowsArgument('plain')).toBe('plain')
    expect(quoteWindowsArgument('')).toBe('""')
    expect(quoteWindowsArgument('a b')).toBe('"a b"')
    expect(quoteWindowsArgument('a"b')).toBe('"a\\"b"')
    expect(quoteWindowsArgument('C:\\some path\\')).toBe('"C:\\some path\\\\"')
  })
})

describe.skipIf(process.platform !== 'win32')('Windows owned Job integration', () => {
  it('preserves Node IPC and waits for the target Job to exit', async () => {
    resumeWindowsOwnedProcessAdmission()
    const child = await spawnWindowsOwnedProcess(process.execPath, ['-e',
      'process.send({pid:process.pid}); process.on("message",()=>process.exit(0)); setInterval(()=>{},1000)'], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    try {
      const result = await new Promise<{ pid: number }>((resolve) => child.once('message', resolve))
      expect(result.pid).toBe(child.pid)
      child.send('stop')
      await stopWindowsOwnedProcess(child, { graceMs: 1000, timeoutMs: 5000 })
      expect(child.exitCode).toBe(0)
    } finally { await shutdownWindowsOwnedProcesses({ timeoutMs: 5000 }) }
  }, 30_000)
})
