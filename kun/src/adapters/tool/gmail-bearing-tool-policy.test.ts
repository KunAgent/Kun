import { describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../in-memory-thread-store.js'
import { createThreadRecord } from '../../domain/thread.js'
import { createTurnRecord } from '../../domain/turn.js'
import { makeToolResultItem } from '../../domain/item.js'
import { bindGmailThreadDataProtection } from '../../gmail/thread-data-state.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { CapabilityRegistry } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

const nativeNames = ['gmail_connect', 'gmail_search', 'gmail_read', 'gmail_send']
const tool = (name: string, execute = vi.fn(async () => ({ output: 'ordinary result' }))) => LocalToolHost.defineTool({
  name, description: name, inputSchema: { type: 'object' }, policy: 'auto', sideEffect: 'read-only', execute
})
const context = (): ToolHostContext => ({
  threadId: 'mail-thread', turnId: 'mail-turn', workspace: '/tmp', clientSurface: 'gui', harnessId: 'kun',
  modelProviderId: 'deepseek', actingModelRoute: { providerId: 'deepseek', model: 'deepseek-chat' },
  sandboxMode: 'danger-full-access', approvalPolicy: 'auto', approvalReviewer: 'user',
  abortSignal: new AbortController().signal, awaitApproval: vi.fn(async () => 'allow' as const)
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
async function fixture() {
  const threads = new InMemoryThreadStore()
  const sensitive = new Set<string>()
  const gmail = {
    captureModelSharingFence: () => () => undefined,
    hasGoogleData: vi.fn(async (scope: string) => sensitive.has(scope)),
    markGoogleData: vi.fn(async (scope: string) => { sensitive.add(scope) }),
    status: vi.fn(async () => ({ configured: true, connected: false, reconnectRequired: false,
      scopes: [], allowModelSharing: false }))
  }
  bindGmailThreadDataProtection(threads, gmail)
  const thread = createThreadRecord({ id: 'mail-thread', title: 'Mail', workspace: '/tmp', model: 'deepseek-chat' })
  thread.turns.push(createTurnRecord({ id: 'mail-turn', threadId: thread.id, prompt: 'Mail', status: 'running' }))
  await threads.upsert(thread)
  const pre = vi.fn()
  const post = vi.fn()
  const executed = vi.fn(async () => ({ output: 'ordinary result' }))
  const registry = new CapabilityRegistry([
    { id: 'gmail', kind: 'built-in', enabled: true, available: true, tools: nativeNames.map((name) => tool(name)) },
    { id: 'builtin', kind: 'built-in', enabled: true, available: true,
      tools: ['bash', 'write', 'web_search', 'memory_write', 'delegate_task', 'echo'].map((name) => tool(name, executed)) }
  ])
  const host = new LocalToolHost({ registry, threadStore: threads, hooks: [
    { phase: 'PreToolUse', run: pre }, { phase: 'PostToolUse', run: post }
  ] })
  return { threads, sensitive, gmail, thread, pre, post, executed, registry, host }
}

describe('host-owned Gmail-bearing conversation tool restrictions', () => {
  it('restricts sticky DeepSeek conversations after disconnect without trusting a caller flag or revoked consent', async () => {
    const f = await fixture()
    f.sensitive.add('thread:mail-thread')
    const ctx = { ...context(), googleWorkspaceData: false, gmailSensitive: false }
    expect((await f.host.listTools(ctx)).map((spec) => spec.name)).toEqual(nativeNames)
    for (const toolName of ['bash', 'write', 'web_search', 'memory_write', 'delegate_task']) {
      await expect(f.host.execute({ toolName, callId: toolName, arguments: { text: 'private mail' } }, ctx))
        .rejects.toThrow('not advertised')
    }
    await f.host.execute({ toolName: 'gmail_read', callId: 'native', arguments: { messageId: 'mail-1' } }, ctx)
    expect(f.pre).not.toHaveBeenCalled()
    expect(f.post).not.toHaveBeenCalled()
    expect(f.executed).not.toHaveBeenCalled()
    expect(ctx.awaitApproval).not.toHaveBeenCalled()
  })

  it('preserves normal untainted DeepSeek tool discovery, execution and hooks', async () => {
    const f = await fixture()
    expect((await f.host.listTools(context())).map((spec) => spec.name)).toContain('bash')
    await f.host.execute({ toolName: 'echo', callId: 'ordinary', arguments: {} }, context())
    expect(f.executed).toHaveBeenCalledOnce()
    expect(f.pre).toHaveBeenCalledOnce()
    expect(f.post).toHaveBeenCalledOnce()
  })

  it('classifies canonical persisted legacy mail results before discovery', async () => {
    const f = await fixture()
    f.thread.turns[0]!.items.push(makeToolResultItem({
      id: 'mail-item', threadId: f.thread.id, turnId: 'mail-turn', callId: 'old-read', toolName: 'gmail_read',
      output: { body: 'Private legacy mail', untrusted: true }
    }))
    await f.threads.upsert(f.thread)
    expect((await f.host.listTools(context())).map((spec) => spec.name)).toEqual(nativeNames)
    expect(f.sensitive.has('thread:mail-thread')).toBe(true)
    expect(f.gmail.markGoogleData).toHaveBeenCalledWith('thread:mail-thread')
  })

  it('derives private-room and inherited sticky scopes from canonical thread metadata', async () => {
    const f = await fixture()
    const parent = createThreadRecord({ id: 'parent', title: 'Parent', workspace: '/tmp', model: 'deepseek-chat' })
    await f.threads.upsert(parent)
    f.thread.parentThreadId = parent.id
    await f.threads.upsert(f.thread)
    f.sensitive.add('thread:parent')
    expect((await f.host.listTools(context())).map((spec) => spec.name)).toEqual(nativeNames)
    expect(f.sensitive.has('thread:mail-thread')).toBe(true)

    const room = createThreadRecord({ id: 'room-thread', title: 'Room', workspace: '/tmp', model: 'deepseek-chat',
      roomContext: { kind: 'conversation', roomId: 'private-room', memberId: 'member', participantAgentId: 'agent',
        blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] } })
    await f.threads.upsert(room)
    f.sensitive.add('room:private-room')
    expect((await f.host.listTools({ ...context(), threadId: room.id })).map((spec) => spec.name)).toEqual(nativeNames)
  })

  it('rechecks execution against fresh sticky state instead of a previously broad discovery catalog', async () => {
    const f = await fixture()
    const ctx = context()
    expect((await f.host.listTools(ctx)).map((spec) => spec.name)).toContain('bash')
    f.sensitive.add('thread:mail-thread')
    await expect(f.host.execute({ toolName: 'bash', callId: 'stale', arguments: {} }, ctx)).rejects.toThrow('not advertised')
    expect(f.pre).not.toHaveBeenCalled()
    expect(f.executed).not.toHaveBeenCalled()
  })

  it('rejects non-mail execution when a conversation becomes sensitive while approval is pending', async () => {
    const f = await fixture()
    const waiting = deferred<'allow'>()
    const approvalStarted = deferred<void>()
    f.registry.replaceProvider({ id: 'builtin', kind: 'built-in', enabled: true, available: true, tools: [
      { ...tool('echo', f.executed), requiresExplicitApproval: true, requiresApprovalInFullAccess: true }
    ] })
    const ctx = { ...context(), awaitApproval: vi.fn(async () => { approvalStarted.resolve(); return waiting.promise }) }
    const pending = f.host.execute({ toolName: 'echo', callId: 'pending', arguments: {} }, ctx)
    await approvalStarted.promise
    f.sensitive.add('thread:mail-thread')
    waiting.resolve('allow')
    await expect(pending).rejects.toThrow('not advertised')
    expect(f.executed).not.toHaveBeenCalled()
    expect(f.post).not.toHaveBeenCalled()
  })

  it('skips post-hooks when an allowed source-history tool imports mail during execution', async () => {
    const f = await fixture()
    f.registry.replaceProvider({ id: 'builtin', kind: 'built-in', enabled: true, available: true, tools: [
      tool('read_thread_history', vi.fn(async () => {
        f.sensitive.add('thread:mail-thread')
        return { output: 'Private borrowed mail body' }
      }))
    ] })
    const result = await f.host.execute({ toolName: 'read_thread_history', callId: 'history', arguments: {} }, context())
    expect(result.item).toMatchObject({ output: 'Private borrowed mail body' })
    expect(f.pre).toHaveBeenCalledOnce()
    expect(f.post).not.toHaveBeenCalled()
  })

  it('rejects mail-shaped MCP tools and other tools inside a native-named provider', async () => {
    const f = await fixture()
    f.sensitive.add('thread:mail-thread')
    for (const provider of [
      { id: 'gmail', kind: 'mcp' as const, enabled: true, available: true, tools: [tool('gmail_read', f.executed)] },
      { id: 'gmail', kind: 'built-in' as const, enabled: true, available: true, tools: [tool('bash', f.executed)] }
    ]) {
      const host = new LocalToolHost({ registry: new CapabilityRegistry([provider]), threadStore: f.threads })
      expect(await host.listTools(context())).toEqual([])
      await expect(host.execute({ toolName: provider.tools[0]!.name, callId: 'spoof', arguments: {} }, context()))
        .rejects.toThrow('not advertised')
    }
    expect(f.executed).not.toHaveBeenCalled()
  })

  it('fails closed if canonical Gmail classification cannot be read', async () => {
    const f = await fixture()
    f.gmail.hasGoogleData.mockRejectedValue(new Error('Classification unavailable'))
    await expect(f.host.listTools(context())).rejects.toThrow('Classification unavailable')
    await expect(f.host.execute({ toolName: 'echo', callId: 'broken-store', arguments: {} }, context()))
      .rejects.toThrow('Classification unavailable')
    expect(f.pre).not.toHaveBeenCalled()
    expect(f.executed).not.toHaveBeenCalled()
  })
})
