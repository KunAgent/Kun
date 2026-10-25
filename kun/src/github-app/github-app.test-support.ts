import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createAesEncryptor } from '../security/secret-store.js'
import { GITHUB_CALLBACK } from '../contracts/github-app.js'
import { GitHubAppService } from './service.js'
import { GitHubAppStore } from './store.js'
import type { GitHubAppConfig } from './config.js'

export const SCOPE = 'thread:github-task'
export const CONFIG: GitHubAppConfig = { schemaVersion: 1, clientId: 'Iv23li8xc41xacMCT6td',
  clientSecret: 'synthetic-publisher-secret-only', slug: 'kun-desktop', callbackUrl: GITHUB_CALLBACK }
export const json = (value: unknown, status = 200) => Response.json(value, { status })
export const tokenResponse = { access_token: 'synthetic-user-access', refresh_token: 'synthetic-user-refresh',
  expires_in: 28800, refresh_token_expires_in: 15897600, token_type: 'bearer' }

export async function fixture(custom?: typeof fetch) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-github-app-'))
  const encryptor = createAesEncryptor(randomBytes(32))
  const calls: Parameters<typeof fetch>[] = [], opened: URL[] = []
  const request: typeof fetch = async (...args) => {
    calls.push(args)
    if (custom) return custom(...args)
    const url = String(args[0])
    if (url.includes('/login/oauth/access_token')) return json(tokenResponse)
    if (url.endsWith('/user')) return json({ id: 42, login: 'fixture-user' })
    if (url.includes('/repositories?')) return json({ total_count: 1, repositories: [{ id: 1, full_name: 'fixture/repository' }] })
    if (url.includes('/user/installations?')) return json({ installations: [{ id: 7, app_slug: CONFIG.slug, suspended_at: null }] })
    throw new Error('Unexpected test request')
  }
  const store = new GitHubAppStore(dataDir, encryptor)
  const service = new GitHubAppService({ dataDir, encryptor, config: CONFIG, fetchImpl: request, callbackPort: 0,
    openExternal: async (url) => { opened.push(url) } })
  const seed = async (expired = false) => store.update((state) => ({ ...state, tokens: {
    accessToken: 'synthetic-user-access', refreshToken: 'synthetic-user-refresh',
    expiresAt: expired ? 0 : Date.now() + 3600000, refreshExpiresAt: Date.now() + 86400000,
    userId: 42, login: 'fixture-user', clientId: CONFIG.clientId
  }, grants: [{ scopeId: SCOPE, policy: 'configured-models-v1' }] }))
  return { dataDir, encryptor, store, service, calls, opened, seed,
    cleanup: async () => { await service.dispose(); await rm(dataDir, { recursive: true, force: true }) } }
}

export function callback(url: URL, state = url.searchParams.get('state')!) {
  const destination = new URL(url.searchParams.get('redirect_uri')!)
  destination.searchParams.set('code', 'synthetic-code')
  destination.searchParams.set('state', state)
  return destination
}
