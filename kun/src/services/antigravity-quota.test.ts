import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  antigravityQuotaCredentialCache,
  antigravityStateDbPaths,
  clearAntigravityOAuthClientCache,
  clearAntigravityQuotaCredentialCache,
  decodeGoKeyringSecret,
  parseStoredAntigravityToken,
  resolveAntigravityQuotaCredential
} from './antigravity-quota-credentials.js'
import {
  appendNativeAntigravityQuotaProfile,
  clearAntigravityLocalLoginCache
} from './antigravity-native-quota-profile.js'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'
import { mergeAntigravityQuotaPools } from './antigravity-quota-pools.js'
import { defaultRuntime } from './provider-subscription-quota-credentials.js'
import { type ProviderQuotaFetch, runSubscriptionQuotaProbe } from './provider-subscription-quota-service.js'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig`
}

describe('antigravity quota support', () => {
  afterEach(async () => {
    clearAntigravityQuotaCredentialCache()
    clearAntigravityOAuthClientCache()
    clearAntigravityLocalLoginCache()
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('decodes plain, go-keyring-base64, and hex-wrapped Antigravity keyring secrets', () => {
    const tokenObj = {
      access_token: 'ya29.token-1',
      refresh_token: '1//refresh-1',
      expiry: '2026-11-15T00:00:00.000Z',
      id_token_email: 'user@example.com'
    }
    const plainJson = JSON.stringify(tokenObj)
    const goKeyring = `go-keyring-base64:${Buffer.from(plainJson, 'utf8').toString('base64')}`
    const hexWrapped = Buffer.from(goKeyring, 'utf8').toString('hex')

    expect(decodeGoKeyringSecret(goKeyring)).toBe(plainJson)
    expect(decodeGoKeyringSecret(hexWrapped)).toBe(plainJson)

    expect(parseStoredAntigravityToken(plainJson)).toEqual({
      accessToken: 'ya29.token-1',
      refreshToken: '1//refresh-1',
      expiresAt: Date.parse('2026-11-15T00:00:00.000Z'),
      accountEmail: 'user@example.com'
    })

    const jwtWrapped = `go-keyring-base64:${Buffer.from(JSON.stringify({
      access_token: 'ya29.jwt',
      refresh_token: '1//jwt-refresh',
      expires_at: 1_800_000_000,
      id_token: fakeJwt({ email: 'jwt@example.com' }),
      is_business: true
    }), 'utf8').toString('base64')}`

    expect(parseStoredAntigravityToken(jwtWrapped)).toEqual({
      accessToken: 'ya29.jwt',
      refreshToken: '1//jwt-refresh',
      expiresAt: 1_800_000_000_000,
      accountEmail: 'jwt@example.com',
      isBusiness: true
    })
  })

  it('refreshes expired native tokens, caches the result, and falls back to cross-platform state.vscdb', async () => {
    const home = await makeTempDir('ag-home-')
    const tokenDir = join(home, '.gemini', 'antigravity-cli')
    await mkdir(tokenDir, { recursive: true })
    await writeFile(
      join(tokenDir, 'antigravity-oauth-token'),
      JSON.stringify({
        access_token: 'stale-native',
        refresh_token: '1//native-refresh',
        expiry: new Date(Date.now() - 60_000).toISOString(),
        id_token_email: 'user@gmail.com'
      }),
      'utf8'
    )

    const usedClientIds: string[] = []
    let issuedCount = 0
    const fetcher = vi.fn<ProviderQuotaFetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      expect(url).toBe('https://oauth2.googleapis.com/token')
      const params = new URLSearchParams(String(init?.body ?? ''))
      usedClientIds.push(params.get('client_id') ?? '')
      issuedCount += 1
      return new Response(
        JSON.stringify({ access_token: `fresh-token-${issuedCount}`, expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    })

    const deps = {
      platform: 'linux' as const,
      home,
      env: { HOME: home },
      discoverClients: async () => [
        {
          clientId: 'business-client-id',
          clientSecret: 'business-client-secret'
        },
        {
          clientId: 'personal-client-id',
          clientSecret: 'personal-client-secret'
        }
      ]
    }

    const first = await resolveAntigravityQuotaCredential({ fetcher, proxyUrl: '' }, undefined, deps)
    expect(first).toEqual({ accessToken: 'fresh-token-1', accountEmail: 'user@gmail.com' })
    expect(usedClientIds).toEqual([
      'personal-client-id'
    ])
    expect(antigravityQuotaCredentialCache.get('1//native-refresh')?.accessToken).toBe('fresh-token-1')

    const cached = await resolveAntigravityQuotaCredential({ fetcher, proxyUrl: '' }, undefined, deps)
    expect(cached).toEqual({ accessToken: 'fresh-token-1', accountEmail: 'user@gmail.com' })
    expect(fetcher).toHaveBeenCalledTimes(1)

    const retried = await resolveAntigravityQuotaCredential({ fetcher, proxyUrl: '' }, 'fresh-token-1', deps)
    expect(retried).toEqual({ accessToken: 'fresh-token-2', accountEmail: 'user@gmail.com' })
    expect(fetcher).toHaveBeenCalledTimes(2)

    expect(antigravityStateDbPaths({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\demo\\AppData\\Roaming' },
      home: 'C:\\Users\\demo'
    })).toEqual([
      join('C:\\Users\\demo\\AppData\\Roaming', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'),
      join('C:\\Users\\demo\\AppData\\Roaming', 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb')
    ])

    const emptyHome = await makeTempDir('ag-db-only-')
    const dbCredential = await resolveAntigravityQuotaCredential(
      { fetcher, proxyUrl: '' },
      undefined,
      {
        platform: 'linux',
        home: emptyHome,
        env: { HOME: emptyHome, XDG_CONFIG_HOME: join(emptyHome, '.cfg') },
        readSqliteValue: async (dbPath, key) => {
          if (!dbPath.endsWith(join('Antigravity', 'User', 'globalStorage', 'state.vscdb'))) return undefined
          if (key === 'antigravityAuthStatus') {
            return JSON.stringify({ apiKey: 'db-api-key', email: 'desktop@example.com' })
          }
          return undefined
        }
      }
    )
    expect(dbCredential).toEqual({ accessToken: 'db-api-key', accountEmail: 'desktop@example.com' })
  })

  it('merges per-model Antigravity buckets into shared quota pools sorted tightest-first', () => {
    const merged = mergeAntigravityQuotaPools([
      { id: 'b0', label: 'gemini-2.5-pro', unit: 'percent', usedPercent: 40, resetsAt: '2026-11-14T15:00:00.000Z' },
      { id: 'b1', label: 'gemini-3-pro', unit: 'percent', usedPercent: 60, resetsAt: '2026-11-14T14:00:00.000Z' },
      { id: 'b2', label: 'claude-sonnet-4-5', unit: 'percent', usedPercent: 85, resetsAt: '2026-11-14T13:00:00.000Z' },
      { id: 'b3', label: 'claude-opus-4-6', unit: 'percent', usedPercent: 85, resetsAt: '2026-11-14T12:30:00.000Z' },
      { id: 'b4', label: 'gemini-2.5-flash', unit: 'percent', usedPercent: 20, resetsAt: '2026-11-14T16:00:00.000Z' },
      { id: 'b5', label: 'gemini-2.5-flash-lite', unit: 'percent', usedPercent: 10 },
      { id: 'b6', label: 'gpt-oss-120b', unit: 'percent', usedPercent: 50 },
      { id: 'b7', label: 'gemini-2.5-flash-image', unit: 'percent', usedPercent: 30 }
    ])

    expect(merged).toEqual([
      { id: 'pool-claude', label: 'Claude', unit: 'percent', usedPercent: 85, resetsAt: '2026-11-14T12:30:00.000Z' },
      { id: 'pool-gemini-pro', label: 'Gemini Pro', unit: 'percent', usedPercent: 60, resetsAt: '2026-11-14T14:00:00.000Z' },
      { id: 'pool-gpt-oss', label: 'GPT-OSS', unit: 'percent', usedPercent: 50 },
      { id: 'pool-gemini-image', label: 'Gemini Image', unit: 'percent', usedPercent: 30 },
      { id: 'pool-gemini-flash', label: 'Gemini Flash', unit: 'percent', usedPercent: 20, resetsAt: '2026-11-14T16:00:00.000Z' },
      { id: 'pool-gemini-flash-lite', label: 'Gemini Flash-Lite', unit: 'percent', usedPercent: 10 }
    ])
  })

  it('retries Antigravity probe once after 401 with refreshed token and returns merged pool summary', async () => {
    const resolveAntigravityCredential = vi.fn(async (_ctx, rejectedToken?: string) => {
      if (rejectedToken === 'stale-access') {
        return { accessToken: 'fresh-access', accountEmail: 'user@gmail.com' }
      }
      return { accessToken: 'stale-access', accountEmail: 'user@gmail.com' }
    })

    const fetcher = vi.fn<ProviderQuotaFetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
      if (auth === 'Bearer stale-access') {
        return new Response('unauthorized', { status: 401 })
      }
      if (url.includes(':loadCodeAssist')) {
        return new Response(JSON.stringify({
          cloudaicompanionProject: 'proj-1',
          currentTier: { name: 'Google AI Pro' }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        buckets: [
          { modelId: 'gemini-2.5-pro', remainingFraction: 0.7, resetTime: '2026-11-14T15:00:00.000Z' },
          { modelId: 'claude-opus-4-6', remainingFraction: 0.2, resetTime: '2026-11-14T14:00:00.000Z' },
          { modelId: 'claude-sonnet-4-5', remainingFraction: 0.5, resetTime: '2026-11-14T16:00:00.000Z' }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const result = await runSubscriptionQuotaProbe(
      'antigravity-subscription',
      {
        id: 'native:antigravity',
        name: 'Antigravity',
        presetId: 'gemini-subscription',
        kind: 'antigravity-cli',
        authType: 'subscription',
        configured: true,
        apiKey: '',
        proxyUrl: ''
      },
      { fetcher, proxyUrl: '' },
      { ...defaultRuntime, resolveAntigravityCredential }
    )

    expect(resolveAntigravityCredential).toHaveBeenCalledTimes(2)
    expect(resolveAntigravityCredential).toHaveBeenNthCalledWith(2, expect.anything(), 'stale-access')
    expect(result.summary).toBe('Google AI Pro · user@gmail.com')
    expect(result.metrics).toEqual([
      { id: 'pool-claude', label: 'Claude', unit: 'percent', usedPercent: 80, resetsAt: '2026-11-14T14:00:00.000Z' },
      { id: 'pool-gemini-pro', label: 'Gemini Pro', unit: 'percent', usedPercent: 30, resetsAt: '2026-11-14T15:00:00.000Z' }
    ])
  })

  it('auto-appends native Antigravity quota profile only when enabled or signed in locally and avoids duplicates', async () => {
    const enabledResult = await appendNativeAntigravityQuotaProfile(
      [],
      {
        harnesses: HarnessesConfigSchema.parse({
          enabledProfiles: [{ harnessId: 'antigravity', credentialMode: 'native-login' }]
        }),
        modelProxyUrl: 'http://127.0.0.1:7890'
      },
      { detectLogin: async () => ({ configured: false, fingerprint: '' }) }
    )
    expect(enabledResult).toEqual([
      expect.objectContaining({
        id: 'native:antigravity',
        name: 'Antigravity',
        presetId: 'gemini-subscription',
        kind: 'antigravity-cli',
        authType: 'subscription',
        configured: true,
        proxyUrl: 'http://127.0.0.1:7890'
      })
    ])

    const localLoginResult = await appendNativeAntigravityQuotaProfile(
      [],
      {},
      { detectLogin: async () => ({ configured: true, fingerprint: 'abcdef0123456789ffff' }) }
    )
    expect(localLoginResult).toHaveLength(1)
    expect(localLoginResult[0]?.accountId).toBe('native:abcdef0123456789')

    const existing = [{
      id: 'custom-ag',
      name: 'Google Antigravity 订阅',
      presetId: 'gemini-subscription',
      kind: 'antigravity-cli' as const,
      authType: 'subscription' as const,
      configured: true,
      apiKey: '',
      proxyUrl: ''
    }]
    expect(await appendNativeAntigravityQuotaProfile(
      existing,
      { harnesses: HarnessesConfigSchema.parse({ defaultHarnessId: 'antigravity' }) },
      { detectLogin: async () => ({ configured: true, fingerprint: '1234' }) }
    )).toEqual(existing)

    expect(await appendNativeAntigravityQuotaProfile(
      [],
      { harnesses: HarnessesConfigSchema.parse({ disabledIds: ['antigravity'] }) },
      { detectLogin: async () => ({ configured: true, fingerprint: '1234' }) }
    )).toEqual([])

    expect(await appendNativeAntigravityQuotaProfile(
      [],
      {},
      { detectLogin: async () => ({ configured: false, fingerprint: '' }) }
    )).toEqual([])
  })
})
