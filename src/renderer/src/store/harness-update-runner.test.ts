// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaultKunHarnessSettings } from '@shared/app-settings-kun-harness'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import type { HarnessUpdateState } from '../../../../kun/src/contracts/harness-update'

const f = vi.hoisted(() => ({ request: vi.fn(), load: vi.fn(async () => undefined), models: vi.fn(async () => undefined),
  invalidate: vi.fn(), wait: vi.fn(async () => undefined), rows: [] as unknown[] }))
vi.mock('../agent/runtime-client', () => ({ rendererRuntimeClient: { runtimeRequest: f.request } }))
vi.mock('./harness-store', () => ({ loadHarnesses: f.load, loadHarnessModels: f.models, invalidateHarnessModels: f.invalidate,
  applyHarnessEnablementSettings: vi.fn(), harnessIdsWithChangedLaunchSettings: () => [],
  useHarnessStore: { getState: () => ({ rows: f.rows }) } }))
vi.mock('../components/ade/agent-enablement-settings', () => ({ waitForAgentSettings: f.wait }))
import { receiveHarnessUpdate, useHarnessUpdateStore } from './harness-update-store'
import { cancelAgentUpdate, dismissAgentUpdate, resetAgentUpdateRunner, setAgentUpdateSettingsPort, startAgentUpdate,
  useAgentUpdateRunner } from './harness-update-runner'

const initial: HarnessUpdateState = { harnessId: 'claude-code', current: { path: '/old', source: 'kun-bundled', version: '2.1.220', fingerprint: 'old' },
  candidate: { path: '/new', source: 'native', version: '2.1.281', fingerprint: 'new' }, status: 'available', latestVersion: '2.1.281',
  channel: 'latest', canUpdate: true, canInstallManaged: true }
const ready: HarnessUpdateState = { ...initial, job: { id: 'job', action: 'use-local', status: 'ready', startedAt: '2026-10-09T00:00:00.000Z',
  output: '', previousPath: '/old', activationPath: '/new', activationFingerprint: 'new', version: '2.1.281' } }
const ok = (body: unknown) => ({ ok: true, status: 200, body: JSON.stringify(body) })
let settings: KunHarnessSettingsV1
const writes: Array<string | undefined> = []
const item = () => useAgentUpdateRunner.getState().items['claude-code']

