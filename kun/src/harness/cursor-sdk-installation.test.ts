import { afterEach, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkCursorSdkInstallation } from './cursor-sdk-installation.js'
import { probeCursorSdkReadiness } from './cursor-sdk-readiness.js'

const directories: string[] = []
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })
async function fixture(platform: 'linux' | 'win32' = 'linux') {
  const root = await mkdtemp(join(tmpdir(), 'cursor-sdk-installation-'))
  directories.push(root)
  const sdk = join(root, 'sdk')
  const native = join(root, 'native')
  await mkdir(join(sdk, 'dist', 'cjs'), { recursive: true })
  await mkdir(join(native, 'bin'), { recursive: true })
  for (const dir of [sdk, native]) await writeFile(join(dir, 'package.json'), '{"version":"1.0.24"}')
  const helpers = ['rg', 'cursorsandbox'].map((name) => join(native, 'bin', name + (platform === 'win32' ? '.exe' : '')))
  for (const path of helpers) await writeFile(path, 'fixture', { mode: 0o700 })
  return { native, helpers, input: { platform, arch: 'x64', resolve: (id: string) => {
    if (id === '@cursor/sdk') return join(sdk, 'dist', 'cjs', 'index.js')
    if (id === `@cursor/sdk-${platform}-x64/package.json`) return join(native, 'package.json')
    throw new Error('Unexpected module')
  } } }
}

it.each(['linux', 'win32'] as const)('checks matching %s native helpers without executing them', async (platform) => {
  const f = await fixture(platform)
  expect(await checkCursorSdkInstallation(f.input)).toBe('1.0.24')
})
it('rejects missing platform helpers and mismatched package versions', async () => {
  const f = await fixture()
  await writeFile(join(f.native, 'package.json'), '{"version":"1.0.23"}')
  await expect(checkCursorSdkInstallation(f.input)).rejects.toThrow('version mismatch')
  await writeFile(join(f.native, 'package.json'), '{"version":"1.0.24"}')
  await rm(f.helpers[1]!)
  await expect(checkCursorSdkInstallation(f.input)).rejects.toThrow()
})
it.skipIf(process.platform === 'win32')('rejects non-executable POSIX helpers', async () => {
  const f = await fixture()
  await chmod(f.helpers[0]!, 0o600)
  await expect(checkCursorSdkInstallation(f.input)).rejects.toThrow()
})

it('checks the actual installed SDK and platform helpers without network or an agent session', async () => {
  const network = (): never => { throw new Error('Unexpected network request during local SDK readiness') }
  const guards = [vi.spyOn(http, 'request'), vi.spyOn(http, 'get'), vi.spyOn(https, 'request'),
    vi.spyOn(https, 'get'), vi.spyOn(net, 'connect'), vi.spyOn(net, 'createConnection'), vi.spyOn(globalThis, 'fetch')]
  for (const guard of guards) guard.mockImplementation(network)
  try {
    const result = await probeCursorSdkReadiness(AbortSignal.timeout(10_000))
    expect(result).toMatchObject({ ok: true, supported: false, protocol: 'cursor-sdk-local-api', authentication: 'unverified' })
    expect(result.agent?.version).toMatch(/^\d+\.\d+\.\d+/)
    for (const guard of guards) expect(guard).not.toHaveBeenCalled()
  } finally { for (const guard of guards) guard.mockRestore() }
})
