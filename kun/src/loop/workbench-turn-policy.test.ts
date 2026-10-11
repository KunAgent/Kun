import { describe, expect, it, vi } from 'vitest'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { canWritePath } from '../adapters/tool/sandbox-policy.js'
import { applyRoomToolPolicy } from './room-turn-policy.js'
import { TurnContextResolver, resolveTurnModeContext } from './turn-context-resolver.js'
import { makeHarness } from '../../tests/loop-test-harness.js'
import { workbenchDispatchCapabilities } from '../workbench-bridge/dispatch-capabilities.js'

const thread = () => createThreadRecord({ id: 'handed-over', title: 'Code task', workspace: '/code', model: 'test',
  workbenchOrigin: { kind: 'bot', roomId: 'room', linkId: 'link', agentId: 'agent', agentName: 'Bot', capabilityCeiling: {
    allowedToolNames: ['read', 'write'], blockedToolNames: ['bash'], blockedProviderIds: ['secret'],
    blockedSkillIds: ['private-skill'], allowedWritePaths: ['src'], skillsEnabled: false } } })
const raw = (): ToolHostContext => ({ threadId: 'handed-over', turnId: 'turn', workspace: '/code',
  approvalPolicy: 'auto', sandboxMode: 'danger-full-access', allowedToolNames: ['read', 'write', 'bash', 'web_search'],
  abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' })

describe('frozen Code handoff capability ceiling', () => {
  it('keeps tool, MCP, skill and filesystem limits at execution without marking Code room-owned', () => {
    const task = thread()
    const context = applyRoomToolPolicy(raw(), task)
    expect(task.roomContext).toBeUndefined()
    expect(context.allowedToolNames).toEqual(['read', 'write'])
    expect(context.blockedToolNames).toEqual(expect.arrayContaining(['bash', 'load_skill']))
    expect(context.blockedProviderIds).toEqual(expect.arrayContaining(['secret', 'mcp:secret']))
    expect(context.allowedSkillIds).toEqual([])
    expect(canWritePath('/code/outside.txt', context).ok).toBe(false)
    expect(canWritePath('/code/src/file.ts', context).ok).toBe(true)
    expect(applyRoomToolPolicy({ ...raw(), allowedWritePaths: ['tests'] }, task).allowedWritePaths).toEqual([])
    // A later broader turn cannot drop the thread's frozen source boundary.
    expect(applyRoomToolPolicy({ ...raw(), allowedToolNames: undefined }, task).allowedToolNames).toEqual(['read', 'write'])
    expect(workbenchDispatchCapabilities(task, { ...raw(), sandboxMode: 'read-only', allowedWritePaths: [] }).allowedWritePaths).toEqual([])
  })

  it('applies the same restrictions before native model discovery and suppresses disabled skill injection', async () => {
    const task = thread()
    const turn = createTurnRecord({ id: 'turn', threadId: task.id, prompt: 'Do the Code task', status: 'running' })
    const listTools = vi.fn(async () => [])
    const resolveSkill = vi.fn(async () => ({ activeSkillIds: [], activations: [], instructions: [], injectedBytes: 0 }))
    const resolver = new TurnContextResolver({ toolHost: { listTools },
      resolveAttachments: async () => ({ imageAttachments: [], textFallbacks: [], documents: [] }),
      skillRuntime: { resolveTurn: resolveSkill }, interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) } })
    const result = await resolver.resolve({ threadId: task.id, turnId: turn.id, thread: task, turn,
      history: [], model: 'test', modelCapabilities: { id: 'test', inputModalities: ['text'], outputModalities: ['text'], supportsToolCalling: true, messageParts: ['text'] },
      signal: new AbortController().signal, goalNoToolRecoverySteps: 0,
      mode: resolveTurnModeContext({ turn, workspace: task.workspace, threadMode: task.mode }) })
    expect(resolveSkill).not.toHaveBeenCalled()
    expect(result.toolDiscoveryContext).toMatchObject({ allowedToolNames: ['read', 'write'],
      allowedSkillIds: [], blockedProviderIds: expect.arrayContaining(['mcp:secret']), allowedWritePaths: ['src'] })
  })

  it('retains the host capability ceiling when the target is forked or resumed', async () => {
    const h = makeHarness({ provider: 'test', model: 'test', async *stream() { yield { kind: 'completed' as const, stopReason: 'stop' as const } } })
    const source = await h.threads.create({ title: 'Task', workspace: '/code', model: 'test', mode: 'agent' },
      { workbenchOrigin: thread().workbenchOrigin })
    const forked = await h.threads.fork(source.id)
    const resumed = await h.threads.resumeSession(source.id)
    expect(forked.workbenchOrigin?.capabilityCeiling).toEqual(source.workbenchOrigin?.capabilityCeiling)
    expect(resumed.thread.workbenchOrigin?.capabilityCeiling).toEqual(source.workbenchOrigin?.capabilityCeiling)
    expect(canWritePath('/code/outside.txt', applyRoomToolPolicy(raw(), resumed.thread)).ok).toBe(false)
  })
})
