import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const pid = 123456
const birth = '2026-10-18T19:57:50.1234560Z'

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.resetModules()
})

async function windowsInspector() {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  return import('./runtime-process-identity.js')
}

describe('Windows process identity inspection', () => {
  it('reads native process birth time without WMI and retains microsecond identity precision', async () => {
    const { inspectRuntimeProcess } = await windowsInspector()
    vi.mocked(execFileSync).mockReturnValue(birth)
    expect(inspectRuntimeProcess(pid)).toEqual({ identity: `win32-v1:${birth}`, startedAtMs: Date.parse(birth) })
    const [executable, args, options] = vi.mocked(execFileSync).mock.calls[0]
    expect(executable).toMatch(/powershell\.exe$/u)
    const command = (args as string[]).at(-1)!
    expect(command).toContain(`[System.Diagnostics.Process]::GetProcessById(${pid})`)
    expect(command).toContain('$p.StartTime.ToUniversalTime()')
    expect(command).toContain('AddTicks(-($startedAt.Ticks % 10))')
    expect(command).not.toMatch(/Get-CimInstance|Get-WmiObject/u)
    expect(options).toMatchObject({ timeout: 3000, maxBuffer: 16 * 1024, windowsHide: true })
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('never interpolates invalid PID %s into a query', async (value) => {
    const { inspectRuntimeProcess } = await windowsInspector()
    expect(inspectRuntimeProcess(value)).toBeUndefined()
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('caches only the current process, never a foreign PID that may be reused', async () => {
    const { inspectRuntimeProcess } = await windowsInspector()
    vi.mocked(execFileSync).mockReturnValueOnce(birth).mockReturnValueOnce('2026-10-18T19:57:50.1234570Z')
    expect(inspectRuntimeProcess(pid)?.identity).toBe(`win32-v1:${birth}`)
    expect(inspectRuntimeProcess(pid)?.identity).toBe('win32-v1:2026-10-18T19:57:50.1234570Z')
    expect(execFileSync).toHaveBeenCalledTimes(2)
    vi.mocked(execFileSync).mockReturnValue(birth)
    inspectRuntimeProcess(process.pid)
    inspectRuntimeProcess(process.pid)
    expect(execFileSync).toHaveBeenCalledTimes(3)
  })

  it.each([
    [Object.assign(new Error('private stderr and token'), { code: 'ETIMEDOUT' }), 'query timed out'],
    [Object.assign(new Error('private stderr and token'), { code: 'ENOENT' }), 'executable or process data is unavailable'],
    [Object.assign(new Error('private stderr and token'), { status: 3 }), 'not found by the identity query'],
    [Object.assign(new Error('private stderr and token'), { status: 1 }), 'query failed or returned an invalid response']
  ])('reports a safe admission failure while treating an uninspectable live owner as alive', async (error, reason) => {
    const { inspectRuntimeProcess, requireRuntimeProcessIdentity, runtimeProcessIsAlive } = await windowsInspector()
    vi.mocked(execFileSync).mockImplementation(() => { throw error })
    vi.spyOn(process, 'kill').mockReturnValue(true)
    expect(inspectRuntimeProcess(pid)).toBeUndefined()
    expect(() => requireRuntimeProcessIdentity(pid)).toThrow(reason)
    expect(() => requireRuntimeProcessIdentity(pid)).toThrow('PID still exists or its state is inaccessible')
    expect(() => requireRuntimeProcessIdentity(pid)).not.toThrow('private stderr and token')
    expect(runtimeProcessIsAlive(pid, { startedAt: birth, processIdentity: `win32-v1:${birth}` })).toBe(true)
  })

  it('retries one admission timeout but never a definitive not-found answer', async () => {
    const { requireRuntimeProcessIdentity } = await windowsInspector()
    const timeout = () => { throw Object.assign(new Error(), { code: 'ETIMEDOUT' }) }
    vi.spyOn(process, 'kill').mockReturnValue(true)
    vi.mocked(execFileSync).mockImplementationOnce(timeout).mockReturnValueOnce(birth)
    expect(requireRuntimeProcessIdentity(pid)).toBe(`win32-v1:${birth}`)
    expect(execFileSync).toHaveBeenCalledTimes(2)
    vi.mocked(execFileSync).mockReset().mockImplementation(timeout)
    expect(() => requireRuntimeProcessIdentity(pid)).toThrow('timed out after 3000ms (2 attempts)')
    expect(execFileSync).toHaveBeenCalledTimes(2)
    vi.mocked(execFileSync).mockReset().mockImplementation(() => { throw Object.assign(new Error(), { status: 3 }) })
    expect(() => requireRuntimeProcessIdentity(pid)).toThrow('not found by the identity query')
    expect(execFileSync).toHaveBeenCalledTimes(1)
  })

  it('distinguishes a dead child from a failed query without authorizing admission', async () => {
    const { requireRuntimeProcessIdentity, runtimeProcessIsAlive } = await windowsInspector()
    vi.mocked(execFileSync).mockImplementation(() => { throw Object.assign(new Error(), { status: 3 }) })
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error(), { code: 'ESRCH' }) })
    expect(() => requireRuntimeProcessIdentity(pid)).toThrow('PID is no longer present')
    expect(runtimeProcessIsAlive(pid)).toBe(false)
  })

  it.each(['', 'garbage'])('rejects malformed successful query output %j', async (value) => {
    const { requireRuntimeProcessIdentity } = await windowsInspector()
    vi.mocked(execFileSync).mockReturnValue(value)
    vi.spyOn(process, 'kill').mockReturnValue(true)
    expect(() => requireRuntimeProcessIdentity(pid)).toThrow('invalid response')
  })

  it('retries failed self inspection and caches only its successful birth identity', async () => {
    const { inspectRuntimeProcess } = await windowsInspector()
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw Object.assign(new Error(), { code: 'ETIMEDOUT' }) })
      .mockReturnValue(birth)
    expect(inspectRuntimeProcess(process.pid)).toBeUndefined()
    expect(inspectRuntimeProcess(process.pid)?.identity).toBe(`win32-v1:${birth}`)
    expect(inspectRuntimeProcess(process.pid)?.identity).toBe(`win32-v1:${birth}`)
    expect(execFileSync).toHaveBeenCalledTimes(2)
  })

  it.each(['EPERM', 'EACCES', 'UNKNOWN'])('never reclaims an owner when both queries are inaccessible (%s)', async (code) => {
    const { requireRuntimeProcessIdentity, runtimeProcessIsAlive } = await windowsInspector()
    vi.mocked(execFileSync).mockImplementation(() => { throw Object.assign(new Error(), { status: 1 }) })
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error(), { code }) })
    expect(() => requireRuntimeProcessIdentity(pid)).toThrow('PID still exists or its state is inaccessible')
    expect(runtimeProcessIsAlive(pid, { startedAt: birth, processIdentity: `win32-v1:${birth}` })).toBe(true)
  })

  it('does not cache failure, and still rejects a verified reused PID', async () => {
    const { runtimeProcessIsAlive } = await windowsInspector()
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw Object.assign(new Error(), { code: 'ETIMEDOUT' }) })
      .mockReturnValueOnce('2026-10-18T19:57:50.1234570Z')
    vi.spyOn(process, 'kill').mockReturnValue(true)
    const record = { startedAt: birth, processIdentity: `win32-v1:${birth}` }
    expect(runtimeProcessIsAlive(pid, record)).toBe(true)
    expect(runtimeProcessIsAlive(pid, record)).toBe(false)
  })
})
