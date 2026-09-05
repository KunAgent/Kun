import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  ExtensionManifestSchema,
  MediaCreateCacheTargetResultSchema,
  type MediaAnalyzeVisualFramesRequest,
  type MediaEmbedVisualQueryRequest,
  type ModelProviderAdapter
} from '@kun/extension-api'
import type { ExtensionToolHandler } from '../adapters/tool/extension-tool-provider.js'
import type { ExtensionBrokerRequest, ExtensionPrincipal as HostPrincipal } from '../extensions/host-process.js'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import {
  ExtensionHostBroker,
  requiredExtensionBrokerPermission
} from './extension-host-broker.js'
import { ExtensionMediaHandleService } from './extension-media-handle-service.js'

const WORKSPACE_ROOT = resolve('/tmp/workspace')

const WORKSPACE_ID = extensionWorkspaceKey(WORKSPACE_ROOT)

const manifest = ExtensionManifestSchema.parse({
  manifestVersion: 1,
  apiVersion: '1.0.0',
  name: 'broker',
  publisher: 'acme',
  version: '1.0.0',
  engines: { kun: '>=0.1.0' },
  main: 'dist/extension.js',
  activationEvents: [
    'onCommand:hello',
    'onTool:summarize',
    'onProvider:echo',
    'onAuthentication:echo-auth'
  ],
  contributes: {
    commands: [{
      id: 'hello',
      title: 'Hello',
      inputSchema: { type: 'object' },
      outputSchema: {
        type: 'object',
        properties: { invoked: { type: 'boolean' } },
        required: ['invoked'],
        additionalProperties: false
      }
    }],
    tools: [{
      id: 'summarize',
      description: 'Summarize input',
      inputSchema: { type: 'object' },
      outputSchema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
        additionalProperties: false
      },
      sideEffects: 'external'
    }],
    modelProviders: [{
      id: 'echo',
      displayName: 'Echo',
      authenticationProviderId: 'echo-auth',
      credentialHosts: ['api.example.test'],
      models: [{
        id: 'echo-1',
        displayName: 'Echo 1',
        capabilities: { input: ['text'], output: ['text'] }
      }]
    }],
    authentication: [{
      id: 'echo-auth',
      displayName: 'Echo API key',
      type: 'api-key'
    }],
    settings: [{
      id: 'general',
      title: 'General',
      properties: { mode: { type: 'string', default: 'safe' } }
    }]
  },
  permissions: [
    'commands.register',
    'tools.register',
    'providers.register',
    'ui.actions',
    'network:api.example.test'
  ],
  stateSchemaVersion: 1
})

const principal: HostPrincipal = {
  extensionId: 'acme.broker',
  version: '1.0.0',
  apiVersion: '1.0.0',
  lifecycleNonce: 'de7c65b3-f455-4199-aa83-1722fdf8309d',
  grantedPermissions: manifest.permissions,
  workspaceRoots: [WORKSPACE_ROOT],
  development: true
}

function request(method: string, params: unknown): ExtensionBrokerRequest {
  return {
    principal,
    method,
    params: JSON.parse(JSON.stringify(params ?? null)),
    signal: new AbortController().signal,
    requestId: `request_${method}`
  }
}

function createBroker(overrides: Record<string, unknown> = {}): ExtensionHostBroker {
  const state = new Map<string, unknown>()
  return new ExtensionHostBroker({
    agent: {} as never,
    profiles: { register: () => () => undefined } as never,
    tools: { register: vi.fn() } as never,
    modelProviders: { register: vi.fn() } as never,
    providerAccounts: {
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
      getAccount: vi.fn(),
      requireOwnedProvider: vi.fn(),
      validateBinding: vi.fn()
    } as never,
    accounts: {} as never,
    credentials: { protection: async () => ({ mode: 'encrypted-fallback' }) } as never,
    state: {
      read: async () => ({
        global: Object.fromEntries(state),
        workspaces: {}
      }),
      getGlobal: async (_id: string, key: string) => state.get(key),
      setGlobal: async (_id: string, key: string, value: unknown) => {
        if (value === undefined) state.delete(key)
        else state.set(key, value)
      }
    } as never,
    invokeExtension: vi.fn(async () => null),
    notifyExtension: vi.fn(async () => undefined),
    resolveManifest: async () => manifest,
    ...overrides
  } as never)
}

