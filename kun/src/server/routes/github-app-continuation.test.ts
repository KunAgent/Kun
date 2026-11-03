import { describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../../domain/thread.js'
import { createTurnRecord } from '../../domain/turn.js'
import type { ServerRuntime } from './server-runtime.js'
import { continueGitHubTask } from './github-app-continuation.js'

const input = { threadId: 'thread-1', sourceTurnId: 'source-turn', toolCallId: 'connect-call' }
async function fixture() {
  const threads = new InMemoryThreadStore()
  const thread = createThreadRecord({ id: 'thread-1', title: 'Mail', workspace: '/tmp', model: 'model' })
  const source = createTurnRecord({ id: 'source-turn', threadId: thread.id, prompt: 'Summarize mail', status: 'completed',
    clientSurface: 'gui', model: 'original-model', providerId: 'original-provider' })
  source.items.push({ id: 'result-1', threadId: thread.id, turnId: source.id, kind: 'tool_result',
    role: 'tool', status: 'completed', createdAt: new Date().toISOString(),
    callId: 'connect-call', toolName: 'github_connect', toolKind: 'tool_call', isError: false,
    output: { githubConnection: { kind: 'github', threadId: thread.id, sourceTurnId: source.id,
      toolCallId: 'connect-call', scopeId: 'thread:thread-1', status: 'requested' } } })
  thread.turns.push(source)
  await threads.upsert(thread)
  const status = { connected: true, allowModelSharing: true, repositoryCount: 1 }
  const runTurn = vi.fn()
  const startTurn = vi.fn(async (request: { threadId: string; request: { clientRequestId: string; prompt: string } },
    options: { onAdmitted: (response: { threadId: string; turnId: string }) => void }) => {
    const current = (await threads.get('thread-1'))!
    const existing = current.turns.find((turn) => turn.clientRequestId === request.request.clientRequestId)
    const response = { threadId: 'thread-1', turnId: existing?.id ?? 'continued-turn' }
    if (!existing) {
      current.turns.push(createTurnRecord({ id: response.turnId, threadId: 'thread-1', status: 'running',
        prompt: request.request.prompt, clientRequestId: request.request.clientRequestId }))
      await threads.upsert(current)
      options.onAdmitted(response)
    }
    return response
  })
  const runtime = { threadService: { get: (id: string) => threads.get(id) }, turnService: { startTurn },
    runTurn, githubApp: { status: vi.fn(async () => status), hasGoogleData: vi.fn(async () => false) } } as unknown as ServerRuntime
  return { runtime, threads, status, runTurn, startTurn }
}

describe('GitHub Code connection continuation', () => {
  it('starts only from the actual persisted connection result, preserving the original model and client surface', async () => {
    const f = await fixture()
    expect(await continueGitHubTask(f.runtime, input)).toEqual({ threadId: 'thread-1', turnId: 'continued-turn' })
    expect(f.startTurn).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread-1', request: expect.objectContaining({
      model: 'original-model', providerId: 'original-provider', clientSurface: 'gui',
      clientRequestId: expect.stringMatching(/^github-continue-[a-f0-9]{64}$/)
    }) }), expect.anything())
    expect(f.runTurn).toHaveBeenCalledWith('thread-1', 'continued-turn')
    expect(await continueGitHubTask(f.runtime, input)).toEqual({ threadId: 'thread-1', turnId: 'continued-turn' })
    expect(f.runTurn).toHaveBeenCalledTimes(1)
  })

  it('rejects fabricated call identities, another thread, and ordinary tool result content', async () => {
    const f = await fixture()
    await expect(continueGitHubTask(f.runtime, { ...input, toolCallId: 'fake-call' })).rejects.toThrow('not issued')
    await expect(continueGitHubTask(f.runtime, { ...input, threadId: 'other' })).rejects.toThrow('unavailable')
    const thread = (await f.threads.get('thread-1'))!
    const item = thread.turns[0].items[0]
    if (item.kind === 'tool_result') item.toolName = 'github_read'
    await f.threads.upsert(thread)
    await expect(continueGitHubTask(f.runtime, input)).rejects.toThrow('not issued')
    expect(f.startTurn).not.toHaveBeenCalled()
  })

  it('does not revive cancelled, still running or superseded tasks', async () => {
    const f = await fixture()
    const thread = (await f.threads.get('thread-1'))!
    thread.turns[0].status = 'running'
    await f.threads.upsert(thread)
    expect(await continueGitHubTask(f.runtime, input)).toEqual({ pending: true })
    thread.turns[0].status = 'aborted'
    await f.threads.upsert(thread)
    await expect(continueGitHubTask(f.runtime, input)).rejects.toThrow('Wait for Kun')
    thread.turns[0].status = 'completed'
    thread.turns.push(createTurnRecord({ id: 'new-task', threadId: thread.id, prompt: 'New topic', status: 'completed' }))
    await f.threads.upsert(thread)
    await expect(continueGitHubTask(f.runtime, input)).rejects.toThrow('current conversation')
    expect(f.startTurn).not.toHaveBeenCalled()
  })

  it('requires a live connection, conversation grant and repository access before continuing', async () => {
    const f = await fixture()
    for (const patch of [{ connected: false }, { allowModelSharing: false }, { repositoryCount: 0 }]) {
      Object.assign(f.status, { connected: true, allowModelSharing: true, repositoryCount: 1 }, patch)
      await expect(continueGitHubTask(f.runtime, input)).rejects.toThrow('allow this conversation')
    }
    expect(f.startTurn).not.toHaveBeenCalled()
  })
})
