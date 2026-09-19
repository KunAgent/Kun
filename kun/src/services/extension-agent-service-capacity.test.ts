import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManifestExtensionAgentAuthorizer } from './extension-agent-service.js'
import {
  createExtensionAgentHarness,
  extensionAgentPrincipal,
  workspace
} from './extension-agent-service.test-support.js'

afterEach(() => vi.restoreAllMocks())

describe('ExtensionAgentService.capacity', () => {
  it.each([
    { permissions: [] }, { permissions: ['agent.run'] }, { permissions: ['agent.threads.readOwn'] }
  ])(
    'requires its own scope before reading global activity ($permissions)', async ({ permissions }) => {
      const h = createExtensionAgentHarness()
      const snapshot = vi.spyOn(h.turns, 'capacitySnapshot')
      await expect(h.service.capacity({
        ...extensionAgentPrincipal(), permissions
      })).rejects.toMatchObject({ code: 'permission_denied', message: 'Missing permission: agent.capacity.read' })
      expect(snapshot).not.toHaveBeenCalled()
    }
  )

  it('authorizes the read-only operation and returns only the public capacity fields', async () => {
    const h = createExtensionAgentHarness()
    const principal = {
      ...extensionAgentPrincipal(), permissions: ['agent.capacity.read'],
      workspaceRoots: [], workspaceTrusted: false
    }
    const authorize = vi.spyOn(ManifestExtensionAgentAuthorizer.prototype, 'authorize')
    const privateSnapshot = {
      activeTurns: 3, queuedTurns: 2, maxConcurrentTurns: 17, busy: true,
      turnId: 'private_turn', prompt: 'private prompt', lease: 'private lease'
    }
    vi.spyOn(h.turns, 'capacitySnapshot').mockResolvedValue(privateSnapshot)
    expect(await h.service.capacity(principal)).toEqual({
      activeTurns: 3, queuedTurns: 2, maxConcurrentTurns: 17, busy: true
    })
    expect(authorize).toHaveBeenCalledWith(principal, {
      operation: 'capacity', permission: 'agent.capacity.read'
    })
    expect(h.launched).toEqual([])
  })

  it('exposes global totals without allowing access to foreign runs or room threads', async () => {
    const h = createExtensionAgentHarness()
    const foreign = await h.service.createRun(extensionAgentPrincipal('com.example.foreign'), {
      input: 'foreign prompt', workspace
    })
    const room = await h.threads.create({ title: 'private room', workspace, model: 'default-model', mode: 'agent' }, {
      relation: 'side',
      roomContext: {
        roomId: 'room_private', memberId: 'developer', kind: 'execution',
        blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: []
      }
    })
    await h.turns.startTurn({
      threadId: room.id, request: { prompt: 'private room prompt', clientSurface: 'gui' }
    })
    await h.turns.enqueueTurn({ threadId: room.id, request: { prompt: 'queued room prompt' } })
    const principal = {
      ...extensionAgentPrincipal(),
      permissions: [...extensionAgentPrincipal().permissions, 'agent.capacity.read']
    }
    expect(await h.service.capacity(principal)).toMatchObject({
      activeTurns: 2, queuedTurns: 1, busy: true
    })
    await expect(h.service.getRun(principal, foreign.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(h.service.getOwnThread(principal, room.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(h.service.listOwnThreads(principal)).resolves.toMatchObject({ items: [] })
  })

  it('does not expose private Manager errors or report a failed read as idle', async () => {
    const h = createExtensionAgentHarness()
    vi.spyOn(h.turns, 'capacitySnapshot').mockRejectedValue(
      new Error('Cannot read /Users/private/threads: auth token secret-token')
    )
    await expect(h.service.capacity({
      ...extensionAgentPrincipal(), permissions: ['agent.capacity.read']
    })).rejects.toMatchObject({ code: 'conflict', message: 'Turn capacity is temporarily unavailable' })
  })
})