function cancellationContext() {
  return {
    cancellation: {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose() {} })
    }
  }
}

describe('ExtensionHostBroker', () => {
  it('preserves the manifest output schema and content value at the ToolHost boundary', async () => {
      let toolHandler: ExtensionToolHandler | undefined
      const register = vi.fn(async (_principal, _declaration, handler) => {
        toolHandler = handler
        return {
          canonicalToolId: 'extension:acme.broker/summarize',
          modelAlias: 'ext_summary',
          dispose() {}
        }
      })
      const broker = createBroker({
        invokeExtension: vi.fn(async () => ({ content: { summary: 42 } })),
        tools: { register }
      })
      await broker.handle(request('tools.register', manifest.contributes.tools[0]))
      expect(register).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ outputSchema: manifest.contributes.tools[0]!.outputSchema }),
        expect.any(Function)
      )

      await expect(toolHandler!({
        invocationId: 'invocation_invalid_output',
        canonicalToolId: 'extension:acme.broker/summarize',
        modelAlias: 'ext_summary',
        arguments: {},
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspace: '/tmp/workspace',
        signal: new AbortController().signal,
        reportProgress: async () => undefined
      })).resolves.toMatchObject({
        declaredOutput: { summary: 42 }
      })
    })

  it('keeps bounded legacy model-provider notifications compatible', async () => {
      let adapter: ModelProviderAdapter | undefined
      let broker!: ExtensionHostBroker
      const invokeExtension = vi.fn(async (
        _extensionId: string,
        _event: string,
        method: string,
        params: unknown
      ) => {
        if (method.startsWith('modelProviders.invoke:') && (params as { operation: string }).operation === 'stream') {
          const registrationId = method.slice('modelProviders.invoke:'.length)
          const modelRequest = (params as { request: { requestId: string } }).request
          await broker.notification(principal, 'modelProviders.streamEvent', {
            registrationId,
            event: { requestId: modelRequest.requestId, sequence: 0, type: 'textDelta', delta: 'hello' }
          })
          await broker.notification(principal, 'modelProviders.streamEvent', {
            registrationId,
            event: { requestId: modelRequest.requestId, sequence: 1, type: 'completed', finishReason: 'stop' }
          })
        }
        return { accepted: true }
      })
      broker = createBroker({
        invokeExtension,
        providerAccounts: {
          registerProvider: vi.fn(async () => ({ id: 'ext-provider-echo' })),
          unregisterProvider: vi.fn(async () => true)
        },
        modelProviders: {
          register: vi.fn(async (_principal, _declaration, registeredAdapter) => {
            adapter = registeredAdapter
            return { providerId: 'ext-provider-echo', async dispose() {} }
          })
        }
      })

      await broker.handle(request('modelProviders.register', manifest.contributes.modelProviders[0]))
      const events = []
      for await (const event of adapter!.stream({
        apiVersion: '1.0.0',
        requestId: 'model_request_1',
        binding: { providerId: 'ext-provider-echo', accountId: 'account_1', modelId: 'echo-1' },
        instructions: [],
        messages: [],
        tools: [],
        generation: {}
      }, cancellationContext())) events.push(event)
      expect(events.map((event) => event.type)).toEqual(['textDelta', 'completed'])
    })

  it('bridges acknowledgement-backed provider stream envelopes per model request', async () => {
      let adapter: ModelProviderAdapter | undefined
      let broker!: ExtensionHostBroker
      const invokeExtension = vi.fn(async (
        _extensionId: string,
        _event: string,
        method: string,
        params: unknown
      ) => {
        if (method.startsWith('modelProviders.invoke:') && (params as { operation: string }).operation === 'stream') {
          const registrationId = method.slice('modelProviders.invoke:'.length)
          const modelRequest = (params as { request: { requestId: string } }).request
          await broker.stream(principal, 'rpc_model_request_1', 1, {
            kind: 'event',
            registrationId,
            requestId: modelRequest.requestId,
            event: {
              requestId: modelRequest.requestId,
              sequence: 0,
              type: 'textDelta',
              delta: 'streamed'
            }
          }, false)
          await broker.stream(principal, 'rpc_model_request_1', 2, {
            kind: 'event',
            registrationId,
            requestId: modelRequest.requestId,
            event: {
              requestId: modelRequest.requestId,
              sequence: 1,
              type: 'completed',
              finishReason: 'stop'
            }
          }, true)
        }
        return { accepted: true }
      })
      broker = createBroker({
        invokeExtension,
        providerAccounts: {
          registerProvider: vi.fn(async () => ({ id: 'ext-provider-echo' })),
          unregisterProvider: vi.fn(async () => true)
        },
        modelProviders: {
          register: vi.fn(async (_principal, _declaration, registeredAdapter) => {
            adapter = registeredAdapter
            return { providerId: 'ext-provider-echo', async dispose() {} }
          })
        }
      })

      await broker.handle(request('modelProviders.register', manifest.contributes.modelProviders[0]))
      const events = []
      for await (const event of adapter!.stream({
        apiVersion: '1.0.0',
        requestId: 'model_request_stream',
        binding: { providerId: 'ext-provider-echo', accountId: 'account_1', modelId: 'echo-1' },
        instructions: [],
        messages: [],
        tools: [],
        generation: {}
      }, cancellationContext())) events.push(event)
      expect(events.map((event) => event.type)).toEqual(['textDelta', 'completed'])
    })

  it('fails only the overflowing legacy provider request instead of growing its queue', async () => {
      let adapter: ModelProviderAdapter | undefined
      let broker!: ExtensionHostBroker
      const invokeExtension = vi.fn(async (
        _extensionId: string,
        _event: string,
        method: string,
        params: unknown
      ) => {
        const registrationId = method.slice('modelProviders.invoke:'.length)
        const modelRequest = (params as { request: { requestId: string } }).request
        for (let sequence = 0; sequence < 3; sequence += 1) {
          void broker.notification(principal, 'modelProviders.streamEvent', {
            registrationId,
            event: {
              requestId: modelRequest.requestId,
              sequence,
              type: 'textDelta',
              delta: `event-${sequence}`
            }
          })
        }
        return { accepted: true }
      })
      broker = createBroker({
        invokeExtension,
        providerStreamQueueEvents: 1,
        providerAccounts: {
          registerProvider: vi.fn(async () => ({ id: 'ext-provider-echo' })),
          unregisterProvider: vi.fn(async () => true)
        },
        modelProviders: {
          register: vi.fn(async (_principal, _declaration, registeredAdapter) => {
            adapter = registeredAdapter
            return { providerId: 'ext-provider-echo', async dispose() {} }
          })
        }
      })

      await broker.handle(request('modelProviders.register', manifest.contributes.modelProviders[0]))
      const iterator = adapter!.stream({
        apiVersion: '1.0.0',
        requestId: 'model_request_overflow',
        binding: { providerId: 'ext-provider-echo', accountId: 'account_1', modelId: 'echo-1' },
        instructions: [],
        messages: [],
        tools: [],
        generation: {}
      }, cancellationContext())[Symbol.asyncIterator]()
      await expect(iterator.next()).rejects.toThrow('queue limit exceeded')
    })

  it('returns fixed pre-gate permissions and leaves dynamic network scopes to broker validation', () => {
      expect(requiredExtensionBrokerPermission('storage.get', { scope: 'global', key: 'x' })).toBe('storage.global')
      expect(requiredExtensionBrokerPermission('secrets.get', { key: 'x' })).toBe('storage.secrets')
      expect(requiredExtensionBrokerPermission('agent.getRunOptions', {})).toBe('agent.run')
      expect(requiredExtensionBrokerPermission('agent.createRun', {})).toBe('agent.run')
      expect(requiredExtensionBrokerPermission('ui.attachComposerContext', {})).toBe('ui.actions')
      expect(requiredExtensionBrokerPermission('network.fetch', { url: 'https://api.example.test' })).toBeUndefined()
    })
})