beforeEach(() => {
  settings = defaultKunHarnessSettings()
  writes.length = 0
  setAgentUpdateSettingsPort({
    read: async () => settings,
    write: async (patch) => { settings = { ...settings, ...patch }; writes.push(settings.providers['claude-code']?.command); return settings }
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  resetAgentUpdateRunner()
  setAgentUpdateSettingsPort()
  useHarnessUpdateStore.setState({ entries: {} })
})

it('switches to the verified executable only after the runtime re-confirms the plan', async () => {
  f.request.mockImplementation(async (path: string) => ok(path.endsWith('/activate') ? { ok: true } : ready))
  receiveHarnessUpdate(ready)
  await vi.waitFor(() => expect(item()?.phase).toBe('completed'))
  expect(writes).toEqual(['/new'])
  expect(f.request.mock.calls[0]![0]).toBe('/v1/harnesses/claude-code/updates')
  expect(f.request.mock.calls.some(([path]) => String(path).endsWith('/activate'))).toBe(true)
  expect(f.invalidate).toHaveBeenCalledWith('claude-code')
  expect(f.models).toHaveBeenCalledWith('claude-code', true)
  expect(item()).toMatchObject({ version: '2.1.281', canRollback: true })
})

it('never switches executables on the basis of a stale notice', async () => {
  f.request.mockResolvedValue(ok(initial))
  receiveHarnessUpdate({ ...ready, job: { ...ready.job!, id: 'stale-job', activationPath: '/unverified', activationFingerprint: 'fake' } })
  await vi.waitFor(() => expect(f.request).toHaveBeenCalled())
  await vi.waitFor(() => expect(item()).toBeUndefined())
  expect(writes).toEqual([])
})

it('restores the previous executable and releases maintenance when the switch fails', async () => {
  f.request.mockImplementation(async (path: string) => String(path).endsWith('/activate')
    ? { ok: false, status: 409, body: JSON.stringify({ message: 'Native account unavailable' }) }
    : ok(String(path).endsWith('/cancel') ? { ok: true } : ready))
  receiveHarnessUpdate(ready)
  await vi.waitFor(() => expect(item()?.phase).toBe('failed'))
  expect(writes).toEqual(['/new', '/old'])
  expect(f.request.mock.calls.some(([path]) => String(path).endsWith('/cancel'))).toBe(true)
  expect(item()).toMatchObject({ error: 'Native account unavailable', failedAt: 'switching' })
})

it('shows progress at the click, then keeps polling and switches over with no page mounted', async () => {
  vi.useFakeTimers()
  receiveHarnessUpdate(initial)
  const running: HarnessUpdateState = { ...initial, job: { id: 'run', action: 'update', status: 'running', startedAt: new Date().toISOString(), output: 'Downloading…\n' } }
  let server: HarnessUpdateState = running
  f.request.mockImplementation(async (path: string) => {
    if (String(path).endsWith('/start')) return ok(running)
    if (String(path).endsWith('/activate')) return ok({ ok: true })
    return ok(server)
  })
  const started = startAgentUpdate('claude-code', 'update')
  // The item exists before any request resolves: the page never goes blank.
  expect(item()).toMatchObject({ phase: 'starting', action: 'update', version: '2.1.281', previousVersion: '2.1.220' })
  await started
  expect(item()?.phase).toBe('running')
  server = { ...initial, job: { ...running.job!, status: 'verifying' } }
  await vi.advanceTimersByTimeAsync(1_500)
  await vi.waitFor(() => expect(item()?.phase).toBe('verifying'))
  server = { ...initial, job: { ...running.job!, status: 'ready', previousPath: '/old', activationPath: '/old', activationFingerprint: 'old2', version: '2.1.281' } }
  await vi.advanceTimersByTimeAsync(1_500)
  await vi.waitFor(() => expect(item()?.phase).toBe('completed'))
  expect(writes).toEqual(['/old'])
  expect(item()?.canRollback).toBe(false)
  dismissAgentUpdate('claude-code')
  expect(item()).toBeUndefined()
})

it('explains a changed installation and re-reads it instead of reporting a bare mismatch', async () => {
  receiveHarnessUpdate(initial)
  f.request.mockImplementation(async (path: string) => String(path).endsWith('/start')
    ? { ok: false, status: 409, body: JSON.stringify({ message: 'Agent installation changed; check updates again' }) } : ok(initial))
  await startAgentUpdate('claude-code', 'managed')
  const start = f.request.mock.calls.find(([path]) => String(path).endsWith('/start'))!
  expect(JSON.parse(start[2])).toEqual({ action: 'managed', expectedFingerprint: 'old' })
  expect(item()).toMatchObject({ phase: 'failed', error: 'agentUpdate.installationChanged', failedAt: 'starting' })
})

it('cancels a running job and forgets it', async () => {
  receiveHarnessUpdate(initial)
  const running: HarnessUpdateState = { ...initial, job: { id: 'run', action: 'update', status: 'running', startedAt: new Date().toISOString(), output: '' } }
  f.request.mockImplementation(async (path: string) => ok(String(path).endsWith('/cancel') ? { ok: true } : running))
  await startAgentUpdate('claude-code', 'update')
  await cancelAgentUpdate('claude-code')
  expect(f.request.mock.calls.some(([path, , body]) => String(path).endsWith('/cancel') && JSON.parse(body).jobId === 'run')).toBe(true)
  expect(item()).toBeUndefined()
  // A later status read that still shows the cancelled job does not bring it back.
  receiveHarnessUpdate({ ...running, checkedAt: 'later' })
  expect(item()).toBeUndefined()
})
