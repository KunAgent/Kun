import { describe, it, expect } from 'vitest'
import { Envelope, ParamSchemas } from './contracts.js'
import { requireCode } from './code/access.js'
import { allowedThread } from './authorization/thread-access.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
describe('mobile capability boundary', () => {
  it('rejects arbitrary IPC, directory paths and privilege fields', () => {
    expect(() =>
      Envelope.parse({
        accountId: 'a',
        deviceId: 'b',
        call: {
          method: 'terminal:write',
          requestId: 'r',
          expiresAt: 1,
          params: {}
        }
      })
    ).toThrow()
    expect(() =>
      ParamSchemas['code.create'].parse({
        projectId: 'project',
        workspace: '/etc',
        sandboxMode: 'danger-full-access'
      })
    ).toThrow()
    expect(() =>
      ParamSchemas['code.turn.start'].parse({
        threadId: 'a',
        text: 'hi',
        clientSurface: 'gui'
      })
    ).toThrow()
    expect(() =>
      ParamSchemas['agent.message.send'].parse({
        agentId: 'a',
        text: 'hi',
        executionAgentId: 'other'
      })
    ).toThrow()
  })
  it('never treats ADE, group rooms or child executions as ordinary Code', async () => {
    const runtime = (thread: unknown, kind = 'group') =>
      ({
        threadService: { get: async () => thread },
        rooms: { service: { get: async () => ({ conversationKind: kind }) } }
      }) as unknown as ServerRuntime
    for (const thread of [
      { workspaceMode: 'ade' },
      { roomContext: { roomId: 'room' } },
      { parentThreadId: 'parent' },
      { agentSurface: 'design' }
    ])
      await expect(requireCode(runtime(thread), 'id')).rejects.toThrow()
    await expect(
      allowedThread(runtime({ roomContext: { roomId: 'r' } }), 'id')
    ).rejects.toThrow('FORBIDDEN')
    await expect(
      allowedThread(
        runtime({ roomContext: { roomId: 'r' } }, 'user_agent'),
        'id'
      )
    ).resolves.toBeTruthy()
  })
})
