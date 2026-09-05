import { resolve } from 'node:path'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import {
  ExtensionAgentService,
  type ExtensionAgentRunOptions,
  type ExtensionPrincipal
} from './extension-agent-service.js'
import { ExtensionAgentProfileRegistry } from './extension-agent-profile-registry.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { ThreadService } from './thread-service.js'
import { TurnService } from './turn-service.js'

export const workspace = resolve('/tmp/kun-extension-workspace')

export function createExtensionAgentHarness(headless = false) {
  const threadStore = new InMemoryThreadStore()
  const sessions = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const ids = new SequentialIdGenerator()
  const nowIso = () => '2026-07-11T08:00:00.000Z'
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore: sessions,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
    nowIso
  })
  const threads = new ThreadService({ threadStore, sessionStore: sessions, events, ids, nowIso })
  const turns = new TurnService({
    threadStore,
    sessionStore: sessions,
    events,
    inflight: new InflightTracker(),
    steering: new SteeringQueue(),
    compactor: new ContextCompactor(),
    ids,
    nowIso
  })
  const profiles = new ExtensionAgentProfileRegistry()
  profiles.register({
    extensionId: 'com.example.agent',
    extensionVersion: '1.2.3',
    profiles: [{
      id: 'reviewer',
      displayName: 'Reviewer',
      instructionOverlay: 'Review carefully. Do not change Kun policy.',
      providerBinding: {
        providerId: 'example-provider',
        accountId: 'account_1',
        modelId: 'example-model'
      },
      allowedToolScopes: ['read'],
      defaultBudget: { maxTokens: 800_000 },
      visibility: 'workspace'
    }]
  })
  const launched: Array<{ threadId: string; turnId: string }> = []
  let runOptions: ExtensionAgentRunOptions = {
    defaultModel: 'default-model',
    models: [
      {
        id: 'default-model',
        displayName: 'Default model',
        selected: true,
        reasoningEfforts: ['off', 'high'],
        defaultReasoningEffort: 'high'
      },
      {
        id: 'alternate-model',
        displayName: 'Alternate model',
        selected: false,
        reasoningEfforts: ['low', 'medium', 'high', 'max'],
        defaultReasoningEffort: 'medium'
      }
    ]
  }
  const service = new ExtensionAgentService({
    threads,
    turns,
    sessions,
    eventBus,
    profiles,
    runTurn: (threadId, turnId) => { launched.push({ threadId, turnId }) },
    defaultBinding: { providerId: 'default-provider', modelId: 'default-model' },
    resolveRunOptions: () => runOptions,
    headless,
    maximumBudget: { maxTokens: 500_000 },
    resolveToolCatalogEpoch: async () => ({
      id: 'epoch_1',
      fingerprint: 'sha256:catalog',
      toolCount: 1,
      canonicalToolIds: ['extension:com.example.agent/read'],
      schemaDigests: { 'extension:com.example.agent/read': 'sha256:read' },
      createdAt: nowIso()
    })
  })
  return {
    service,
    threads,
    turns,
    sessions,
    events,
    launched,
    setRunOptions: (value: ExtensionAgentRunOptions) => { runOptions = value }
  }
}

export function extensionAgentPrincipal(extensionId = 'com.example.agent'): ExtensionPrincipal {
  return {
    extensionId,
    extensionVersion: '1.2.3',
    permissions: [
      'agent.run',
      'agent.threads.readOwn',
      'accounts.use:example-provider'
    ],
    workspaceRoots: [workspace],
    workspaceTrusted: true
  }
}
