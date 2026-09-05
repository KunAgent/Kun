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
  it('routes live Agent events to the sender-bound View while keeping Node subscriptions on Node IPC', async () => {
      const listeners: Array<(event: {
        seq: number
        timestamp: string
        type: 'assistant_text_delta' | 'turn_completed'
        runId: string
        threadId: string
        ownerExtensionId: string
        payload: Record<string, unknown>
      }) => Promise<void> | void> = []
      const closes: Array<ReturnType<typeof vi.fn>> = []
      const agent = {
        subscribe: vi.fn(async (_principal, _input, listener) => {
          listeners.push(listener)
          const close = vi.fn()
          closes.push(close)
          return { lastDeliveredSeq: 0, closed: false, close }
        })
      }
      const notifyView = vi.fn(async () => undefined)
      const notifyExtension = vi.fn(async () => undefined)
      const broker = createBroker({ agent, notifyView, notifyExtension })
      const viewPrincipal = {
        extensionId: 'acme.broker',
        extensionVersion: '1.0.0',
        permissions: ['agent.run'],
        workspaceRoots: ['/tmp/workspace'],
        workspaceTrusted: true,
        viewSessionId: 'view-session-one',
        viewContributionId: 'extension:acme.broker/panel'
      } as const

      const viewSubscription = await broker.handlePrincipal({
        principal: viewPrincipal,
        method: 'agent.subscribe',
        params: { runId: 'run-1', afterSequence: 0 },
        signal: new AbortController().signal,
        requestId: 'subscribe-from-view'
      }) as { subscriptionId: string }
      await listeners[0]!({
        seq: 1,
        timestamp: new Date().toISOString(),
        type: 'assistant_text_delta',
        runId: 'run-1',
        threadId: 'thread-1',
        ownerExtensionId: 'acme.broker',
        payload: {
          role: 'assistant', messageId: 'message:assistant-1', phase: 'delta', content: 'hello'
        }
      })

      expect(notifyView).toHaveBeenCalledWith({
        principal: viewPrincipal,
        method: 'agent.event',
        params: expect.objectContaining({
          subscriptionId: viewSubscription.subscriptionId,
          event: expect.objectContaining({ type: 'message', sequence: 2 })
        })
      })
      expect(notifyExtension).not.toHaveBeenCalled()

      await broker.handlePrincipal({
        principal: { ...viewPrincipal, viewSessionId: 'view-session-two' },
        method: 'agent.unsubscribe',
        params: { subscriptionId: viewSubscription.subscriptionId },
        signal: new AbortController().signal,
        requestId: 'foreign-view-unsubscribe'
      })
      expect(closes[0]).not.toHaveBeenCalled()
      expect(broker.disposeViewSession('view-session-one')).toBe(1)
      expect(closes[0]).toHaveBeenCalledTimes(1)

      const failedViewSubscription = await broker.handlePrincipal({
        principal: viewPrincipal,
        method: 'agent.subscribe',
        params: { runId: 'run-failed-view', afterSequence: 0 },
        signal: new AbortController().signal,
        requestId: 'subscribe-from-failed-view'
      }) as { subscriptionId: string }
      notifyView.mockRejectedValueOnce(new Error('view session closed'))
      await expect(listeners[1]!({
        seq: 1,
        timestamp: new Date().toISOString(),
        type: 'assistant_text_delta',
        runId: 'run-failed-view',
        threadId: 'thread-failed-view',
        ownerExtensionId: 'acme.broker',
        payload: {
          role: 'assistant', messageId: 'message:assistant-late', phase: 'delta', content: 'late'
        }
      })).rejects.toThrow('view session closed')
      expect(closes[1]).toHaveBeenCalledTimes(1)
      expect(broker.disposeViewSession('view-session-one')).toBe(0)
      expect(failedViewSubscription.subscriptionId).toMatch(/^agentsub_/)

      const nodeSubscription = await broker.handle(request('agent.subscribe', {
        runId: 'run-2',
        afterSequence: 0
      })) as { subscriptionId: string }
      await listeners[2]!({
        seq: 2,
        timestamp: new Date().toISOString(),
        type: 'turn_completed',
        runId: 'run-2',
        threadId: 'thread-2',
        ownerExtensionId: 'acme.broker',
        payload: {}
      })
      expect(notifyExtension).toHaveBeenCalledWith(
        expect.objectContaining({
          extensionId: 'acme.broker',
          hostLifecycleNonce: principal.lifecycleNonce,
          workspaceRoots: [WORKSPACE_ROOT]
        }),
        'agent.event',
        expect.objectContaining({ subscriptionId: nodeSubscription.subscriptionId })
      )
      expect(closes[2]).toHaveBeenCalledTimes(1)
    })

  it('bounds network responses, strips credential headers, and never auto-follows redirects', async () => {
      const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        expect(init?.redirect).toBe('manual')
        let sent = 0
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent >= 2) {
              controller.close()
              return
            }
            sent += 1
            controller.enqueue(new Uint8Array(5 * 1024 * 1024).fill(97))
          }
        })
        return new Response(body, {
          status: 200,
          headers: {
            'content-type': 'text/plain',
            'set-cookie': 'secret=value',
            authorization: 'Bearer response-secret',
            'x-request-id': 'safe-id'
          }
        })
      }) as unknown as typeof fetch
      const broker = createBroker({ fetch: fetchImpl })
      const result = await broker.handlePrincipal({
        principal: {
          extensionId: 'acme.broker',
          extensionVersion: '1.0.0',
          permissions: ['network:api.example.test'],
          workspaceRoots: [],
          workspaceTrusted: false
        },
        method: 'network.fetch',
        params: { url: 'https://api.example.test/large' },
        signal: new AbortController().signal,
        requestId: 'bounded-network-response'
      }) as { body: string; truncated: boolean; headers: Record<string, string> }
      expect(Buffer.byteLength(result.body)).toBe(8 * 1024 * 1024)
      expect(result.truncated).toBe(true)
      expect(result.headers['set-cookie']).toBeUndefined()
      expect(result.headers.authorization).toBeUndefined()
      expect(result.headers['x-request-id']).toBe('safe-id')
    })

  it('uses the production DNS/address policy when no test fetch is injected', async () => {
      const broker = createBroker()
      await expect(broker.handlePrincipal({
        principal: {
          extensionId: 'acme.broker',
          extensionVersion: '1.0.0',
          permissions: ['network:127.0.0.1'],
          workspaceRoots: [],
          workspaceTrusted: false
        },
        method: 'network.fetch',
        params: { url: 'https://127.0.0.1/metadata' },
        signal: new AbortController().signal,
        requestId: 'blocked-loopback-network'
      })).rejects.toThrow(/resolved to blocked loopback address 127\.0\.0\.1/)
    })

  it('persists global Webview state per contribution when no workspace is active', async () => {
      const broker = createBroker()
      const viewPrincipal = {
        extensionId: 'acme.broker',
        extensionVersion: '1.0.0',
        permissions: ['ui.views'],
        workspaceRoots: [],
        workspaceTrusted: false,
        viewContributionId: 'extension:acme.broker/primary'
      } as const
      const signal = new AbortController().signal
      await broker.handlePrincipal({
        principal: viewPrincipal,
        method: 'ui.setViewState',
        params: { value: { selected: 'item-1' } },
        signal,
        requestId: 'set-view-state'
      })
      await expect(broker.handlePrincipal({
        principal: viewPrincipal,
        method: 'ui.getViewState',
        params: {},
        signal,
        requestId: 'get-view-state'
      })).resolves.toEqual({ found: true, value: { selected: 'item-1' } })
      await expect(broker.handlePrincipal({
        principal: { ...viewPrincipal, viewContributionId: 'extension:acme.broker/secondary' },
        method: 'ui.getViewState',
        params: {},
        signal,
        requestId: 'get-other-view-state'
      })).resolves.toEqual({ found: false })
    })
})
