import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const files = vi.hoisted(() => new Map<string, string>())
vi.mock('node:fs', () => ({
  existsSync: (path: string) => files.has(String(path).replaceAll('\\', '/')),
  readFileSync: (path: string) => {
    const value = files.get(String(path).replaceAll('\\', '/'))
    if (value === undefined) throw new Error('missing')
    return value
  }
}))
const resources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
const root = `/installed/app.asar.unpacked/kun/dist/native/win32-${process.arch}`
beforeEach(() => {
  vi.resetModules()
  files.clear()
  Object.defineProperty(process, 'resourcesPath', { value: '/installed', configurable: true })
  files.set('/installed/app.asar', '')
  const hashes: Record<string, string> = {}
  for (const name of ['kun_windows_startup.node', 'kun-owned-launcher.exe']) {
    files.set(`${root}/${name}`, name)
    hashes[name] = createHash('sha256').update(name).digest('hex')
  }
  files.set(`${root}/manifest.json`, JSON.stringify({ version: 1, arch: process.arch, files: hashes }))
})
afterEach(() => {
  if (resources) Object.defineProperty(process, 'resourcesPath', resources)
  else delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
})
describe('packaged startup integrity', () => {
  it('resolves only bundled resources, without a temporary compiler cache', async () => {
    const { windowsOwnedLauncherPath } = await import('./windows-startup-native.js')
    expect(windowsOwnedLauncherPath().replaceAll('\\', '/')).toBe(`${root}/kun-owned-launcher.exe`)
  })
  it.each(['manifest.json', 'kun_windows_startup.node', 'kun-owned-launcher.exe'])('rejects missing %s', async (name) => {
    files.delete(`${root}/${name}`)
    const { windowsStartupDirectory } = await import('./windows-startup-native.js')
    expect(windowsStartupDirectory).toThrow('Repair or reinstall')
  })
  it.each(['kun_windows_startup.node', 'kun-owned-launcher.exe'])('rejects hash mismatch: %s', async (name) => {
    files.set(`${root}/${name}`, 'tampered')
    const { windowsStartupDirectory } = await import('./windows-startup-native.js')
    expect(windowsStartupDirectory).toThrow('Repair or reinstall')
  })
  it('rejects architecture or format mismatches', async () => {
    files.set(`${root}/manifest.json`, JSON.stringify({ version: 999, arch: 'other' }))
    const { windowsStartupDirectory } = await import('./windows-startup-native.js')
    expect(windowsStartupDirectory).toThrow('Repair or reinstall')
  })
})
