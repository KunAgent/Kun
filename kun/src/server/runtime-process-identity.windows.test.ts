import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { inspect } = vi.hoisted(() => ({ inspect: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('../process/windows-startup-native.js', async (original) => ({
  ...await original<typeof import('../process/windows-startup-native.js')>(),
  windowsStartupNative: () => ({ inspectProcess: inspect })
}))
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const pid = 123456
const birth = '2026-10-18T19:57:50.1234560Z'
const alive = (value = birth) => ({ state: 'alive', identity: `win32-v1:${value}`, startedAtMs: Date.parse(value) })

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

describe('Windows native process identity inspection', () => {
  it('retains microsecond identity without starting PowerShell or WMI', async () => {
    const { inspectRuntimeProcess } = await windowsInspector()
    inspect.mockReturnValue(alive())
    expect(inspectRuntimeProcess(pid)).toEqual({ identity: `win32-v1:${birth}`, startedAtMs: Date.parse(birth) })
    expect(inspect).toHaveBeenCalledWith(pid)
    expect(execFileSync).not.toHaveBeenCalled()
  })
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid PID %s before native inspection', async (value) => {
    const { inspectRuntimeProcess } = await windowsInspector()
    expect(inspectRuntimeProcess(value)).toBeUndefined()
    expect(inspect).not.toHaveBeenCalled()
  })
  it('caches only successful self identity, never foreign PIDs or failures', async () => {
    const { inspectRuntimeProcess } = await windowsInspector()
    inspect.mockReturnValueOnce({ state: 'unknown' }).mockReturnValue(alive())
    expect(inspectRuntimeProcess(process.pid)).toBeUndefined()
    expect(inspectRuntimeProcess(process.pid)?.identity).toBe(`win32-v1:${birth}`)
    inspectRuntimeProcess(process.pid)
    expect(inspect).toHaveBeenCalledTimes(2)
    inspectRuntimeProcess(pid)
    inspect.mockReturnValue(alive('2026-10-18T19:57:50.1234570Z'))
    expect(inspectRuntimeProcess(pid)?.identity).toBe('win32-v1:2026-10-18T19:57:50.1234570Z')
    expect(inspect).toHaveBeenCalledTimes(4)
  })
  it.each(['EPERM', 'EACCES', 'UNKNOWN'])('does not reclaim inaccessible owners (%s)', async (code) => {
    const { requireRuntimeProcessIdentity, runtimeProcessIsAlive } = await windowsInspector()
    inspect.mockReturnValue({ state: 'unknown' })
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error(), { code }) })
    expect(() => requireRuntimeProcessIdentity(pid)).toThrow('PID still exists or its state is inaccessible')
    expect(runtimeProcessIsAlive(pid, { startedAt: birth, processIdentity: `win32-v1:${birth}` })).toBe(true)
  })
  it('distinguishes a dead child without authorizing admission', async () => {
    const { requireRuntimeProcessIdentity, runtimeProcessIsAlive } = await windowsInspector()
    inspect.mockReturnValue({ state: 'dead' })
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error(), { code: 'ESRCH' }) })
    expect(() => requireRuntimeProcessIdentity(pid)).toThrow('process was not found')
    expect(runtimeProcessIsAlive(pid)).toBe(false)
  })
  it.each([{ state: 'alive' }, { state: 'alive', identity: '', startedAtMs: 0 },
    { state: 'alive', identity: 'win32-v1:invalid', startedAtMs: Number.NaN }])('rejects incomplete native answers', async (result) => {
    const { requireRuntimeProcessIdentity } = await windowsInspector()
    inspect.mockReturnValue(result)
    expect(() => requireRuntimeProcessIdentity(pid)).toThrow('invalid response')
  })
  it('never includes private native error text in admission diagnostics', async () => {
    const { requireRuntimeProcessIdentity } = await windowsInspector()
    inspect.mockImplementation(() => { throw new Error('private token or path') })
    expect(() => requireRuntimeProcessIdentity(pid)).not.toThrow('private token')
    expect(() => requireRuntimeProcessIdentity(pid)).toThrow('query failed')
    expect(execFileSync).not.toHaveBeenCalled()
  })
  it('preserves installation integrity guidance rather than hiding missing components', async () => {
    const { requireRuntimeProcessIdentity } = await windowsInspector()
    const { WindowsStartupIntegrityError } = await import('../process/windows-startup-native.js')
    inspect.mockImplementation(() => { throw new WindowsStartupIntegrityError() })
    expect(() => requireRuntimeProcessIdentity()).toThrow('Repair or reinstall')
  })
  it('retains unknown owners but rejects a verified reused PID on the next check', async () => {
    const { runtimeProcessIsAlive } = await windowsInspector()
    inspect.mockReturnValueOnce({ state: 'unknown' }).mockReturnValueOnce(alive('2026-10-18T19:57:50.1234570Z'))
    vi.spyOn(process, 'kill').mockReturnValue(true)
    const record = { startedAt: birth, processIdentity: `win32-v1:${birth}` }
    expect(runtimeProcessIsAlive(pid, record)).toBe(true)
    expect(runtimeProcessIsAlive(pid, record)).toBe(false)
  })
})
