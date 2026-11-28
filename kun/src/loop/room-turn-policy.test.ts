import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { applyRoomToolPolicy } from './room-turn-policy.js'
import { TurnContextResolver, resolveTurnModeContext, type TurnContextResolverInput } from './turn-context-resolver.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { canWritePath } from '../adapters/tool/sandbox-policy.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { LocalToolHost, type LocalTool } from '../adapters/tool/local-tool-host.js'
import { createReadLocalTool, createLsLocalTool, createWriteLocalTool, createBashLocalTool } from '../adapters/tool/builtin-tools.js'

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

  it('executes only assigned built-in file reads in unattended Codex discussion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-discussion-read-'))
    try {
      const workspace = join(root, 'repo')
      await mkdir(workspace)
      await writeFile(join(workspace, 'note.txt'), 'repository fixture')
      await writeFile(join(root, 'other.txt'), 'outside fixture')
      const thread: ThreadRecord = { ...roomThread({ kind: 'discussion', allowedToolNames: ['ls', 'read'] }),
        workspace, harnessId: 'codex', sandboxMode: 'read-only', approvalPolicy: 'never' }
      const awaitApproval = vi.fn(async () => 'deny' as const)
      const raw: ToolHostContext = { threadId: thread.id, turnId: 'turn', workspace,
        approvalPolicy: 'never', allowHostReads: true, additionalWorkspaces: [root],
        abortSignal: new AbortController().signal, awaitApproval }
      const ctx = applyRoomToolPolicy(raw, thread)
      const registry = CapabilityRegistry.fromLocalTools([
        createReadLocalTool(), createLsLocalTool(), createWriteLocalTool(), createBashLocalTool()
      ])
      const host = new LocalToolHost({ registry })
      let id = 0
      const run = (name: string, args: Record<string, unknown>, scope = ctx, engine = host) =>
        engine.execute({ toolName: name, callId: 'call_' + ++id, arguments: args }, scope)
      expect((await host.listTools(ctx)).map((tool) => tool.name).sort()).toEqual(['ls', 'read'])
      expect((await run('read', { path: 'note.txt' })).item).toMatchObject({
        kind: 'tool_result', isError: false, output: { content: expect.stringContaining('repository fixture') }
      })
      expect((await run('ls', { path: '.' })).item).toMatchObject({ isError: false, output: { names: ['note.txt'] } })
      const privateDir = join(root, 'private')
      await mkdir(privateDir)
      await writeFile(join(privateDir, 'private.txt'), 'not part of the assigned repository')
      await symlink(privateDir, join(workspace, 'linked'), 'junction')
      for (const path of ['../other.txt', join(root, 'other.txt'), 'linked/private.txt']) {
        expect((await run('read', { path })).item).toMatchObject({ isError: true, output: { error: expect.stringContaining('read scopes') } })
      }
      const narrow = applyRoomToolPolicy({ ...raw, allowedReadPaths: ['note.txt'] }, thread)
      expect((await run('ls', { path: '.' }, narrow)).item).toMatchObject({ isError: true })
      for (const tool of ['write', 'bash']) await expect(run(tool, {})).rejects.toThrow('active tool policy')
      const blocked = applyRoomToolPolicy({ ...raw, blockedToolNames: ['ls'] }, thread)
      await expect(run('ls', {}, blocked)).rejects.toThrow('active tool policy')
      expect((await run('read', { path: 'note.txt' }, raw)).item).toMatchObject({
        isError: true, output: { code: 'approval_policy_blocked' }
      })
      const otherProvider = new LocalToolHost({ registry: new CapabilityRegistry([{
        id: 'third-party', kind: 'mcp', enabled: true, available: true, tools: [createReadLocalTool()]
      }]) })
      expect((await run('read', {}, ctx, otherProvider)).item).toMatchObject({ isError: true, output: { code: 'approval_policy_blocked' } })
      const gated = new LocalToolHost({ tools: [{ ...createReadLocalTool(), requiresExplicitApproval: true }] })
      expect((await run('read', {}, ctx, gated)).item).toMatchObject({ isError: true, output: { code: 'approval_policy_blocked' } })
      const implicit = applyRoomToolPolicy(raw, { ...thread, roomContext: { ...thread.roomContext!, allowedToolNames: undefined } })
      expect((await run('read', {}, implicit)).item).toMatchObject({ isError: true, output: { code: 'approval_policy_blocked' } })
      expect(ctx.approvalPolicy).toBe('never')
      expect(awaitApproval).not.toHaveBeenCalled()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
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

  it('hides Google MCP providers in private Rooms without hiding other apps', () => {
    const context = applyRoomToolPolicy(raw, roomThread({ kind: 'conversation', participantAgentId: 'agent_one',
      blockedProviderIds: [] }))
    expect(context.blockedProviderIds).toEqual(expect.arrayContaining([
      'mcp:google_gmail', 'mcp:google_drive', 'mcp:google_calendar'
    ]))
    const tool = (name: string): LocalTool => ({ name, description: name, inputSchema: { type: 'object', properties: {} },
      policy: 'auto', toolKind: 'tool_call', sideEffect: 'read-only', execute: async () => ({ output: {} }) })
    const registry = new CapabilityRegistry([
      { id: 'mcp:google_gmail', kind: 'mcp', enabled: true, available: true, tools: [tool('gmail_search')] },
      { id: 'gmail', kind: 'built-in', enabled: true, available: true, tools: [tool('native_gmail_search')] },
      { id: 'mcp:notion', kind: 'mcp', enabled: true, available: true, tools: [tool('notion_search')] }
    ])
    expect(registry.listTools(context).map((entry) => entry.name)).toEqual(['native_gmail_search', 'notion_search'])
    expect(() => registry.resolveTool('gmail_search', context)).toThrow('not advertised')
    expect(registry.resolveTool('notion_search', context).tool.name).toBe('notion_search')
    expect(applyRoomToolPolicy(raw, roomThread({ kind: 'execution', blockedProviderIds: [] })).blockedProviderIds)
      .not.toContain('mcp:google_gmail')
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

  it('keeps read_room_playbook inside the allowed surface of every room step kind', () => {
    const kinds = ['coordination', 'discussion', 'execution', 'review', 'conversation'] as const
    for (const kind of kinds) {
      const context = applyRoomToolPolicy(raw, roomThread({ kind, allowedToolNames: ['read', 'read_room_playbook'] }))
      expect(context.allowedToolNames).toEqual(expect.arrayContaining(['read_room_playbook']))
    }
    for (const kind of kinds) {
      const unrestricted = applyRoomToolPolicy(raw, roomThread({ kind }))
      if (unrestricted.allowedToolNames) expect(unrestricted.allowedToolNames).toContain('read_room_playbook')
    }
  })
})

describe('room memory policy', () => {
  const enabledRaw: ToolHostContext = {
    threadId: 'room_thread', turnId: 'turn_one', workspace: '/workspace',
    sandboxMode: 'workspace-write', approvalPolicy: 'auto',
    memoryPolicy: { enabled: true, scopes: ['user'] }, abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }

  it('keeps the upstream memory policy for a writable conversation so explicit directives can be stored', () => {
    const context = applyRoomToolPolicy(enabledRaw,
      roomThread({ kind: 'conversation', participantAgentId: 'agent_one' }))
    expect(context.memoryPolicy).toEqual({ enabled: true, scopes: ['user'] })
  })

  it('keeps memory disabled for a conversation when the upstream policy is disabled or absent', () => {
    expect(applyRoomToolPolicy({ ...enabledRaw, memoryPolicy: { enabled: false } },
      roomThread({ kind: 'conversation', participantAgentId: 'agent_one' })).memoryPolicy)
      .toEqual({ enabled: false })
    const absentRaw: ToolHostContext = { ...enabledRaw }
    delete absentRaw.memoryPolicy
    expect(applyRoomToolPolicy(absentRaw, roomThread({ kind: 'conversation' })).memoryPolicy)
      .toEqual({ enabled: false })
  })

  it('still forces memory off for execution and discussion rooms even when upstream enables it', () => {
    for (const kind of ['execution', 'discussion'] as const) {
      expect(applyRoomToolPolicy(enabledRaw, roomThread({ kind })).memoryPolicy)
        .toEqual({ enabled: false })
    }
  })

  it('keeps memory off for a read-only conversation', () => {
    const context = applyRoomToolPolicy(enabledRaw, {
      ...roomThread({ kind: 'conversation', participantAgentId: 'agent_one' }),
      sandboxMode: 'read-only'
    })
    expect(context.memoryPolicy).toEqual({ enabled: false })
  })
})
