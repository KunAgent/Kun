import { describe, expect, it, vi } from 'vitest'
import type { AcpConnection } from './acp-connection.js'
import { applyDevinSessionPermission } from './devin-session-permissions.js'

const modern = () => ({ sessionId: 'fixture', configOptions: [{ id: 'mode', name: 'Session Mode', category: 'mode',
  type: 'select' as const, currentValue: 'accept-edits', options: ['accept-edits', 'smart', 'ask', 'plan', 'bypass'].map((value) => ({ value, name: value })) }] })
describe('Devin 3000.11.3 session modes', () => {
  it('uses the advertised read-only mode for legacy normal requests instead of failing before the prompt', async () => {
    const request = vi.fn(async () => ({})), conn = { rpc: { request } } as unknown as AcpConnection
    await applyDevinSessionPermission(conn, modern(), 'normal')
    expect(request).toHaveBeenCalledWith('session/set_config_option', { sessionId: 'fixture', configId: 'mode', value: 'ask' })
    await applyDevinSessionPermission(conn, modern(), 'bypass')
    expect(request).toHaveBeenLastCalledWith('session/set_config_option', { sessionId: 'fixture', configId: 'mode', value: 'bypass' })
  })
  it('rejects a server that acknowledges a different wider mode', async () => {
    const request = vi.fn(async () => ({ configOptions: modern().configOptions }))
    await expect(applyDevinSessionPermission({ rpc: { request } } as unknown as AcpConnection, modern(), 'ask'))
      .rejects.toMatchObject({ code: 'policy_denied', message: expect.stringContaining('did not apply') })
  })
  it('keeps explicit read-only requests fail-closed against older normal-only sessions', async () => {
    const request = vi.fn(async () => ({})), conn = { rpc: { request } } as unknown as AcpConnection
    const session = { sessionId: 'legacy', modes: { currentModeId: 'bypass',
      availableModes: [{ id: 'normal', name: 'Normal' }, { id: 'bypass', name: 'Bypass' }] } }
    await expect(applyDevinSessionPermission(conn, session, 'ask')).rejects.toMatchObject({ code: 'policy_denied' })
    expect(request).not.toHaveBeenCalled()
    await applyDevinSessionPermission(conn, session, 'normal')
    expect(request).toHaveBeenCalledWith('session/set_mode', { sessionId: 'legacy', modeId: 'normal' })
  })
})
