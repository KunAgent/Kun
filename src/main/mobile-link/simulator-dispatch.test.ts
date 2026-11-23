import { expect, it, vi } from 'vitest'
import { RequestBudget, hasOperation, type Frame } from '@kun/remote-protocol'
import { dispatchMobileInvoke } from './invoke-dispatch'
import type { LinkDependencies } from './service-dependencies'
import type { MobileSubscriptions } from './subscriptions'
import { RemoteSimulatorService, type SimulatorBackend } from '../remote-simulator/service'

const udid = '4C58782A-1055-48FC-910C-3A12AE320426'
it('routes simulator control through the authenticated host without a durable runtime mutation', async () => {
  const backend: SimulatorBackend = { supported: () => true, available: async () => true,
    list: async () => [{ udid, name: 'QA', runtime: 'iOS', state: 'Booted' }], boot: async () => {}, input: async () => {},
    stream: async () => ({ frame: async () => ({ image: 'data:image/jpeg;base64,/9j/AA==', width: 402, height: 874, capturedAt: Date.now() }), stop: async () => {} }) }
  const authorize = vi.fn(async () => {}), simulator = new RemoteSimulatorService(backend, authorize)
  const frames: Frame[] = [], lease = vi.fn(async () => { throw Error('UNEXPECTED_RUNTIME_MUTATION') })
  const deps = { owner: 'owner', hostId: 'host', link: { simulator, lease } as unknown as LinkDependencies,
    filePeers: new Set<string>(), requestBudget: new RequestBudget(), totalRequestBudget: new RequestBudget(),
    subscriptions: {} as MobileSubscriptions, authorizationRemaining: () => 10000, terminalAuthorizationRemaining: () => 10000,
    send: (frame: Frame) => { frames.push(frame) } }
  const authority = { id: 'grant', syncKey: 'stable', scopes: ['personal', 'desktop.view', 'desktop.control'] as const }
  const catalog = { capabilities: [], capabilityDescriptors: simulator.descriptors(authority.scopes) }
  expect(hasOperation(catalog, 'simulator.start')).toBe(true)
  const call = (id: string, method: string, params: unknown): Frame => ({ kind: 'invoke', id,
    payload: { method, params, requestId: id, expiresAt: Date.now() + 15000 } })
  try {
    await dispatchMobileInvoke(call('start', 'simulator.start', { origin: { kind: 'code', id: 'thread' }, startId: 'view', udid }), 'phone', { ...authority, scopes: [...authority.scopes] }, () => true, deps)
    const started = frames.find(frame => frame.id === 'start')!.payload
    expect(started.sessionId).toBeTypeOf('string'); expect(started.receipt).toBeUndefined()
    expect(lease).not.toHaveBeenCalled()
    expect(authorize).toHaveBeenCalledWith({ kind: 'code', id: 'thread' }, expect.objectContaining({ accountId: 'owner', deviceId: 'phone', authorizationId: 'grant' }))
    await dispatchMobileInvoke(call('denied', 'simulator.input', { sessionId: started.sessionId, sequence: 1, input: { kind: 'button', button: 'home' } }),
      'phone', { ...authority, scopes: ['personal', 'desktop.view'] }, () => true, deps)
    expect(frames.find(frame => frame.id === 'denied')!.payload.error.code).toBe('REMOTE_SCOPE_REQUIRED')
  } finally { await simulator.stopAll() }
})
