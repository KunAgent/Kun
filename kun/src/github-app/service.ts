import type { SecretEncryptor } from '../security/secret-store.js'
import { GitHubScopeSchema, GITHUB_ACCOUNT_CONTEXT, GITHUB_SHARING_POLICY, githubScopeContext,
  sameGitHubAuthorizationContext, type GitHubAuthorizationContext, type GitHubConnectionStatus,
  type GitHubAuthorization } from '../contracts/github-app.js'
import { GitHubAuthorizationFlow } from './authorization.js'
import { GitHubAppClient, GitHubAppError } from './client.js'
import type { GitHubAppConfig } from './config.js'
import { GitHubAppStore, type GitHubTokens } from './store.js'

export type GitHubAppServicePort = Pick<GitHubAppService,
  'status' | 'authorize' | 'authorizeAccount' | 'poll' | 'pollAccount' | 'cancel' | 'cancelAccount'
  | 'sharing' | 'disconnect' | 'manageRepositories' | 'withAccess' | 'dispose'>
export type GitHubAppOptions = {
  dataDir: string; encryptor: SecretEncryptor; config?: GitHubAppConfig; fetchImpl: typeof fetch
  openExternal: (url: URL) => Promise<void>; now?: () => number; callbackPort?: number
}

export class GitHubAppService {
  private readonly store: GitHubAppStore
  private readonly client?: GitHubAppClient
  private readonly now: () => number
  private generation = 0
  private disposed = false
  private readonly revisions = new Map<string, number>()
  private readonly flows = new Map<string, GitHubAuthorizationFlow>()
  private refresh?: Promise<GitHubTokens>
  private inventory?: { token: string; at: number; names: string[]; count: number }
  private readonly operations = new Set<Promise<unknown>>()

