import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addRoomApp, authorizeRoomApp, listRoomApps } from './room-apps-client'

const { runtimeRequest } = vi.hoisted(() => ({ runtimeRequest: vi.fn() }))
vi.mock('../../agent/runtime-client', () => ({ rendererRuntimeClient: { runtimeRequest } }))

beforeEach(() => runtimeRequest.mockReset())

describe('Rooms app connections', () => {
  it('joins the safe config inventory with live connection and OAuth status', async () => {
    runtimeRequest.mockImplementation(async (path: string) => ({ ok: true, status: 200, body: JSON.stringify(
      path === '/v1/mcp/config' ? { servers: [
        { id: 'google_gmail', enabled: true, transport: 'streamable-http', target: 'https://gmailmcp.googleapis.com/mcp/v1', oauth: false },
        { id: 'notion', enabled: true, transport: 'streamable-http', target: 'https://example.com/mcp', oauth: true }] }
        : path === '/v1/runtime/tools' ? { mcpServers: [
          { id: 'google_gmail', status: 'authorization_required' }, { id: 'notion', status: 'connected' }] }
          : { servers: [{ serverId: 'google_gmail', status: 'empty' }, { serverId: 'notion', status: 'authorized' }] }
    ) }))
    await expect(listRoomApps()).resolves.toEqual({
      servers: [expect.objectContaining({ id: 'notion' })], statuses: { notion: 'connected' }, oauth: { notion: 'authorized' }
    })
  })

  it('sends a user-trusted HTTPS MCP endpoint through the authenticated bridge', async () => {
    runtimeRequest.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ authorized: true, status: 'authorized' }) })
    await addRoomApp('notion', 'https://example.com/mcp')
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/mcp/remote-apps/notion', 'POST', JSON.stringify({ url: 'https://example.com/mcp' }))
    await authorizeRoomApp('notion')
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/mcp/oauth/notion', 'POST', undefined)
  })

  it('rejects unsafe or ambiguous URLs before writing configuration', async () => {
    await expect(addRoomApp('notion', 'http://example.com/mcp')).rejects.toThrow('HTTPS')
    await expect(addRoomApp('notion', 'https://user:pass@example.com/mcp')).rejects.toThrow('credentials')
    await expect(addRoomApp('../gmail', 'https://example.com/mcp')).rejects.toThrow('app ID')
    expect(runtimeRequest).not.toHaveBeenCalled()
  })

  it('does not install or authorize hidden Google Room apps', async () => {
    await expect(addRoomApp('google_gmail', 'https://gmailmcp.googleapis.com/mcp/v1')).rejects.toThrow('unavailable')
    await expect(authorizeRoomApp('google_drive')).rejects.toThrow('unavailable')
    expect(runtimeRequest).not.toHaveBeenCalled()
  })

  it('does not report an incomplete OAuth flow as connected', async () => {
    runtimeRequest.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ authorized: false, status: 'error' }) })
    await expect(authorizeRoomApp('notion')).rejects.toThrow('did not complete')
  })
})
