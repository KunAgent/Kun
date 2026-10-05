import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { HarnessUpdates } from './harness-updates.js'
import { harnessExecutableIdentity } from './harness-executable-identity.js'
import type { HarnessStatus } from '../contracts/harness.js'
import { BUILTIN_HARNESSES } from './builtin-harnesses.js'
import type { runHarnessUpdater } from './harness-update-process.js'
const roots: string[] = []
afterEach(async () => { vi.useRealTimers(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-agent-update-')); roots.push(root)
  const old = join(root, 'old'), next = join(root, 'new'); await writeFile(old, 'old'); await writeFile(next, 'new')
  let path = old, version = '2.1.220', busy = false, blocked = false
  const run = vi.fn<typeof runHarnessUpdater>(async () => undefined)
  const latest = vi.fn(async () => '2.1.281')
  const verify = vi.fn(async () => ({ version: '2.1.281', models: ['new-model'] }))
  const invalidate = vi.fn()
  const service = new HarnessUpdates({
    definition: (id) => BUILTIN_HARNESSES.find((entry) => entry.id === id), home: root,
    detect: async (id): Promise<HarnessStatus> => ({ harnessId: id, installed: 'yes', login: 'signed-in', checkedAt: '', resolvedCommand: path, version }),
    describe: async (_id, status) => ({ source: 'kun-bundled', path: status.resolvedCommand, version: status.version,
      fingerprint: harnessExecutableIdentity(status.resolvedCommand) }),
    candidate: async () => ({ source: 'native', path: next, version: '2.1.281', fingerprint: harnessExecutableIdentity(next) }),
    latest, run, verify, resolve: async () => '/usr/bin/npm', invalidate,
    inUse: () => busy, beginMaintenance: () => { blocked = true; return () => { blocked = false } }
  })
  return { service, run, latest, verify, invalidate, old, next, root,
    setBusy: (value: boolean) => { busy = value }, blocked: () => blocked,
    activate: (value = next) => { path = value; version = '2.1.281' } }
}
it('checks metadata once per day and never launches an updater on a check', async () => {
  const f = await fixture()
  expect(await f.service.check('claude-code')).toMatchObject({ status: 'available', current: { path: f.old, version: '2.1.220' }, candidate: { path: f.next }, canUpdate: false })
  await f.service.check('claude-code')
  expect(f.latest).toHaveBeenCalledTimes(1); expect(f.run).not.toHaveBeenCalled()
})
it('keeps maintenance authority until the verified executable is actually activated', async () => {
  const f = await fixture(); const checked = await f.service.check('claude-code')
  await f.service.start('claude-code', 'use-local', checked.current.fingerprint)
  await vi.waitFor(async () => expect((await f.service.check('claude-code')).job?.status).toBe('ready'))
  const state = await f.service.check('claude-code')
  expect(f.blocked()).toBe(true); expect(f.run).not.toHaveBeenCalled()
  await expect(f.service.activated('claude-code', state.job!.id)).rejects.toThrow('not switched')
  f.activate()
  await f.service.activated('claude-code', state.job!.id)
  expect(f.blocked()).toBe(false); expect(f.invalidate).toHaveBeenCalled()
})
it('waits for active turns and cancels without executing an updater or interrupting the turn', async () => {
  const f = await fixture(); f.setBusy(true)
  const checked = await f.service.check('claude-code')
  const a = await f.service.start('claude-code', 'use-local', checked.current.fingerprint)
  const b = await f.service.start('claude-code', 'use-local', checked.current.fingerprint)
  expect(a.job?.id).toBe(b.job?.id); expect(f.verify).not.toHaveBeenCalled()
  f.service.cancel('claude-code', a.job!.id)
  await vi.waitFor(async () => expect((await f.service.check('claude-code')).job?.status).toBe('cancelled'))
  expect(f.blocked()).toBe(false); expect(f.verify).not.toHaveBeenCalled()
})
it('stages an exact official package and preserves the old selection on verification failure', async () => {
  const f = await fixture(); f.verify.mockRejectedValueOnce(new Error('incompatible'))
  const checked = await f.service.check('claude-code')
  await f.service.start('claude-code', 'managed', checked.current.fingerprint)
  await vi.waitFor(async () => expect((await f.service.check('claude-code')).job?.status).toBe('failed'))
  expect(f.run.mock.calls[0]?.[0]).toMatchObject({ command: '/usr/bin/npm', args: expect.arrayContaining([
    '@anthropic-ai/claude-code@2.1.281', '--prefix', join(f.root, '.kun', 'agents', 'claude-code', 'versions', '2.1.281')
  ]) })
  expect(f.blocked()).toBe(false)
})
it('rejects changed executables and reports failed network checks as unknown', async () => {
  const f = await fixture(); const checked = await f.service.check('claude-code')
  await writeFile(f.old, 'replaced binary')
  await expect(f.service.start('claude-code', 'managed', checked.current.fingerprint)).rejects.toThrow('changed')
  f.latest.mockRejectedValueOnce(new Error('offline'))
  expect(await f.service.check('claude-code', true)).toMatchObject({ status: 'unknown', error: expect.stringContaining('offline') })
  expect(f.run).not.toHaveBeenCalled()
})
