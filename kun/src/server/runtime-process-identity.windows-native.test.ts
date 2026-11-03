import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectRuntimeProcess, requireRuntimeProcessIdentity, runtimeProcessIsAlive } from './runtime-process-identity.js'

describe.skipIf(process.platform !== 'win32')('native Windows birth identity compatibility', () => {
  it('matches legacy CIM tokens exactly for a live child and observes its exit', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    await once(child, 'spawn')
    const exited = once(child, 'exit')
    try {
      const pid = child.pid!
      const nativeStarted = performance.now()
      const identity = requireRuntimeProcessIdentity(pid)
      const nativeElapsedMs = Math.round(performance.now() - nativeStarted)
      const powershell = process.env.SystemRoot
        ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe'
      // This is the old production query, deliberately kept only in this
      // compatibility test. Production no longer needs the CIM service.
      const legacyStarted = performance.now()
      const legacyBirth = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop; ` +
        `[Console]::Out.Write($p.CreationDate.ToUniversalTime().ToString('O'))`],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true }).trim()
      console.info('Windows process birth query timings', {
        nativeElapsedMs, legacyCimElapsedMs: Math.round(performance.now() - legacyStarted)
      })
      expect(identity).toBe(`win32-v1:${legacyBirth}`)
      expect(requireRuntimeProcessIdentity(pid)).toBe(identity)
      expect(runtimeProcessIsAlive(pid, { startedAt: new Date().toISOString(), processIdentity: identity })).toBe(true)
      expect(runtimeProcessIsAlive(pid, { startedAt: new Date().toISOString(), processIdentity: `${identity}:reused` })).toBe(false)
      child.kill()
      await exited
      expect(inspectRuntimeProcess(pid)).toBeUndefined()
      expect(runtimeProcessIsAlive(pid)).toBe(false)
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill()
      await exited
    }
  }, 60_000)
})
