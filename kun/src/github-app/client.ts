import { z } from 'zod'
import type { GitHubAppConfig } from './config.js'
import type { GitHubTokens } from './store.js'
import { GITHUB_WIRE_FENCE, type GitHubFetchInit } from './network.js'

export class GitHubAppError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
const TokenResponse = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1),
  expires_in: z.number().positive().max(86400), refresh_token_expires_in: z.number().positive(),
  token_type: z.string().refine((value) => value.toLowerCase() === 'bearer') })
const Identity = z.object({ id: z.number().int().positive(), login: z.string().min(1).max(100) })
const Installation = z.object({ id: z.number().int().positive(), app_slug: z.string(), suspended_at: z.string().nullable().optional() })

export class GitHubAppClient {
  constructor(private readonly config: GitHubAppConfig, private readonly request: typeof fetch, private readonly now = Date.now) {}
  async exchange(code: string, verifier: string, redirect: string, fence: () => void): Promise<GitHubTokens> {
    const tokens = await this.token({ code, code_verifier: verifier, redirect_uri: redirect }, fence)
    const identity = Identity.parse(await this.get('/user', tokens.accessToken, fence))
    return { ...tokens, userId: identity.id, login: identity.login, clientId: this.config.clientId }
  }
  async refresh(previous: GitHubTokens, fence: () => void): Promise<GitHubTokens> {
    if (previous.refreshExpiresAt <= this.now()) throw new GitHubAppError('reconnect_required', 'Reconnect GitHub to continue')
    const tokens = await this.token({ grant_type: 'refresh_token', refresh_token: previous.refreshToken }, fence)
    const identity = Identity.parse(await this.get('/user', tokens.accessToken, fence))
    if (identity.id !== previous.userId) throw new GitHubAppError('reconnect_required', 'The GitHub identity changed')
    return { ...tokens, userId: identity.id, login: identity.login, clientId: this.config.clientId }
  }
  async repositories(token: string, fence: () => void): Promise<{ names: string[]; count: number }> {
    const names: string[] = []
    let count = 0
    // Bounded inventory; GitHub itself enforces the full installation/user intersection for tool requests.
    for (let page = 1; page <= 5; page++) {
      const result = z.object({ installations: z.array(Installation) }).parse(
        await this.get(`/user/installations?per_page=100&page=${page}`, token, fence))
      for (const installation of result.installations) {
        if (installation.app_slug !== this.config.slug || installation.suspended_at) continue
        const repos = z.object({ total_count: z.number().int().nonnegative(),
          repositories: z.array(z.object({ full_name: z.string().max(256) })) }).parse(
          await this.get(`/user/installations/${installation.id}/repositories?per_page=100`, token, fence))
        count += repos.total_count
        names.push(...repos.repositories.map((repository) => repository.full_name).slice(0, Math.max(0, 100 - names.length)))
      }
      if (result.installations.length < 100) break
    }
    return { names: [...new Set(names)], count }
  }
  private async token(fields: Record<string, string>, fence: () => void) {
    const response = await this.json('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...fields })
    }, fence)
    if (response && typeof response === 'object' && 'error' in response) {
      throw new GitHubAppError('reconnect_required', 'GitHub authorization expired or was rejected; reconnect to continue')
    }
    const parsed = TokenResponse.safeParse(response)
    if (!parsed.success) throw new GitHubAppError('token_response_invalid', 'GitHub did not issue expiring user credentials')
    return { accessToken: parsed.data.access_token, refreshToken: parsed.data.refresh_token,
      expiresAt: this.now() + parsed.data.expires_in * 1000,
      refreshExpiresAt: this.now() + parsed.data.refresh_token_expires_in * 1000 }
  }
  private get(path: string, token: string, fence: () => void) {
    return this.json(`https://api.github.com${path}`, { headers: {
      accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'user-agent': 'Kun-Desktop',
      'x-github-api-version': '2022-11-28'
    } }, fence)
  }
  private async json(url: string, init: RequestInit, fence: () => void): Promise<unknown> {
    fence()
    let response: Response
    try { response = await this.request(url, { ...init, signal: AbortSignal.timeout(15000), redirect: 'error',
      [GITHUB_WIRE_FENCE]: fence } as GitHubFetchInit) }
    catch { throw new GitHubAppError('network_error', 'GitHub could not be reached; check your connection and retry') }
    fence()
    if (response.status === 401) throw new GitHubAppError('reconnect_required', 'GitHub access was revoked or expired')
    if (!response.ok) throw new GitHubAppError('github_unavailable', `GitHub returned HTTP ${response.status}`)
    const reader = response.body?.getReader()
    if (!reader) throw new GitHubAppError('invalid_response', 'GitHub returned an empty response')
    let length = 0
    const chunks: Uint8Array[] = []
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        length += value.length
        if (length > 2 * 1024 * 1024) throw new GitHubAppError('response_too_large', 'GitHub response exceeded the limit')
        chunks.push(value)
      }
      fence()
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } finally { await reader.cancel().catch(() => undefined) }
  }
}
