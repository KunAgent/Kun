import { describe, expect, it, vi } from 'vitest'
import { ExtensionApiError } from '@kun/extension-api'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { ExtensionPrincipal } from '../../services/extension-agent-service.js'
import { CapabilityRegistry } from './capability-registry.js'
import {
  ExtensionToolRegistry,
  ExtensionToolCatalogDriftError,
  MAX_DIRECT_EXTENSION_TOOLS,
  canonicalExtensionToolId,
  extensionToolModelAlias
} from './extension-tool-provider.js'
import { LocalToolHost } from './local-tool-host.js'

const principal = (extensionId: string, workspaceRoot = '/tmp/workspace'): ExtensionPrincipal => ({
  extensionId,
  extensionVersion: '1.0.0',
  permissions: ['tools.register'],
  workspaceRoots: [workspaceRoot],
  workspaceTrusted: true
})

function context(input: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace: '/tmp/workspace',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    ...input
  }
}

const echoDeclaration = {
  name: 'echo',
  description: 'Echo a required text value.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', minLength: 1 } },
    required: ['text'],
    additionalProperties: false
  },
  sideEffect: 'none' as const
}

describe('ExtensionToolRegistry', () => {
  it('keeps the Presentation Studio direct-tool namespace stable for GUI provenance', () => {
    expect(extensionToolModelAlias(
      'kun-examples.presentation-studio',
      'presentation-create'
    )).toBe('ext_e1d66f1c97_presentation-create')
  })

  it('derives collision-free identities and executes through LocalToolHost', async () => {
    const capabilities = new CapabilityRegistry()
    const tools = new ExtensionToolRegistry({ registry: capabilities })
    const firstHandler = vi.fn(async (invocation) => ({ output: invocation.arguments }))
    const first = await tools.register(principal('com.example.first'), echoDeclaration, firstHandler)
    const second = await tools.register(principal('com.example.second'), echoDeclaration, async () => ({ output: 'second' }))
    const host = new LocalToolHost({ registry: capabilities })

    expect(first.canonicalToolId).toBe(canonicalExtensionToolId('com.example.first', 'echo'))
    expect(first.modelAlias).toBe(extensionToolModelAlias('com.example.first', 'echo'))
    expect(second.modelAlias).not.toBe(first.modelAlias)
    await expect(host.listTools(context())).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: first.modelAlias, providerKind: 'extension' }),
      expect.objectContaining({ name: second.modelAlias, providerKind: 'extension' })
    ]))

    const result = await host.execute({
      callId: 'call_echo',
      toolName: first.modelAlias,
      providerId: 'extension:com.example.first',
      arguments: { text: 'hello' }
    }, context())
    expect(firstHandler).toHaveBeenCalledTimes(1)
    expect(result.item).toMatchObject({ output: { text: 'hello' }, isError: false })
  })

  it('discovers and invokes one independently registered handler per workspace', async () => {
    const capabilities = new CapabilityRegistry()
    const tools = new ExtensionToolRegistry({ registry: capabilities })
    const workspaceA = '/tmp/workspace-a'
    const workspaceB = '/tmp/workspace-b'
    const workspaceC = '/tmp/workspace-c'
    const first = await tools.register(
      principal('com.example.scoped', workspaceA),
      echoDeclaration,
      async () => ({ output: { owner: 'a' } })
    )
    const second = await tools.register(
      principal('com.example.scoped', workspaceB),
      echoDeclaration,
      async () => ({ output: { owner: 'b' } })
    )
    const host = new LocalToolHost({ registry: capabilities })

    expect(first.modelAlias).toBe(second.modelAlias)
    await expect(host.listTools(context({ workspace: workspaceA }))).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: first.modelAlias })])
    )
    await expect(host.listTools(context({ workspace: workspaceB }))).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: first.modelAlias })])
    )
    await expect(host.listTools(context({ workspace: workspaceC }))).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: first.modelAlias })])
    )

    const invoke = (workspace: string, callId: string) => host.execute({
      callId,
      toolName: first.modelAlias,
      providerId: 'extension:com.example.scoped',
      arguments: { text: 'hello' }
    }, context({ workspace }))
    await expect(invoke(workspaceA, 'call_scoped_a')).resolves.toMatchObject({
      item: { output: { owner: 'a' } }
    })
    await expect(invoke(workspaceB, 'call_scoped_b')).resolves.toMatchObject({
      item: { output: { owner: 'b' } }
    })

    second.dispose()
    await expect(host.listTools(context({ workspace: workspaceB }))).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: first.modelAlias })])
    )
    await expect(invoke(workspaceB, 'call_scoped_b_after_dispose')).rejects.toThrow(
      /unknown tool|unavailable|not advertised/u
    )
    await expect(invoke(workspaceA, 'call_scoped_a_after_dispose')).resolves.toMatchObject({
      item: { output: { owner: 'a' } }
    })
  })

  it('rejects reserved names, undeclared tools, invalid schemas, and invalid arguments', async () => {
    const capabilities = new CapabilityRegistry()
    const tools = new ExtensionToolRegistry({
      registry: capabilities,
      isManifestDeclared: (_principal, declaration) => declaration.name === 'echo'
    })
    await expect(tools.register(principal('com.example.first'), {
      ...echoDeclaration,
      name: 'request_user_input'
    }, async () => ({ output: null }))).rejects.toThrow(/reserved/)
    await expect(tools.register(principal('com.example.first'), {
      ...echoDeclaration,
      name: 'not_declared'
    }, async () => ({ output: null }))).rejects.toThrow(/not declared/)

    const registration = await tools.register(
      principal('com.example.first'), echoDeclaration, async () => ({ output: 'ok' })
    )
    const host = new LocalToolHost({ registry: capabilities })
    const result = await host.execute({
      callId: 'call_invalid', toolName: registration.modelAlias, arguments: { extra: true }
    }, context())
    expect(result.item).toMatchObject({
      isError: true,
      output: { code: 'tool_execution_failed', error: expect.stringMatching(/required property.*text/) }
    })
  })

  it('compiles JSON Schemas at registration and rejects invalid declared output', async () => {
    const capabilities = new CapabilityRegistry()
    const tools = new ExtensionToolRegistry({ registry: capabilities })
    await expect(tools.register(principal('com.example.invalid-schema'), {
      ...echoDeclaration,
      inputSchema: { type: 'object', properties: { value: { $ref: '#/$defs/missing' } } }
    }, async () => ({ output: null }))).rejects.toThrow(/invalid extension tool echo input JSON Schema/)

    const registration = await tools.register(principal('com.example.output'), {
      ...echoDeclaration,
      outputSchema: {
        type: 'object',
        properties: { echoed: { type: 'string' } },
        required: ['echoed'],
        additionalProperties: false
      }
    }, async () => ({ output: { echoed: 42 } }))
    const host = new LocalToolHost({ registry: capabilities })
    const result = await host.execute({
      callId: 'call_invalid_output',
      toolName: registration.modelAlias,
      arguments: { text: 'hello' }
    }, context())

    expect(result.item).toMatchObject({
      isError: true,
      output: {
        code: 'tool_execution_failed',
        error: expect.stringMatching(/result does not match its declared JSON Schema/)
      }
    })
  })

  it('keeps external effects behind explicit approval and fences unknown outcomes from retry', async () => {
    const capabilities = new CapabilityRegistry()
    const tools = new ExtensionToolRegistry({ registry: capabilities })
    let calls = 0
    const registration = await tools.register(principal('com.example.sender'), {
      ...echoDeclaration,
      name: 'send_message',
      sideEffect: 'external'
    }, async () => {
      calls += 1
      throw new Error('extension host disconnected')
    })
    const host = new LocalToolHost({ registry: capabilities })
    const awaitApproval = vi.fn(async () => 'allow' as const)
    const call = {
      callId: 'call_external', toolName: registration.modelAlias, arguments: { text: 'hello' }
    }
    const first = await host.execute(call, context({ awaitApproval }))
    const second = await host.execute(call, context({ awaitApproval }))

    expect(awaitApproval).toHaveBeenCalledTimes(2)
    expect(calls).toBe(1)
    expect(first.item).toMatchObject({
      isError: true,
      output: { error: expect.stringContaining('outcome is unknown') }
    })
    expect(second.item).toMatchObject({
      isError: true,
      output: { code: 'tool_outcome_unknown' }
    })
  })

  it('keeps deterministic public API rejections retryable without relaxing unknown outcomes', async () => {
    const capabilities = new CapabilityRegistry()
    const tools = new ExtensionToolRegistry({ registry: capabilities })
    let conflictCalls = 0
    const conflict = await tools.register(principal('com.example.conflict'), {
      ...echoDeclaration,
      name: 'save',
      sideEffect: 'workspace-write'
    }, async () => {
      conflictCalls += 1
      throw new ExtensionApiError({
        code: 'CONFLICT',
        message: 'The expected revision is stale.',
        retryable: true,
        details: { expectedRevision: 2, actualRevision: 3 }
      })
    })
    let unavailableCalls = 0
    const unavailable = await tools.register(principal('com.example.unavailable'), {
      ...echoDeclaration,
      name: 'send',
      sideEffect: 'external'
    }, async () => {
      unavailableCalls += 1
      throw new ExtensionApiError({
        code: 'HOST_UNAVAILABLE',
        message: 'The extension host disconnected.',
        retryable: true
      })
    })
    const host = new LocalToolHost({ registry: capabilities })
    const awaitApproval = vi.fn(async () => 'allow' as const)
    const conflictCall = {
      callId: 'call_conflict', toolName: conflict.modelAlias, arguments: { text: 'save' }
    }
    const firstConflict = await host.execute(conflictCall, context({ awaitApproval }))
    const secondConflict = await host.execute(conflictCall, context({ awaitApproval }))

    expect(conflictCalls).toBe(2)
    expect(firstConflict.item).toMatchObject({
      isError: true,
      output: {
        code: 'tool_execution_failed',
        error: 'The expected revision is stale.'
      }
    })
    expect(secondConflict.item).toMatchObject({
      isError: true,
      output: { code: 'tool_execution_failed' }
    })

    const unavailableCall = {
      callId: 'call_unavailable', toolName: unavailable.modelAlias, arguments: { text: 'send' }
    }
    const firstUnavailable = await host.execute(unavailableCall, context({ awaitApproval }))
    const secondUnavailable = await host.execute(unavailableCall, context({ awaitApproval }))
    expect(unavailableCalls).toBe(1)
    expect(firstUnavailable.item).toMatchObject({
      isError: true,
      output: { error: expect.stringContaining('outcome is unknown') }
    })
    expect(secondUnavailable.item).toMatchObject({
      isError: true,
      output: { code: 'tool_outcome_unknown' }
    })
  })

  it('bounds output and cancels in-flight handlers when disposed', async () => {
    const capabilities = new CapabilityRegistry()
    const tools = new ExtensionToolRegistry({ registry: capabilities })
    const large = await tools.register(principal('com.example.large'), {
      ...echoDeclaration,
      maxOutputBytes: 1_024
    }, async () => ({ output: 'x'.repeat(8_000) }))
    const host = new LocalToolHost({ registry: capabilities })
    const largeResult = await host.execute({
      callId: 'call_large', toolName: large.modelAlias, arguments: { text: 'large' }
    }, context())
    expect(largeResult.item).toMatchObject({ output: { truncated: true, originalBytes: 8_000 } })

    let sawAbort = false
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const pending = await tools.register(principal('com.example.pending'), echoDeclaration, async ({ signal }) => {
      markStarted()
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          sawAbort = true
          reject(new Error('cancelled'))
        }, { once: true })
      })
      return { output: 'unreachable' }
    })
    const executing = host.execute({
      callId: 'call_pending', toolName: pending.modelAlias, arguments: { text: 'wait' }
    }, context())
    await started
    pending.dispose()
    const cancelled = await executing
    expect(sawAbort).toBe(true)
    expect(cancelled.item).toMatchObject({ isError: true })
    await expect(host.listTools(context())).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: pending.modelAlias })])
    )
  })

  it('builds canonical epochs independent of activation order and fences drift', async () => {
    const firstCapabilities = new CapabilityRegistry()
    const firstTools = new ExtensionToolRegistry({ registry: firstCapabilities })
    const firstB = await firstTools.register(principal('com.example.epoch'), {
      ...echoDeclaration, name: 'beta'
    }, async () => ({ output: 'b' }))
    await firstTools.register(principal('com.example.epoch'), {
      ...echoDeclaration, name: 'alpha'
    }, async () => ({ output: 'a' }))
    const firstEpoch = firstTools.createCatalogEpoch({ id: 'epoch_first', createdAt: '2026-07-11T00:00:00.000Z' })

    const secondCapabilities = new CapabilityRegistry()
    const secondTools = new ExtensionToolRegistry({ registry: secondCapabilities })
    await secondTools.register(principal('com.example.epoch'), {
      ...echoDeclaration, name: 'alpha'
    }, async () => ({ output: 'a' }))
    await secondTools.register(principal('com.example.epoch'), {
      ...echoDeclaration, name: 'beta'
    }, async () => ({ output: 'b' }))
    const secondEpoch = secondTools.createCatalogEpoch({ id: 'epoch_second', createdAt: '2026-07-11T00:00:00.000Z' })

    expect(firstEpoch.fingerprint).toBe(secondEpoch.fingerprint)
    expect(firstEpoch.canonicalToolIds).toEqual(secondEpoch.canonicalToolIds)
    const firstHost = new LocalToolHost({ registry: firstCapabilities })
    await expect(firstHost.listTools(context({ extensionToolCatalogEpoch: firstEpoch }))).resolves.toEqual(
      expect.arrayContaining(firstEpoch.tools!.map((tool) => expect.objectContaining({ name: tool.modelAlias })))
    )

    firstB.dispose()
    expect(() => firstHost.listTools(context({ extensionToolCatalogEpoch: firstEpoch }))).toThrow(
      ExtensionToolCatalogDriftError
    )
  })

  it('uses stable search/call gateways for large pinned catalogs', async () => {
    const capabilities = new CapabilityRegistry()
    const tools = new ExtensionToolRegistry({ registry: capabilities })
    for (let index = 0; index < MAX_DIRECT_EXTENSION_TOOLS + 1; index += 1) {
      await tools.register(principal('com.example.many'), {
        ...echoDeclaration,
        name: `tool_${index}`,
        description: `Catalog utility number ${index}`,
        sideEffect: index === MAX_DIRECT_EXTENSION_TOOLS ? 'workspace-write' : 'none'
      }, async ({ arguments: args }) => ({ output: { echoed: args.text, index } }))
    }
    const epoch = tools.createCatalogEpoch({ id: 'epoch_many', createdAt: '2026-07-11T00:00:00.000Z' })
    const host = new LocalToolHost({ registry: capabilities })
    const toolContext = context({ extensionToolCatalogEpoch: epoch })
    const listed = await host.listTools(toolContext)
    expect(listed.map((tool) => tool.name).sort()).toEqual(['extension_tool_call', 'extension_tool_search'])

    const searched = await host.execute({
      callId: 'call_search',
      toolName: 'extension_tool_search',
      arguments: { query: `utility number ${MAX_DIRECT_EXTENSION_TOOLS}`, limit: 3 }
    }, toolContext)
    expect(searched.item).toMatchObject({
      output: {
        epochId: 'epoch_many',
        tools: expect.arrayContaining([
          expect.objectContaining({ canonicalToolId: `extension:com.example.many/tool_${MAX_DIRECT_EXTENSION_TOOLS}` })
        ])
      }
    })

    const called = await host.execute({
      callId: 'call_gateway',
      toolName: 'extension_tool_call',
      arguments: {
        canonicalToolId: `extension:com.example.many/tool_${MAX_DIRECT_EXTENSION_TOOLS}`,
        arguments: { text: 'hello' }
      }
    }, toolContext)
    expect(called.item).toMatchObject({
      output: {
        canonicalToolId: `extension:com.example.many/tool_${MAX_DIRECT_EXTENSION_TOOLS}`,
        sideEffect: 'workspace-write',
        result: { echoed: 'hello', index: MAX_DIRECT_EXTENSION_TOOLS }
      }
    })
  })
})
