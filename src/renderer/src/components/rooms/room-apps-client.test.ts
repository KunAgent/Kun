import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addRoomApp, authorizeRoomApp, listRoomApps } from './room-apps-client'

const { runtimeRequest } = vi.hoisted(() => ({ runtimeRequest: vi.fn() }))
vi.mock('../../agent/runtime-client', () => ({ rendererRuntimeClient: { runtimeRequest } }))

beforeEach(() => runtimeRequest.mockReset())

describe('Rooms app connections', () => {
  it('joins the safe config inventory with live connection and OAuth status', async () => {
    runtimeRequest.mockImplementation(async (path: string) => ({ ok: true, status: 200, body: JSON.stringify(
      path === '/v1/mcp/config' ? { servers: [{ id: 'google_gmail', enabled: true, transport: 'streamable-http', target: 'https://gmailmcp.googleapis.com/mcp/v1', oauth: false }] }
        : path === '/v1/runtime/tools' ? { mcpServers: [{ id: 'google_gmail', status: 'authorization_required' }] }
          : { servers: [{ serverId: 'google_gmail', status: 'empty' }] }
    ) }))
    await expect(listRoomApps()).resolves.toMatchObject({ statuses: { google_gmail: 'authorization_required' }, oauth: { google_gmail: 'empty' } })
  })

  it('sends a user-trusted HTTPS MCP endpoint through the authenticated bridge', async () => {
    runtimeRequest.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ authorized: true, status: 'authorized' }) })
    await addRoomApp('gmail', 'https://gmailmcp.googleapis.com/mcp/v1')
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/mcp/remote-apps/gmail', 'POST', JSON.stringify({ url: 'https://gmailmcp.googleapis.com/mcp/v1' }))
    await authorizeRoomApp('gmail')
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/mcp/oauth/gmail', 'POST', undefined)
  })

  it('rejects unsafe or ambiguous URLs before writing configuration', async () => {
    await expect(addRoomApp('gmail', 'http://example.com/mcp')).rejects.toThrow('HTTPS')
    await expect(addRoomApp('gmail', 'https://user:pass@example.com/mcp')).rejects.toThrow('credentials')
    await expect(addRoomApp('../gmail', 'https://example.com/mcp')).rejects.toThrow('app ID')
    expect(runtimeRequest).not.toHaveBeenCalled()
  })

  it('does not report an incomplete OAuth flow as connected', async () => {
    runtimeRequest.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ authorized: false, status: 'error' }) })
    await expect(authorizeRoomApp('gmail')).rejects.toThrow('did not complete')
  })
})