  constructor(private readonly options: GitHubAppOptions) {
    this.store = new GitHubAppStore(options.dataDir, options.encryptor)
    this.now = options.now ?? Date.now
    if (options.config) this.client = new GitHubAppClient(options.config, options.fetchImpl, this.now)
  }
  async initialize(): Promise<void> { await this.store.read() }
  async status(scopeId?: string, refresh = false): Promise<GitHubConnectionStatus> {
    if (scopeId) GitHubScopeSchema.parse(scopeId)
    if (refresh && this.client && (await this.store.read()).tokens) {
      try { await this.repositories() }
      catch (error) { if (!(error instanceof GitHubAppError && error.code === 'reconnect_required')) throw error }
    }
    const state = await this.store.read()
    const connected = Boolean(this.client && state.tokens?.clientId === this.options.config?.clientId && !state.reconnectRequired)
    const inventory = this.inventory?.token === state.tokens?.accessToken ? this.inventory : undefined
    const pendingScope = scopeId ? this.pending(githubScopeContext(scopeId)) : undefined
    const pendingAccount = this.pending(GITHUB_ACCOUNT_CONTEXT)
    return { configured: Boolean(this.client), connected, reconnectRequired: state.reconnectRequired,
      login: connected ? state.tokens?.login : undefined,
      allowModelSharing: connected && state.grants.some((grant) => grant.scopeId === scopeId),
      repositories: inventory?.names ?? [], repositoryCount: inventory?.count ?? 0,
      ...(pendingScope ? { pendingAuthorization: pendingScope } : {}),
      ...(pendingAccount ? { pendingAccountAuthorization: pendingAccount } : {}) }
  }
  authorize(scopeId: string): Promise<GitHubAuthorization> {
    return this.track(async () => this.startAuthorization(githubScopeContext(scopeId)))
  }
  /** Account login: explicit account context, so no conversation scope is invented for it. */
  authorizeAccount(): Promise<GitHubAuthorization> {
    return this.track(() => this.startAuthorization(GITHUB_ACCOUNT_CONTEXT))
  }
  private async startAuthorization(context: GitHubAuthorizationContext): Promise<GitHubAuthorization> {
    this.assertConfigured()
    const generation = ++this.generation
    await Promise.all([...this.flows.values()].map((flow) => flow.dispose()))
    this.assertGeneration(generation)
    while (this.flows.size >= 16) this.flows.delete(this.flows.keys().next().value!)
    const scopeId = context.kind === 'scope' ? context.scopeId : undefined
    const fence = scopeId === undefined ? () => this.assertGeneration(generation) : this.fence(scopeId)
    const flow = new GitHubAuthorizationFlow(context, this.options.config!.clientId,
      async (code, verifier, redirect, pending) => {
        const current = () => { fence(); pending() }
        const tokens = await this.client!.exchange(code, verifier, redirect, current)
        current()
        await this.store.update((state) => {
          current()
          const retained = sameAccount(state.tokens, tokens) ? state.grants : []
          return { ...state, tokens, reconnectRequired: false,
            grants: scopeId === undefined ? retained
              : [...retained.filter((grant) => grant.scopeId !== scopeId), { scopeId, policy: GITHUB_SHARING_POLICY }] }
        })
        this.inventory = undefined
      }, this.now, this.options.callbackPort)
    this.flows.set(flow.id, flow)
    let url: string
    try { url = await flow.start(); fence() }
    catch { await flow.cancel(); throw new GitHubAppError('callback_unavailable', 'Close another pending GitHub connection and retry') }
    void this.options.openExternal(new URL(url)).catch(() => flow.failBrowser())
    return flow.status()
  }
  async poll(id: string, scopeId: string): Promise<GitHubAuthorization> {
    return this.flow(id, githubScopeContext(scopeId)).status()
  }
  async cancel(id: string, scopeId: string): Promise<void> {
    await this.flow(id, githubScopeContext(scopeId)).cancel()
  }
  async pollAccount(id: string): Promise<GitHubAuthorization> {
    return this.flow(id, GITHUB_ACCOUNT_CONTEXT).status()
  }
  async cancelAccount(id: string): Promise<void> { await this.flow(id, GITHUB_ACCOUNT_CONTEXT).cancel() }
  sharing(scopeId: string, allow: boolean): Promise<GitHubConnectionStatus> {
    return this.track(async () => {
      GitHubScopeSchema.parse(scopeId)
      this.revisions.set(scopeId, (this.revisions.get(scopeId) ?? 0) + 1)
      const fence = this.fence(scopeId)
      for (const flow of this.flows.values()) {
        if (flow.context.kind === 'scope' && flow.context.scopeId === scopeId) await flow.cancel()
      }
      await this.store.update((state) => {
        fence()
        if (allow && (!this.client || !state.tokens || state.reconnectRequired)) throw new GitHubAppError('connection_required', 'Connect GitHub first')
        return { ...state, grants: [...state.grants.filter((grant) => grant.scopeId !== scopeId),
          ...(allow ? [{ scopeId, policy: GITHUB_SHARING_POLICY }] : [])] }
      })
      return this.status(scopeId, allow)
    })
  }
  disconnect(): Promise<void> {
    this.generation += 1
    this.inventory = undefined
    return this.track(async () => {
      await Promise.all([...this.flows.values()].map((flow) => flow.cancel()))
      await this.store.update(() => ({ schemaVersion: 1, grants: [], reconnectRequired: false }))
    })
  }
  async manageRepositories(): Promise<void> {
    this.assertConfigured()
    await this.options.openExternal(new URL(`https://github.com/apps/${this.options.config!.slug}/installations/new`))
    this.inventory = undefined
  }
  /** Tokens are supplied only to a trusted in-process adapter, never to an HTTP or model response. */
  withAccess<T>(scopeId: string, action: (token: string, fence: () => void) => Promise<T>): Promise<T> {
    return this.track(async () => {
      GitHubScopeSchema.parse(scopeId)
      const fence = this.fence(scopeId)
      await this.requireGrant(scopeId)
      const tokens = await this.tokens()
      fence()
      const result = await action(tokens.accessToken, fence)
      fence()
      await this.requireGrant(scopeId)
      return result
    })
  }
  async dispose(): Promise<void> {
    this.disposed = true; this.generation += 1
    await Promise.all([...this.flows.values()].map((flow) => flow.dispose()))
    await Promise.allSettled([...this.operations])
    await this.refresh?.catch(() => undefined)
    await this.store.update((state) => state)
  }
  private async requireGrant(scopeId: string): Promise<void> {
    const state = await this.store.read()
    if (!state.grants.some((grant) => grant.scopeId === scopeId)) throw new GitHubAppError('sharing_required', 'Allow GitHub in this conversation through its connection card')
  }
  private async repositories(): Promise<void> {
    const generation = this.generation
    const fence = () => this.assertGeneration(generation)
    const tokens = await this.tokens()
    fence()
    if (this.inventory?.token === tokens.accessToken && this.inventory.at + 5000 > this.now()) return
    try {
      const result = await this.client!.repositories(tokens.accessToken, fence)
      fence()
      this.inventory = { token: tokens.accessToken, at: this.now(), ...result }
    } catch (error) {
      if (error instanceof GitHubAppError && error.code === 'reconnect_required') await this.markRejected(tokens, generation)
      throw error
    }
  }
  private async tokens(): Promise<GitHubTokens> {
    this.assertConfigured()
    const generation = this.generation
    const state = await this.store.read()
    this.assertGeneration(generation)
    const previous = state.tokens
    if (!previous || state.reconnectRequired || previous.clientId !== this.options.config!.clientId) {
      throw new GitHubAppError('reconnect_required', 'Connect GitHub through Kun to continue')
    }
    if (previous.expiresAt > this.now() + 60000) return previous
    if (this.refresh) return this.refresh
    this.refresh = (async () => {
      try {
        const tokens = await this.client!.refresh(previous, () => this.assertGeneration(generation))
        await this.store.update((current) => {
          this.assertGeneration(generation)
          if (current.tokens?.refreshToken !== previous.refreshToken) throw new GitHubAppError('connection_changed', 'GitHub connection changed')
          return { ...current, tokens }
        })
        return tokens
      } catch (error) {
        if (error instanceof GitHubAppError && error.code === 'reconnect_required') await this.markRejected(previous, generation)
        throw error
      } finally { this.refresh = undefined }
    })()
    return this.refresh
  }
  private async markRejected(tokens: GitHubTokens, generation: number): Promise<void> {
    await this.store.update((state) => this.generation === generation && state.tokens?.accessToken === tokens.accessToken
      ? { ...state, tokens: undefined, grants: [], reconnectRequired: true } : state)
    if (this.generation === generation) { this.generation += 1; this.inventory = undefined }
  }
  private pending(context: GitHubAuthorizationContext): GitHubAuthorization | undefined {
    return [...this.flows.values()].reverse()
      .find((flow) => sameGitHubAuthorizationContext(flow.context, context))?.status()
  }
  private flow(id: string, context: GitHubAuthorizationContext): GitHubAuthorizationFlow {
    const flow = this.flows.get(id)
    if (!flow || !sameGitHubAuthorizationContext(flow.context, context)) {
      throw new GitHubAppError('invalid_context', context.kind === 'account'
        ? 'This GitHub authorization belongs to a conversation'
        : 'This GitHub authorization belongs to another conversation')
    }
    return flow
  }
  private fence(scopeId: string): () => void {
    const generation = this.generation, revision = this.revisions.get(scopeId) ?? 0
    return () => {
      this.assertGeneration(generation)
      if ((this.revisions.get(scopeId) ?? 0) !== revision) throw new GitHubAppError('consent_changed', 'GitHub conversation permission changed')
    }
  }
  private assertGeneration(generation: number): void {
    if (this.disposed || generation !== this.generation) throw new GitHubAppError('connection_changed', 'GitHub connection changed; retry from its card')
  }
  private assertConfigured(): void {
    this.assertGeneration(this.generation)
    if (!this.client) throw new GitHubAppError('not_configured', 'GitHub connection is not configured in this Kun build')
  }
  private track<T>(action: () => Promise<T>): Promise<T> {
    const operation = action(); this.operations.add(operation)
    void operation.finally(() => this.operations.delete(operation)).catch(() => undefined)
    return operation
  }
}

/** Conversation grants belong to one GitHub account; a different account must not inherit them. */
function sameAccount(previous: GitHubTokens | undefined, next: GitHubTokens): boolean {
  return previous?.userId === next.userId && previous.clientId === next.clientId
}
