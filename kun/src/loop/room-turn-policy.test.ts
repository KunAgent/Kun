import { describe, expect, it, vi } from 'vitest'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { applyRoomToolPolicy } from './room-turn-policy.js'
import { TurnContextResolver, resolveTurnModeContext, type TurnContextResolverInput } from './turn-context-resolver.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { canWritePath } from '../adapters/tool/sandbox-policy.js'

function roomThread(overrides: Partial<NonNullable<ThreadRecord['roomContext']>> = {}) {
  return createThreadRecord({ id: 'room_thread', title: 'Room', workspace: '/workspace', model: 'test',
    approvalPolicy: 'always', sandboxMode: 'workspace-write', roomContext: {
      roomId: 'room_one', memberId: 'member_one', kind: 'execution', blockedToolNames: ['forbidden'],
      blockedProviderIds: ['private'], blockedSkillIds: ['private_skill'], ...overrides
    } })
}

describe('frozen room turn policy', () => {
  it('keeps scope, approval, deny lists and read-only rules at execution even for a broader turn context', () => {
    const raw: ToolHostContext = {
      threadId: 'room_thread', turnId: 'turn_one', workspace: '/other',
      additionalWorkspaces: ['/outside'], sandboxMode: 'danger-full-access', approvalPolicy: 'auto',
      allowedToolNames: ['read', 'write', 'forbidden'], blockedToolNames: ['runtime_blocked'],
      blockedProviderIds: ['mcp:runtime'], blockedSkillIds: ['runtime_skill'],
      memoryPolicy: { enabled: true }, abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow'
    }
    const context = applyRoomToolPolicy(raw, roomThread({ kind: 'review', skillsEnabled: false }))
    expect(context).toMatchObject({ workspace: '/workspace', sandboxMode: 'read-only',
      approvalPolicy: 'always', allowedToolNames: ['read'], allowedReadPaths: ['.'], allowedWritePaths: [],
      allowedSkillIds: [], memoryPolicy: { enabled: false } })
    expect(context.additionalWorkspaces).toBeUndefined()
    expect(context.blockedToolNames).toEqual(expect.arrayContaining(['runtime_blocked', 'forbidden', 'delegate_task']))
    expect(context.blockedProviderIds).toEqual(expect.arrayContaining(['mcp:runtime', 'mcp:private']))
    expect(context.blockedSkillIds).toEqual(expect.arrayContaining(['runtime_skill', 'private_skill']))
    const execution = applyRoomToolPolicy(raw, roomThread())
    expect(canWritePath('/outside/file', { ...execution, approvedExternalWriteTargets: [] }).ok).toBe(false)
    expect(canWritePath('/workspace/file', execution).ok).toBe(true)
    expect(applyRoomToolPolicy(raw, roomThread({ kind: 'coordination' })).allowedToolNames).toEqual([])
  })

  it('lets discussion read the host without a delegated read scope', () => {
    const raw: ToolHostContext = {
      threadId: 'room_thread', turnId: 'turn_one', workspace: '/other',
      additionalWorkspaces: ['/outside'], sandboxMode: 'danger-full-access', approvalPolicy: 'auto',
      allowedToolNames: ['read', 'write', 'fast_context'],
      memoryPolicy: { enabled: true }, abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow'
    }
    const discussion = applyRoomToolPolicy(raw, roomThread({ kind: 'discussion' }))
    expect(discussion).toMatchObject({
      workspace: '/workspace', sandboxMode: 'read-only', allowHostReads: true, allowedWritePaths: []
    })
    expect(discussion.allowedReadPaths).toBeUndefined()
    expect(discussion.allowedToolNames).toEqual(expect.arrayContaining(['read', 'fast_context']))
    const clamped = applyRoomToolPolicy({ ...raw, allowedReadPaths: ['src'] }, roomThread({ kind: 'discussion' }))
    expect(clamped.allowHostReads).toBeUndefined()
    expect(clamped.allowedReadPaths).toEqual(['src'])
    const review = applyRoomToolPolicy({ ...raw, allowHostReads: true }, roomThread({ kind: 'review' }))
    expect(review.allowHostReads).toBeUndefined()
    expect(review.allowedReadPaths).toEqual(['.'])
  })

  it('does not recall memories and passes frozen skill restrictions to discovery', async () => {
    const retrieve = vi.fn(async () => [])
    const skillResolve = vi.fn(async () => ({
      activeSkillIds: [], activations: [], instructions: [], injectedBytes: 0
    }))
    const listTools = vi.fn(async () => [])
    const resolver = new TurnContextResolver({ toolHost: { listTools },
      resolveAttachments: async () => ({ imageAttachments: [], textFallbacks: [], documents: [] }),
      memoryStore: { retrieve, setLastInjected: vi.fn() },
      skillRuntime: { resolveTurn: skillResolve }, blockedSkillIds: ['runtime_skill'],
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) }
    })
    const thread = roomThread()
    const turn = createTurnRecord({ id: 'turn_one', threadId: thread.id, prompt: 'Discuss',
      sandboxMode: 'danger-full-access', approvalPolicy: 'auto' })
    const input: TurnContextResolverInput = { threadId: thread.id, turnId: turn.id, thread, turn,
      history: [], model: 'test', modelCapabilities: { id: 'test', inputModalities: ['text'],
        outputModalities: ['text'], supportsToolCalling: true, messageParts: ['text'] },
      signal: new AbortController().signal, goalNoToolRecoverySteps: 0,
      mode: resolveTurnModeContext({ turn, workspace: thread.workspace, threadMode: thread.mode }) }
    const resolved = await resolver.resolve(input)
    expect(retrieve).not.toHaveBeenCalled()
    expect(skillResolve).toHaveBeenCalledWith(expect.objectContaining({
      blockedSkillIds: ['runtime_skill', 'private_skill']
    }))
    expect(resolved.memories).toEqual([])
    expect(resolved).toMatchObject({ sandboxMode: 'workspace-write', approvalPolicy: 'always' })
    expect(listTools).toHaveBeenCalledWith(expect.objectContaining({ blockedToolNames: expect.arrayContaining(['forbidden']),
      blockedProviderIds: expect.arrayContaining(['mcp:private']), memoryPolicy: { enabled: false } }))
    skillResolve.mockClear()
    await resolver.resolve({ ...input, thread: roomThread({ skillsEnabled: false }) })
    expect(skillResolve).not.toHaveBeenCalled()
  })
})

