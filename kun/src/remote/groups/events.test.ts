import { describe, expect, it } from 'vitest'
import { projectRemoteGroupEvent } from './events.js'
const authority = { accountId: 'owner', deviceId: 'phone', authorizationId: 'grant' }
describe('group stream invalidation projection', () => {
  it('does not send collaboration changes to message-only scope or forward any raw payload body/config', () => {
    const event = { seq: 1, roomId: 'group', kind: 'request.updated', createdAt: new Date().toISOString(),
      payload: { id: 'request', taskId: 'task', body: 'private coordination', accountId: 'credential', path: '/private' } }
    expect(projectRemoteGroupEvent(event, { ...authority, scopes: ['groups.read'] })).toBeNull()
    expect(projectRemoteGroupEvent(event, { ...authority, scopes: ['groups.read', 'collaboration.read'] })?.payload)
      .toEqual({ id: 'request', taskId: 'task' })
    expect(projectRemoteGroupEvent({ ...event, kind: 'message.updated' }, { ...authority, scopes: ['groups.read'] })?.payload)
      .toEqual({ id: 'request' })
    expect(projectRemoteGroupEvent({ ...event, kind: 'configuration.updated' }, { ...authority, scopes: ['groups.read', 'collaboration.read'] })).toBeNull()
  })
})
