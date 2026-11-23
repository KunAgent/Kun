import { describe, expect, it, vi } from 'vitest'
import { ATTACHMENT_PREVIEW_CAPABILITY, RequestBudget, type Frame } from '@kun/remote-protocol'
import { dispatchMobileInvoke } from './invoke-dispatch'

const authority = { id: 'grant', syncKey: 'grant', scopes: ['personal' as const] }
function fixture(files?: (...args: any[]) => Promise<unknown>) {
  const sent: Frame[] = [], filePeers = new Set<string>()
  const request = vi.fn(async () => ({ ok: true, status: 200, body: JSON.stringify({ capabilities: ['attachments'] }) }))
  const deps = { link: { lease: async () => ({ request }), files }, owner: 'account', api: {}, filePeers,
    requestBudget: new RequestBudget(), totalRequestBudget: new RequestBudget(), subscriptions: {},
    authorizationRemaining: () => 60000, terminalAuthorizationRemaining: () => 60000,
    send: (frame: Frame) => { sent.push(frame) } } as unknown as Parameters<typeof dispatchMobileInvoke>[4]
  const invoke = (method: string, id: string, params: Record<string, unknown> = {}) => dispatchMobileInvoke({
    kind: 'invoke', id, payload: { method, params, requestId: id, expiresAt: Date.now() + 60000 }
  }, 'phone', authority, () => true, deps)
  return { sent, filePeers, request, invoke }
}
describe('attachment preview dispatch', () => {
  it('advertises previews only when this host has the file handler', async () => {
    for (const supported of [false, true]) {
      const h = fixture(supported ? async () => ({}) : undefined)
      await h.invoke('catalog.get', 'catalog')
      expect(h.sent[0].payload.capabilities.includes(ATTACHMENT_PREVIEW_CAPABILITY)).toBe(supported)
    }
  })
  it('keeps an original export available while the same phone has a background preview in flight', async () => {
    let started!: () => void, finish!: (value: unknown) => void
    const waiting = new Promise<void>(resolve => { started = resolve })
    const files = vi.fn(async (_scope, call) => call.method === 'attachment.preview'
      ? new Promise(resolve => { finish = resolve; started() }) : { receipt: { status: 'applied', result: {} } })
    const h = fixture(files), params = { attachmentId: 'att_' + 'a'.repeat(24), threadId: 'thread' }
    const preview = h.invoke('attachment.preview', 'preview', params)
    await waiting
    await h.invoke('attachment.export', 'export', params)
    expect(files).toHaveBeenCalledTimes(2)
    expect(h.sent.find(frame => frame.id === 'export')?.payload.error).toBeUndefined()
    finish({}); await preview
    expect(h.filePeers.size).toBe(0)
  })
})
