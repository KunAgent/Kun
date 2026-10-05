import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessUpdates, type HarnessUpdatesDeps } from './harness-updates.js'
import { BUILTIN_HARNESSES } from './builtin-harnesses.js'
import { harnessExecutableIdentity } from './harness-executable-identity.js'
import type { HarnessInstallation } from '../contracts/harness-update.js'

const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(source: HarnessInstallation['source'] = 'npm') {
  const home = await mkdtemp(join(tmpdir(), 'kun-agent-updates-'))
  folders.push(home)
  const command = join(home, 'codex')
  await writeFile(command, 'test executable identity')
  const current = { path: command, version: '0.160.0', source,
    fingerprint: harnessExecutableIdentity(command) }
  const release = vi.fn()
  const deps = {
    definition: () => BUILTIN_HARNESSES.find((item) => item.id === 'codex'),
    detect: vi.fn(async () => ({ harnessId: 'codex', installed: 'yes' as const,
      login: 'unknown' as const, checkedAt: '', resolvedCommand: command, version: current.version })),
    describe: vi.fn(async () => ({ ...current, prefix: home })),
    candidate: vi.fn(async () => undefined),
    latest: vi.fn(async () => '0.161.0'),
    beginMaintenance: vi.fn(() => release),
    inUse: vi.fn(() => false),
    invalidate: vi.fn(),
    verify: vi.fn(async () => ({ version: '0.161.0', models: ['native-model'] })),
    run: vi.fn(async () => undefined),
    resolve: vi.fn(async () => '/test/npm'),
    home
  } satisfies HarnessUpdatesDeps
  return { deps, current, command, release, updates: new HarnessUpdates(deps) }
}

describe('Agent update boundaries', () => {
  it('checks and caches versions without installing, starting an Agent, or verifying an account', async () => {
    const f = await fixture()
    const states = await Promise.all([f.updates.check('codex'), f.updates.check('codex')])
    expect(states[0]).toMatchObject({ status: 'available', latestVersion: '0.161.0' })
    await f.updates.check('codex')
    expect(f.deps.latest).toHaveBeenCalledTimes(1)
    expect(f.deps.run).not.toHaveBeenCalled()
    expect(f.deps.verify).not.toHaveBeenCalled()
    expect(f.deps.beginMaintenance).not.toHaveBeenCalled()
  })

  it('keeps application-owned binaries outside the in-place updater', async () => {
    const f = await fixture('application')
    const state = await f.updates.check('codex')
    expect(state).toMatchObject({ canUpdate: false, ownerUpdateRequired: true, canInstallManaged: true })
    await expect(f.updates.start('codex', 'update', f.current.fingerprint)).rejects.toThrow('unavailable')
    expect(f.deps.run).not.toHaveBeenCalled()
  })

  it('requires a fresh check when the executable changes after the user reviewed it', async () => {
    const f = await fixture()
    await f.updates.check('codex')
    await writeFile(f.command, 'a different executable')
    await expect(f.updates.start('codex', 'managed', f.current.fingerprint)).rejects.toThrow('changed')
    expect(f.deps.run).not.toHaveBeenCalled()
  })

  it('waits for active work, verifies a managed install, and requires activation before releasing maintenance', async () => {
    const f = await fixture()
    f.deps.inUse.mockReturnValue(true)
    const started = await f.updates.start('codex', 'managed', f.current.fingerprint)
    expect(started.job?.status).toBe('waiting')
    expect(f.deps.run).not.toHaveBeenCalled()
    f.deps.inUse.mockReturnValue(false)
    await vi.waitFor(async () => expect((await f.updates.check('codex')).job?.status).toBe('ready'))
    expect(f.deps.run).toHaveBeenCalledWith(expect.objectContaining({
      command: '/test/npm', args: expect.arrayContaining(['--save-exact', '@openai/codex@0.161.0'])
    }))
    expect(f.deps.verify).toHaveBeenCalledTimes(1)
    expect(f.release).not.toHaveBeenCalled()
    await expect(f.updates.activated('codex', started.job!.id)).rejects.toThrow('not switched')
    f.updates.cancel('codex', started.job!.id)
    expect(f.release).toHaveBeenCalledOnce()
  })

  it('fails verification without activating a managed replacement', async () => {
    const f = await fixture()
    f.deps.verify.mockRejectedValueOnce(new Error('protocol handshake failed'))
    await f.updates.start('codex', 'managed', f.current.fingerprint)
    await vi.waitFor(async () => expect((await f.updates.check('codex')).job).toMatchObject({
      status: 'failed', error: 'protocol handshake failed'
    }))
    expect(f.release).toHaveBeenCalledOnce()
    expect((await f.updates.check('codex')).current.path).toBe(f.command)
  })

  it('reports an unavailable update service as unknown, not up to date', async () => {
    const f = await fixture()
    f.deps.latest.mockRejectedValueOnce(new Error('offline'))
    expect(await f.updates.check('codex')).toMatchObject({ status: 'unknown', error: expect.stringContaining('offline') })
    expect(f.deps.run).not.toHaveBeenCalled()
  })
})