describe('writable room general-capability parity', () => {
  const raw: ToolHostContext = {
    threadId: 'room_thread', turnId: 'turn_one', workspace: '/workspace',
    additionalWorkspaces: ['/extra'], sandboxMode: 'workspace-write', approvalPolicy: 'auto',
    memoryPolicy: { enabled: true }, abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }

  it('keeps delegate/subagent available for a writable private conversation', () => {
    const context = applyRoomToolPolicy(raw, {
      ...roomThread({ kind: 'conversation', participantAgentId: 'agent_one' }),
      additionalWorkspaces: ['/authorized']
    })
    for (const name of ['delegate_task', 'generate_subagent', 'create_goal']) {
      expect(context.blockedToolNames).not.toContain(name)
    }
    expect(context.additionalWorkspaces).toEqual(['/authorized'])
    expect(context.sandboxMode).toBe('workspace-write')
  })

  it('keeps send_im_message available for a capability-frozen conversation', () => {
    const context = applyRoomToolPolicy({ ...raw, allowedToolNames: ['read'] },
      roomThread({ kind: 'conversation', participantAgentId: 'agent_one', allowedToolNames: ['read'] }))
    expect(context.allowedToolNames).toEqual(expect.arrayContaining(['read', 'send_im_message']))
  })

  it('keeps delegate/subagent available for a writable group execution thread', () => {
    const context = applyRoomToolPolicy(raw, roomThread({ kind: 'execution' }))
    for (const name of ['delegate_task', 'generate_subagent']) expect(context.blockedToolNames).not.toContain(name)
    expect(context.additionalWorkspaces).toBeUndefined()
  })

  it('still blocks delegation and clears extra workspaces for read-only stages', () => {
    const context = applyRoomToolPolicy(raw, roomThread({ kind: 'review' }))
    expect(context.blockedToolNames).toEqual(expect.arrayContaining(['delegate_task', 'generate_subagent']))
    expect(context.additionalWorkspaces).toBeUndefined()
  })
})
