import { describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../in-memory-thread-store.js'
import { createThreadRecord } from '../../domain/thread.js'
import { createTurnRecord } from '../../domain/turn.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { GmailServicePort } from '../../gmail/ports.js'
import { GMAIL_SCOPES } from '../../gmail/ports.js'
import { CapabilityRegistry } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import { buildGmailToolProvider } from './gmail-tool-provider.js'
import type { HookInvocation } from '../../hooks/hook-engine.js'

const nativeNames = ['gmail_connect', 'gmail_search', 'gmail_read', 'gmail_send']
const context = (patch: Partial<ToolHostContext> = {}): ToolHostContext => ({
  threadId: 'gmail-thread', turnId: 'gmail-turn', workspace: '/tmp',
  clientSurface: 'gui', harnessId: 'kun',
  modelProviderId: 'kun-gmail-local', actingModelRoute: { providerId: 'kun-gmail-local', model: 'qwen3:4b' },
  sandboxMode: 'danger-full-access', approvalPolicy: 'auto', approvalReviewer: 'user',
  abortSignal: new AbortController().signal, awaitApproval: vi.fn(async () => 'allow' as const), ...patch
})
const localTool = (name: string, execute = vi.fn(async () => ({ output: 'should not run' }))) => LocalToolHost.defineTool({
  name, description: name, inputSchema: { type: 'object' }, policy: 'auto',
  sideEffect: 'read-only', execute
})

describe('dedicated Gmail acting-model host tool boundary', () => {
  it('advertises only exact native mail tools and rejects guessed non-mail calls before executing or approving', async () => {
    const forbidden = ['bash', 'web_search', 'write', 'memory_write', 'delegate_task']
    const executed = vi.fn(async () => ({ output: 'blocked' }))
    const registry = new CapabilityRegistry([
      { id: 'gmail', kind: 'built-in', enabled: true, available: true, tools: nativeNames.map((name) => localTool(name)) },
      { id: 'builtin', kind: 'built-in', enabled: true, available: true, tools: forbidden.map((name) => localTool(name, executed)) }
    ])
    const host = new LocalToolHost({ registry })
    const ctx = context({ allowedProviderIds: ['gmail', 'builtin'], allowedToolNames: [...nativeNames, ...forbidden] })
    expect((await host.listTools(ctx)).map((spec) => spec.name)).toEqual(nativeNames)
    for (const toolName of forbidden) {
      await expect(host.execute({ toolName, callId: `guess-${toolName}`, arguments: { command: 'exfiltrate email' } }, ctx)).rejects.toThrow('not advertised')
    }
    expect(executed).not.toHaveBeenCalled()
    expect(ctx.awaitApproval).not.toHaveBeenCalled()
  })

  it('rejects a mail-shaped MCP tool and a non-mail tool hidden inside a mail-named provider', async () => {
    const executed = vi.fn(async () => ({ output: 'blocked' }))
    for (const provider of [
      { id: 'gmail', kind: 'mcp' as const, enabled: true, available: true, tools: [localTool('gmail_read', executed)] },
      { id: 'gmail', kind: 'built-in' as const, enabled: true, available: true, tools: [localTool('bash', executed)] }
    ]) {
      const host = new LocalToolHost({ registry: new CapabilityRegistry([provider]) })
      expect(await host.listTools(context())).toEqual([])
      await expect(host.execute({ toolName: provider.tools[0].name, callId: 'spoof', arguments: {} }, context())).rejects.toThrow('not advertised')
    }
    expect(executed).not.toHaveBeenCalled()
  })

  it('uses the admitted acting route instead of a stale configured model provider', async () => {
    const registry = CapabilityRegistry.fromLocalTools([localTool('bash')])
    const current = context({ modelProviderId: 'other', actingModelRoute: { model: 'qwen3:4b', providerId: 'kun-gmail-local' } })
    expect(registry.listTools(current)).toEqual([])
    expect(() => registry.resolveTool('bash', current)).toThrow('not advertised')
    expect(registry.listTools(context({ modelProviderId: 'kun-gmail-local', actingModelRoute: { model: 'normal', providerId: 'other' } })))
      .toHaveLength(1)
  })
  it('never sends native Gmail arguments or results to pre/post hooks, while preserving ordinary hooks', async () => {
    const pre = vi.fn((_invocation: HookInvocation) => {})
    const post = vi.fn((_invocation: HookInvocation) => {})
    const registry = new CapabilityRegistry([
      { id: 'gmail', kind: 'built-in', enabled: true, available: true,
        tools: [localTool('gmail_read', vi.fn(async () => ({ output: 'private email body' })))] },
      { id: 'builtin', kind: 'built-in', enabled: true, available: true, tools: [localTool('echo')] }
    ])
    const host = new LocalToolHost({ registry, hooks: [
      { phase: 'PreToolUse', run: pre }, { phase: 'PostToolUse', run: post }
    ] })
    const normal = context({ actingModelRoute: { providerId: 'other', model: 'normal' }, modelProviderId: 'other' })
    await host.execute({ toolName: 'gmail_read', callId: 'native-normal', arguments: { messageId: 'private-message' } }, normal)
    await host.execute({ toolName: 'gmail_read', callId: 'native-local', arguments: { messageId: 'private-message' } }, context())
    expect(pre).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    await host.execute({ toolName: 'echo', callId: 'normal', arguments: {} }, normal)
    expect(pre).toHaveBeenCalledOnce()
    expect(post).toHaveBeenCalledOnce()
  })

  it('retains a mandatory human send approval even in full access', async () => {
    const threads = new InMemoryThreadStore()
    const thread = createThreadRecord({ id: 'gmail-thread', title: 'Gmail', workspace: '/tmp', model: 'qwen3:4b' })
    thread.turns.push(createTurnRecord({ id: 'gmail-turn', threadId: thread.id, prompt: 'Mail', status: 'running' }))
    await threads.upsert(thread)
    const send = vi.fn(async () => ({ id: 'sent', status: 'sent' }))
    const gmail = { hasGoogleData: vi.fn(async () => true), markGoogleData: vi.fn(async () => {}),
      status: vi.fn(async () => ({ configured: true, connected: true, reconnectRequired: false,
        email: 'owner@example.com', scopes: [...GMAIL_SCOPES], allowModelSharing: true })), send } as unknown as GmailServicePort
    const host = new LocalToolHost({ registry: new CapabilityRegistry([buildGmailToolProvider(gmail, threads)]) })
    const awaitApproval = vi.fn(async () => ({ decision: 'allow' as const, reviewer: 'agent' as const }))
    const result = await host.execute({ toolName: 'gmail_send', callId: 'send', arguments: {
      to: ['recipient@example.com'], subject: 'Review', body: 'The complete message' } }, context({ awaitApproval }))
    expect(awaitApproval).toHaveBeenCalledOnce()
    expect(result.item).toMatchObject({ isError: true, output: { code: 'approval_denied' } })
    expect(send).not.toHaveBeenCalled()
  })
})
