import type { RuntimeEvent } from '../contracts/events.js'
import type { ModelReasoningEffort } from '../contracts/capabilities.js'
import type { ExtensionProviderBinding } from '../contracts/extension-providers.js'
import type {
  ExtensionAgentProfileSnapshot,
  ExtensionRunBudget,
  ExtensionThreadVisibility,
  ExtensionToolCatalogEpoch,
  ThreadSummary
} from '../contracts/threads.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type { EventBus } from '../ports/event-bus.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ExtensionAgentProfileRegistry } from './extension-agent-profile-registry.js'
import type { ThreadService } from './thread-service.js'
import type { TurnService } from './turn-service.js'

export const EXTENSION_AGENT_PERMISSIONS = {
  run: 'agent.run',
  readOwnThreads: 'agent.threads.readOwn'
} as const

export type ExtensionPrincipal = Readonly<{
  extensionId: string
  extensionVersion: string
  permissions: readonly string[]
  workspaceRoots: readonly string[]
  workspaceTrusted: boolean
  /** Present only for a Node Extension Host and never accepted from a View. */
  hostLifecycleNonce?: string
  /** Present only for a sender-bound Webview principal. */
  viewSessionId?: string
  /** Present only for a sender-bound Webview principal. */
  viewContributionId?: string
}>

export type ExtensionAgentRuntimeConfig = Readonly<{
  defaultBinding: ExtensionProviderBinding
}>

export type ExtensionAgentModelOption = Readonly<{
  id: string
  displayName: string
  selected: boolean
  reasoningEfforts: readonly ModelReasoningEffort[]
  defaultReasoningEffort?: ModelReasoningEffort
}>

export type ExtensionAgentRunOptions = Readonly<{
  defaultModel: string
  models: readonly ExtensionAgentModelOption[]
}>

export type ExtensionAuthorizationRequest = Readonly<{
  operation: 'getRunOptions' | 'createRun' | 'getRun' | 'listOwn' | 'listRunEvents' | 'subscribe' | 'steer' | 'cancel'
  permission: string
  workspace?: string
  providerId?: string
  accountId?: string
  toolScopes?: readonly string[]
}>

export interface ExtensionAgentAuthorizer {
  authorize(principal: ExtensionPrincipal, request: ExtensionAuthorizationRequest): Promise<void> | void
}

export type ExtensionAgentCreateRunRequest = {
  input: string
  threadId?: string
  workspace?: string
  model?: string
  reasoningEffort?: ModelReasoningEffort
  profileId?: string
  providerBinding?: ExtensionProviderBinding
  budget?: Partial<ExtensionRunBudget>
  allowedTools?: string[]
  visibility?: ExtensionThreadVisibility
}

export type ExtensionAgentRunStatus =
  | 'running'
  | 'waiting-approval'
  | 'waiting-user-input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget-exhausted'

export type ExtensionAgentRun = {
  id: string
  threadId: string
  ownerExtensionId: string
  ownerExtensionVersion: string
  status: ExtensionAgentRunStatus
  createdAt: string
  finishedAt?: string
  workspace: string
  profile?: ExtensionAgentProfileSnapshot
  providerBinding: ExtensionProviderBinding
  reasoningEffort?: ModelReasoningEffort
  effectiveBudget: ExtensionRunBudget
  visibility: ExtensionThreadVisibility
  toolCatalogEpoch?: ExtensionToolCatalogEpoch
  usage?: UsageSnapshot
  error?: string
}

export type ExtensionOwnedThread = {
  id: string
  title: string
  status: ThreadSummary['status']
  workspace: string
  model: string
  providerBinding: ExtensionProviderBinding
  ownerExtensionVersion: string
  profileId?: string
  visibility: ExtensionThreadVisibility
  createdAt: string
  updatedAt: string
  runCount: number
  latestRun?: ExtensionAgentRun
}

export type ExtensionAgentEvent = {
  seq: number
  timestamp: string
  type: RuntimeEvent['kind'] | 'subscription_overflow'
  runId: string
  threadId: string
  ownerExtensionId: string
  payload: Record<string, unknown>
}

export type ExtensionAgentSubscription = {
  readonly lastDeliveredSeq: number
  readonly closed: boolean
  close(): void
}

export type ExtensionAgentEventPage = {
  items: ExtensionAgentEvent[]
  cursor: number
  hasMore: boolean
  historyIncomplete: boolean
}

export type ExtensionAgentServiceOptions = {
  threads: ThreadService
  turns: TurnService
  sessions: SessionStore
  eventBus: EventBus
  profiles: ExtensionAgentProfileRegistry
  authorizer?: ExtensionAgentAuthorizer
  runTurn: (threadId: string, turnId: string) => Promise<unknown> | void
  defaultBinding: ExtensionProviderBinding
  resolveRunOptions?: () => ExtensionAgentRunOptions
  defaultBudget?: Partial<ExtensionRunBudget>
  maximumBudget?: Partial<ExtensionRunBudget>
  headless?: boolean
  resolveToolCatalogEpoch?: (input: {
    principal: ExtensionPrincipal
    workspace: string
    allowedTools: readonly string[]
  }) => Promise<ExtensionToolCatalogEpoch | undefined>
}

export const DEFAULT_BUDGET: ExtensionRunBudget = {
  maxTokens: 100_000,
  maxElapsedMs: 15 * 60_000,
  maxConcurrentRuns: 2,
  maxModelRequests: 64,
  maxToolInvocations: 128,
  maxRetainedEvents: 5_000
}

export const MAXIMUM_BUDGET: ExtensionRunBudget = {
  maxTokens: 1_000_000,
  maxElapsedMs: 60 * 60_000,
  maxConcurrentRuns: 8,
  maxModelRequests: 512,
  maxToolInvocations: 1_024,
  maxRetainedEvents: 20_000
}

export const MAX_LIST_LIMIT = 100
export const MAX_SUBSCRIPTION_QUEUE = 256
export const MAX_SUBSCRIPTION_QUEUE_BYTES = 512 * 1024
export const MAX_EVENT_BYTES = 512 * 1024
export const MAX_REPLAY_BYTES = 512 * 1024
export const MAX_REPLAY_RECORD_BYTES = 4 * 1024 * 1024
export const MAX_LIVE_EVENTS_DURING_REPLAY = 1_024
export const MAX_LIVE_BYTES_DURING_REPLAY = 512 * 1024

export type BufferedAgentEvent = {
  /**
   * The persisted sequence is retained even when the event is internal. A
   * marker without a projected event advances the subscriber cursor without
   * disclosing a model-only TurnItem.
   */
  seq: number
  timestamp: string
  event?: ExtensionAgentEvent
  bytes: number
}
