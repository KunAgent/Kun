import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { antigravityCredentialEvidence } from '../harness/antigravity-credentials.js'
import type { KunServeRuntimeOptions } from '../server/runtime-factory-types.js'
import { antigravityStateDbPaths } from './antigravity-quota-credentials.js'
import { appendNativeDevinQuotaProfile } from './devin-subscription-quota.js'
import { readSqliteValue } from './provider-subscription-quota-opencode-cookie.js'
import type { ProviderQuotaProbeProfile } from './provider-subscription-quota-service.js'

const LOCAL_LOGIN_CACHE_TTL_MS = 15_000

export type AntigravityLocalLoginEvidence = {
  configured: boolean
  fingerprint: string
}

export type NativeAntigravityProfileDeps = {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  home?: string
  detectLogin?: () => Promise<AntigravityLocalLoginEvidence>
  readSqliteValue?: (dbPath: string, key: string) => Promise<string | undefined>
}

let cachedLoginEvidence: {
  homeKey: string
  checkedAt: number
  value: AntigravityLocalLoginEvidence
} | undefined

export function clearAntigravityLocalLoginCache(): void {
  cachedLoginEvidence = undefined
}

export async function detectAntigravityLocalLogin(
  deps?: NativeAntigravityProfileDeps
): Promise<AntigravityLocalLoginEvidence> {
  if (deps?.detectLogin) return deps.detectLogin()
  const hasExplicitEnv = Boolean(deps?.env || deps?.platform || deps?.home || deps?.readSqliteValue)
  if (process.env.VITEST && !hasExplicitEnv) {
    return { configured: false, fingerprint: '' }
  }
  const env = deps?.env ?? process.env
  const home = deps?.home || env.HOME || env.USERPROFILE || homedir()
  const homeKey = resolve(home)
  if (!hasExplicitEnv && cachedLoginEvidence?.homeKey === homeKey &&
    Date.now() - cachedLoginEvidence.checkedAt < LOCAL_LOGIN_CACHE_TTL_MS) {
    return cachedLoginEvidence.value
  }
  const value = await probeAntigravityLocalLogin(env, home, deps)
  if (!hasExplicitEnv) {
    cachedLoginEvidence = { homeKey, checkedAt: Date.now(), value }
  }
  return value
}

async function probeAntigravityLocalLogin(
  env: NodeJS.ProcessEnv,
  home: string,
  deps?: NativeAntigravityProfileDeps
): Promise<AntigravityLocalLoginEvidence> {
  const nativeEvidence = await antigravityCredentialEvidence(env, {
    platform: deps?.platform,
    home: deps?.home
  })
  if (nativeEvidence.configured) return nativeEvidence

  const readValue = deps?.readSqliteValue ?? readSqliteValue
  for (const dbPath of antigravityStateDbPaths({ platform: deps?.platform, env, home })) {
    const info = await stat(dbPath).catch(() => undefined)
    if (!info?.isFile() || info.size <= 0) continue
    const [oauthToken, authStatus] = await Promise.all([
      readValue(dbPath, 'antigravityUnifiedStateSync.oauthToken'),
      readValue(dbPath, 'antigravityAuthStatus')
    ])
    if (!oauthToken && !authStatus) continue
    return {
      configured: true,
      fingerprint: createHash('sha256')
        .update(JSON.stringify({ dbPath, oauthToken: oauthToken ?? '', authStatus: authStatus ?? '' }))
        .digest('hex')
    }
  }
  return { configured: false, fingerprint: '' }
}

/**
 * Surfaces an automatic Antigravity subscription quota card whenever the user
 * enabled Antigravity Agent or already signed in locally via agy / Antigravity,
 * without duplicating an explicit provider entry.
 */
export async function appendNativeAntigravityQuotaProfile(
  profiles: ProviderQuotaProbeProfile[],
  options: Pick<KunServeRuntimeOptions, 'harnesses' | 'modelProxyUrl'>,
  deps?: NativeAntigravityProfileDeps
): Promise<ProviderQuotaProbeProfile[]> {
  if (profiles.some((profile) =>
    profile.kind === 'antigravity-cli' ||
    profile.presetId === 'gemini-subscription' ||
    profile.id === 'native:antigravity'
  )) {
    return profiles
  }
  if (options.harnesses?.disabledIds?.includes('antigravity')) {
    return profiles
  }
  const enabled = Boolean(
    options.harnesses?.enabledProfiles?.some((profile) => profile.harnessId === 'antigravity') ||
    options.harnesses?.defaultHarnessId === 'antigravity'
  )
  const evidence = await detectAntigravityLocalLogin(deps)
  if (!enabled && !evidence.configured) {
    return profiles
  }
  return [
    ...profiles,
    {
      id: 'native:antigravity',
      name: 'Antigravity',
      ...(evidence.configured && evidence.fingerprint
        ? { accountId: `native:${evidence.fingerprint.slice(0, 16)}` }
        : {}),
      presetId: 'gemini-subscription',
      kind: 'antigravity-cli',
      authType: 'subscription',
      configured: true,
      apiKey: '',
      proxyUrl: options.modelProxyUrl ?? ''
    }
  ]
}

export async function appendNativeAgentQuotaProfiles(
  profiles: ProviderQuotaProbeProfile[],
  options: Pick<KunServeRuntimeOptions, 'harnesses' | 'modelProxyUrl'>
): Promise<ProviderQuotaProbeProfile[]> {
  const withAntigravity = await appendNativeAntigravityQuotaProfile(profiles, options)
  return appendNativeDevinQuotaProfile(withAntigravity, options)
}
