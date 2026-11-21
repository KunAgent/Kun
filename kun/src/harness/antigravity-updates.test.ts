import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { HarnessUpdates } from './harness-updates.js'
import { describeHarnessInstallation } from './harness-installation.js'
import { ANTIGRAVITY_DEFINITION } from './providers/antigravity.js'
import type { HarnessStatus } from '../contracts/harness.js'
import type { runHarnessUpdater } from './harness-update-process.js'

const directories: string[] = []
const services: HarnessUpdates[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  vi.unstubAllEnvs()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'kun-agy-updates-'))
  directories.push(home)
  vi.stubEnv('APPDATA', join(home, 'app-data'))
  vi.stubEnv('LOCALAPPDATA', join(home, 'local-app-data'))
  vi.stubEnv('XDG_CONFIG_HOME', join(home, 'config'))
  const binary = process.platform === 'win32' ? 'agy.exe' : 'agy'
  const appSupport = process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Kun')
    : process.platform === 'win32' ? join(home, 'app-data', 'Kun') : join(home, 'config', 'Kun')
  const command = join(appSupport, 'antigravity-cli', binary)
  await mkdir(dirname(command), { recursive: true })
  await writeFile(command, '1.1.13')
  const detect = async (): Promise<HarnessStatus> => ({ harnessId: 'antigravity', installed: 'yes', login: 'unknown',
    version: await readFile(command, 'utf8'), resolvedCommand: command, checkedAt: '' })
  const run = vi.fn<typeof runHarnessUpdater>(async () => { await writeFile(command, '1.5.9') })
  const verify = vi.fn(async () => ({ version: '1.5.9', models: [] }))
  const release = vi.fn()
  const service = new HarnessUpdates({
    definition: () => ANTIGRAVITY_DEFINITION, home, dataDir: join(home, 'runtime-data'), detect,
    latest: async () => '1.5.9', candidate: async () => undefined, run, verify,
    inUse: () => false, beginMaintenance: () => release, invalidate: vi.fn()
  })
  services.push(service)
  return { home, command, binary, service, detect, run, verify, release }
}

it('upgrades the legacy GUI-managed binary with its own updater and verifies it before activation', async () => {
  const f = await fixture()
  const state = await f.service.check('antigravity')
  expect(state).toMatchObject({ status: 'available', latestVersion: '1.5.9', canUpdate: true,
    current: { source: 'native', path: f.command, version: '1.1.13' } })
  expect(f.run).not.toHaveBeenCalled()
  const started = await f.service.start('antigravity', 'update', state.current.fingerprint)
  await vi.waitFor(async () => expect((await f.service.check('antigravity')).job).toMatchObject({
    status: 'ready', version: '1.5.9', activationPath: f.command
  }))
  expect(f.run).toHaveBeenCalledOnce()
  expect(f.run.mock.calls[0]?.[0]).toMatchObject({ command: f.command, args: ['update'] })
  expect(f.verify).toHaveBeenCalledWith('antigravity', f.command, expect.any(AbortSignal))
  expect(f.release).not.toHaveBeenCalled()
  await f.service.activated('antigravity', started.job!.id)
  expect((await f.service.check('antigravity')).job?.status).toBe('completed')
  expect(f.release).toHaveBeenCalledOnce()
})

it('keeps a failed ACP verification out of the activation path', async () => {
  const f = await fixture()
  f.verify.mockRejectedValueOnce(new Error('ACP initialize failed'))
  const state = await f.service.check('antigravity')
  await f.service.start('antigravity', 'update', state.current.fingerprint)
  await vi.waitFor(async () => expect((await f.service.check('antigravity')).job).toMatchObject({
    status: 'failed', error: 'ACP initialize failed'
  }))
  expect((await f.service.check('antigravity')).job?.activationPath).toBeUndefined()
  expect(f.release).toHaveBeenCalledOnce()
})

it('recognizes relocated Kun installs and official native paths while leaving arbitrary paths alone', async () => {
  const f = await fixture()
  const dataDir = join(f.home, 'relocated-runtime')
  const native = process.platform === 'win32' ? join(f.home, 'local-app-data', 'agy', 'bin', f.binary)
    : join(f.home, '.local', 'bin', f.binary)
  const classify = (path: string) => describeHarnessInstallation('antigravity', {
    harnessId: 'antigravity', installed: 'yes', login: 'unknown', resolvedCommand: path, checkedAt: ''
  }, f.home, dataDir)
  expect(await classify(native)).toMatchObject({ source: 'native' })
  expect(await classify(join(dataDir, 'provider-cli', 'antigravity', f.binary))).toMatchObject({ source: 'native' })
  expect(await classify(join(f.home, 'custom', f.binary))).toMatchObject({ source: 'custom' })
  expect(await classify(join(f.home, 'Editor.app', 'Contents', f.binary))).toMatchObject({ source: 'application' })
})
