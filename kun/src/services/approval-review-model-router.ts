import type { ServeProviderConfig } from '../config/kun-config.js'
import type { ModelClientRouterInput } from '../adapters/model/multi-provider-model-client.js'
import type {
  ModelClient,
  ModelRequest,
  ModelStreamChunk
} from '../ports/model-client.js'
import {
  AgentSdkApprovalReviewModelClient,
  type AgentSdkApprovalReviewModelClientOptions
} from '../runtime/agent-sdk/agent-sdk-approval-review-model-client.js'

export type ApprovalReviewModelRouterInput = {
  direct: {
    default: ModelClient
    providers: Map<string, ModelClient>
  } & Pick<ModelClientRouterInput, 'admission' | 'defaultProviderId'>
  providers?: Record<string, ServeProviderConfig>
  defaultProviderKind?: ServeProviderConfig['kind']
  defaultApiKey?: string
  defaultModel?: string
  reviewCwd: string
  pathToClaudeCodeExecutable?: string
  loadAgentSdk?: AgentSdkApprovalReviewModelClientOptions['loadSdk']
}

/**
 * Builds a router dedicated to approval review. HTTP-compatible routes reuse
 * their exact direct client. Provider-native routes are replaced explicitly:
 * Claude Agent SDK has an isolated no-tools adapter; transports whose public
 * API cannot disable tools are represented by a throwing client so they fail
 * closed instead of falling through to the default HTTP credential.
 */
export function buildApprovalReviewModelRouterInput(
  input: ApprovalReviewModelRouterInput
): { default: ModelClient; providers: Map<string, ModelClient> } & Pick<ModelClientRouterInput, 'admission' | 'defaultProviderId'> {
  const providers = new Map(input.direct.providers)
  for (const [rawProviderId, config] of Object.entries(input.providers ?? {})) {
    const providerId = rawProviderId.trim()
    if (!providerId) continue
    const kind = config.kind ?? 'http'
    if (kind === 'agent-sdk') {
      providers.set(providerId, agentSdkReviewClient(input, providerId, config))
    } else if (kind === 'cursor-sdk' || kind === 'antigravity-cli') {
      providers.set(providerId, new UnsupportedNativeApprovalReviewModelClient(kind, providerId))
    }
  }

  const defaultKind = input.defaultProviderKind ?? 'http'
  let defaultClient = input.direct.default
  if (defaultKind === 'agent-sdk') {
    // `default` is a reserved MultiProvider route. Keep an explicitly named
    // `agent-sdk` provider in the map so it cannot collide with the implicit
    // desktop default or inherit that default's credential.
    defaultClient = agentSdkReviewClient(input, 'default')
  } else if (defaultKind === 'cursor-sdk') {
    defaultClient = new UnsupportedNativeApprovalReviewModelClient(
      'cursor-sdk',
      'cursor-subscription'
    )
    providers.set('cursor-subscription', defaultClient)
  } else if (defaultKind === 'antigravity-cli') {
    defaultClient = new UnsupportedNativeApprovalReviewModelClient(
      'antigravity-cli',
      'antigravity-cli'
    )
    providers.set('antigravity-cli', defaultClient)
  }

  return { default: defaultClient, providers, admission: input.direct.admission, defaultProviderId: input.direct.defaultProviderId }
}

function agentSdkReviewClient(
  input: ApprovalReviewModelRouterInput,
  providerId: string,
  config?: ServeProviderConfig
): ModelClient {
  // An explicitly selected Agent SDK provider owns its credential boundary.
  // Its empty token means ambient Claude login, never "borrow the default".
  const oauthToken = (
    config === undefined ? input.defaultApiKey : config.apiKey
  )?.trim()
  return new AgentSdkApprovalReviewModelClient({
    providerId,
    ...(oauthToken ? { oauthToken } : {}),
    defaultModel: config?.selectedModel || input.defaultModel,
    cwd: input.reviewCwd,
    ...(input.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: input.pathToClaudeCodeExecutable }
      : {}),
    ...(input.loadAgentSdk ? { loadSdk: input.loadAgentSdk } : {})
  })
}

export class UnsupportedNativeApprovalReviewModelClient implements ModelClient {
  readonly provider: string
  readonly model = 'unsupported-exact-route'

  constructor(
    private readonly kind: 'cursor-sdk' | 'antigravity-cli',
    providerId: string
  ) {
    this.provider = `${kind}-approval-review-unavailable:${providerId}`
  }

  async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    yield* [] as ModelStreamChunk[]
    throw new Error(
      `Automatic approval review is unavailable for the exact ${this.kind} route because ` +
      'that provider does not expose an isolated no-tools request API; refusing provider substitution.'
    )
  }
}
