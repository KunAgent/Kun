import { describe, expect, it, vi } from 'vitest'
import { RequestBudget } from '@kun/remote-protocol'
import { MobileLinkAuthorities } from './authorities'
import { computerDesktopScopes } from '../../shared/mobile-link-scopes'
import { dispatchMobileInvoke } from './invoke-dispatch'
vi.mock('../control-host/admission', () => ({ admitControlOperation: () => () => {} }))

describe('computer desktop authorization', () => {
  it('never inherits personal or unified phone defaults, including after a permission reset', () => {
    const store = new MobileLinkAuthorities(), grant = { id: 'grant', controllerId: 'mac', purpose: 'desktop' as const }
    store.sync([grant], ['personal', 'desktop.view', 'desktop.control'])
    expect(store.scopes('mac', 'grant')).toEqual([])
    store.set('mac', 'grant', ['desktop.view', 'desktop.control'])
    expect(store.scopes('mac', 'grant')).toEqual(['desktop.view', 'desktop.control'])
    expect(() => store.set('mac', 'grant', ['personal'])).toThrow('INVALID_SCOPES')
    store.sync([{ ...grant, id: 'replacement' }], ['personal','desktop.view','desktop.control'])
    expect(store.scopes('mac', 'replacement')).toEqual([])
    expect(() => computerDesktopScopes(['desktop.control'])).toThrow('INVALID_SCOPES')
    store.sync([{ id: 'phone-grant', controllerId: 'phone' }], ['personal','desktop.view','desktop.control'])
    expect(store.scopes('phone', 'phone-grant')).toEqual(['personal','desktop.view','desktop.control'])
  })
  it('applies explicit computer host consent without replacing per-computer restrictions', () => {
    const store = new MobileLinkAuthorities(), grant = { id: 'grant', controllerId: 'mac', purpose: 'desktop' as const }
    const defaults = ['desktop.view', 'desktop.control'] as const
    store.sync([grant, { id: 'phone-grant', controllerId: 'phone' }], undefined, [...defaults])
    expect(store.scopes('mac', 'grant')).toEqual(defaults)
    expect(store.scopes('phone', 'phone-grant')).toEqual(['personal'])
    store.set('mac', 'grant', ['desktop.view'])
    store.sync([grant], undefined, [...defaults])
    expect(store.scopes('mac', 'grant')).toEqual(['desktop.view'])
    store.set('mac', 'grant', [])
    store.sync([grant], undefined, [...defaults])
    expect(store.scopes('mac', 'grant')).toEqual([])
  })
  it('rejects workbench operations before runtime acquisition even with full desktop control', async () => {
    const lease = vi.fn(), send = vi.fn()
    const deps = { link: { lease }, owner: 'owner', hostId: 'host', filePeers: new Set(), requestBudget: new RequestBudget(), totalRequestBudget: new RequestBudget(),
      subscriptions: {}, authorizationRemaining: () => 60000, terminalAuthorizationRemaining: () => 60000, send } as any
    for (const [method, params] of [['catalog.get', {}], ['code.history', { threadId: 'thread' }], ['terminal.open', { startId: 'start', origin: { kind: 'code', id: 'thread' } }], ['project.files.list', { projectId: 'project' }]] as const) {
      await dispatchMobileInvoke({ kind: 'invoke', id: 'request', payload: { method, params, requestId: 'request', expiresAt: Date.now()+10000 } }, 'mac',
        { id: 'authority', syncKey: 'sync', purpose: 'desktop', scopes: ['desktop.view','desktop.control'] }, () => true, deps)
      expect(send.mock.calls.at(-1)?.[0].payload.error.code).toBe('REMOTE_SCOPE_REQUIRED')
    }
    expect(lease).not.toHaveBeenCalled()
  })
})
