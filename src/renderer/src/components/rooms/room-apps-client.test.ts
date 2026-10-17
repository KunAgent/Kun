import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ROOM_APP_CATALOG, isHiddenRoomGoogleApp } from '@shared/rooms-api'
import { addRoomApp, authorizeRoomApp, listRoomApps } from './room-apps-client'

const { runtimeRequest } = vi.hoisted(() => ({ runtimeRequest: vi.fn() }))
vi.mock('../../agent/runtime-client', () => ({ rendererRuntimeClient: { runtimeRequest } }))

beforeEach(() => runtimeRequest.mockReset())

describe('Rooms app connections', () => {
  it('joins the safe config inventory with live connection and OAuth status', async () => {
    runtimeRequest.mockImplementation(async (path: string) => ({ ok: true, status: 200, body: JSON.stringify(
      path === '/v1/mcp/config' ? { servers: [
        { id: 'google_drive', enabled: true, transport: 'streamable-http', target: 'https://drive.example.com/mcp', oauth: false },
        { id: 'notion', enabled: true, transport: 'streamable-http', target: 'https://example.com/mcp', oauth: true }] }
        : path === '/v1/runtime/tools' ? { mcpServers: [
          { id: 'google_drive', status: 'authorization_required' }, { id: 'notion', status: 'connected', lastError: 'PRIVATE_DIAGNOSTIC' }] }
          : { servers: [{ serverId: 'google_drive', status: 'empty' }, { serverId: 'notion', status: 'authorized', authorizationUrl: 'PRIVATE_OAUTH_URL', accessToken: 'PRIVATE_TOKEN' }] }
    ) }))
    const inventory = await listRoomApps()
    expect(inventory).toEqual({
      servers: [expect.objectContaining({ id: 'notion' })], statuses: { notion: 'connected' }, oauth: { notion: 'authorized' }
    })
    for (const value of ['google_drive', 'PRIVATE_DIAGNOSTIC', 'PRIVATE_OAUTH_URL', 'PRIVATE_TOKEN'])
      expect(JSON.stringify(inventory)).not.toContain(value)
    expect(runtimeRequest.mock.calls.map(([path, method]) => [path, method])).toEqual([
      ['/v1/mcp/config', 'GET'], ['/v1/runtime/tools', 'GET'], ['/v1/mcp/oauth', 'GET']
    ])
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
    for (const id of ['google_drive', 'google_calendar', 'google_chat', 'google_people', 'drive', 'calendar', 'mcp:google_drive', ' GOOGLE_CALENDAR ']) {
      await expect(addRoomApp(id, 'https://example.com/mcp')).rejects.toThrow('unavailable')
      await expect(authorizeRoomApp(id)).rejects.toThrow('unavailable')
    }
    expect(runtimeRequest).not.toHaveBeenCalled()
  })

  it('keeps native Gmail separate from unavailable Google MCP app fixtures', () => {
    expect(ROOM_APP_CATALOG.google_gmail).toEqual({ name: 'Gmail', connectionKind: 'native_gmail' })
    expect(isHiddenRoomGoogleApp('google_gmail')).toBe(false)
    expect(isHiddenRoomGoogleApp('gmail')).toBe(false)
    expect(runtimeRequest).not.toHaveBeenCalled()
  })

  it('does not report an incomplete OAuth flow as connected', async () => {
    runtimeRequest.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ authorized: false, status: 'error' }) })
    await expect(authorizeRoomApp('notion')).rejects.toThrow('did not complete')
  })
})
