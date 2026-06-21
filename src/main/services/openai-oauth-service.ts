import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { URLSearchParams } from 'node:url'
import { shell } from 'electron'
import {
  modelProviderPresetProfile,
  normalizeModelProviderId,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ModelProviderOAuthV1,
  type ModelProviderProfileV1
} from '../../shared/app-settings'
import { getModelProviderPreset } from '../../shared/model-provider-presets'
import type { OpenAiOAuthResult, OpenAiOAuthStatus } from '../../shared/kun-gui-api'

const OPENAI_PROVIDER_ID = 'openai'
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const OPENAI_OAUTH_SCOPE = 'openid profile email offline_access api.connectors.read api.connectors.invoke'
const OPENAI_CALLBACK_PATH = '/auth/callback'
const OPENAI_CALLBACK_PORT = 1455
const OAUTH_TIMEOUT_MS = 10 * 60 * 1000

type ApplySettingsPatch = (partial: AppSettingsPatch) => Promise<AppSettingsV1>

type OpenAiTokenResponse = {
  access_token?: string
  refresh_token?: string
  id_token?: string
  token_type?: string
  scope?: string
  expires_in?: number
}

type CallbackResult =
  | { ok: true; code: string; state: string }
  | { ok: false; message: string }

type CallbackServer = {
  server: Server
  port: number
  waitForCallback: Promise<CallbackResult>
}

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url')
}

export function createOpenAiPkcePair(): { verifier: string; challenge: string; state: string } {
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  const state = base64Url(randomBytes(16))
  return { verifier, challenge, state }
}

export function buildOpenAiAuthorizeUrl(input: {
  redirectUri: string
  challenge: string
  state: string
}): string {
  const url = new URL(OPENAI_AUTH_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', OPENAI_CLIENT_ID)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('scope', OPENAI_OAUTH_SCOPE)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', input.state)
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', 'codex_cli_rs')
  return url.toString()
}

function oauthSuccessHtml(): string {
  return '<!doctype html><meta charset="utf-8"><title>Kun OpenAI Login</title><body><h2>Login completed</h2><p>You can return to Kun.</p></body>'
}

function oauthErrorHtml(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Kun OpenAI Login</title><body><h2>Login failed</h2><p>${escapeHtml(message)}</p></body>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, 'localhost')
  })
}

async function startCallbackServer(): Promise<CallbackServer> {
  let resolveCallback: (result: CallbackResult) => void = () => {}
  let settled = false
  const waitForCallback = new Promise<CallbackResult>((resolve) => {
    resolveCallback = resolve
  })
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (url.pathname !== OPENAI_CALLBACK_PATH) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('Not found')
        return
      }
      const error = url.searchParams.get('error')
      if (error) {
        const message = url.searchParams.get('error_description') ?? error
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(oauthErrorHtml(message))
        if (!settled) {
          settled = true
          resolveCallback({ ok: false, message })
        }
        return
      }
      const code = url.searchParams.get('code') ?? ''
      const state = url.searchParams.get('state') ?? ''
      if (!code || !state) {
        const message = 'Missing OAuth code or state.'
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(oauthErrorHtml(message))
        if (!settled) {
          settled = true
          resolveCallback({ ok: false, message })
        }
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(oauthSuccessHtml())
      if (!settled) {
        settled = true
        resolveCallback({ ok: true, code, state })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      response.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(oauthErrorHtml(message))
      if (!settled) {
        settled = true
        resolveCallback({ ok: false, message })
      }
    }
  })

  let port: number
  try {
    port = await listen(server, OPENAI_CALLBACK_PORT)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    port = await listen(server, 0)
  }

  return { server, port, waitForCallback }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OpenAI login timed out.')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

async function exchangeOpenAiCode(input: {
  code: string
  verifier: string
  redirectUri: string
  fetchImpl?: typeof fetch
}): Promise<OpenAiTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: OPENAI_CLIENT_ID,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier
  })
  const fetcher = input.fetchImpl ?? fetch
  const response = await fetcher(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(openAiTokenExchangeErrorMessage(response.status, text))
  }
  try {
    return JSON.parse(text) as OpenAiTokenResponse
  } catch (error) {
    throw new Error(`Failed to parse token response: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function openAiTokenExchangeErrorMessage(status: number, body: string): string {
  const excerpt = body.slice(0, 500)
  let code = ''
  let message = ''
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: unknown; message?: unknown; type?: unknown }
    }
    code = typeof parsed.error?.code === 'string' ? parsed.error.code : ''
    message = typeof parsed.error?.message === 'string' ? parsed.error.message : ''
  } catch {
    // Keep the raw excerpt below for non-JSON responses.
  }
  if (code === 'unsupported_country_region_territory' || /unsupported.*country|region|territory/i.test(message)) {
    return [
      'OpenAI rejected the login because the current country, region, or territory is not supported.',
      'Try again from a supported OpenAI region, or use an OpenAI API key / another provider available in your region.',
      `Token exchange failed (${status}): ${code || message || excerpt}`
    ].join(' ')
  }
  return `Token exchange failed (${status}): ${excerpt}`
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractOpenAiAccountId(...tokens: Array<string | undefined>): string | undefined {
  for (const token of tokens) {
    if (!token) continue
    const payload = decodeJwtPayload(token)
    const auth = payload?.['https://api.openai.com/auth']
    if (auth && typeof auth === 'object' && 'user_id' in auth) {
      const value = (auth as { user_id?: unknown }).user_id
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    const subject = payload?.sub
    if (typeof subject === 'string' && subject.trim()) return subject.trim()
  }
  return undefined
}

function statusFromProvider(provider: ModelProviderProfileV1): OpenAiOAuthStatus {
  return {
    connected: Boolean(provider.oauth?.accessToken.trim()),
    providerId: provider.id,
    ...(provider.oauth?.accountId ? { accountId: provider.oauth.accountId } : {}),
    ...(provider.oauth?.expiresAt ? { expiresAt: provider.oauth.expiresAt } : {})
  }
}

function openAiProviderProfile(existing?: ModelProviderProfileV1): ModelProviderProfileV1 {
  const preset = getModelProviderPreset(OPENAI_PROVIDER_ID)
  const base = preset
    ? modelProviderPresetProfile(preset, existing?.apiKey ?? '')
    : {
        id: OPENAI_PROVIDER_ID,
        name: 'OpenAI',
        apiKey: existing?.apiKey ?? '',
        baseUrl: 'https://api.openai.com/v1',
        endpointFormat: 'responses' as const,
        models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
        modelProfiles: {}
      }
  return existing
    ? {
        ...base,
        name: existing.name.trim() || base.name,
        apiKey: existing.apiKey,
        models: existing.models.length ? existing.models : base.models,
        modelProfiles: { ...base.modelProfiles, ...existing.modelProfiles },
        ...(existing.oauth ? { oauth: existing.oauth } : {})
      }
    : base
}

function providersWithOpenAiOAuth(
  settings: AppSettingsV1,
  providerId: string,
  oauth: ModelProviderOAuthV1 | undefined
): ModelProviderProfileV1[] {
  const normalizedId = normalizeModelProviderId(providerId) || OPENAI_PROVIDER_ID
  const providers = settings.provider.providers
  const existing = providers.find((provider) => provider.id === normalizedId)
  const nextProvider = {
    ...(normalizedId === OPENAI_PROVIDER_ID ? openAiProviderProfile(existing) : existing),
    ...(existing && normalizedId !== OPENAI_PROVIDER_ID ? existing : {}),
    ...(oauth ? { oauth } : {})
  } as ModelProviderProfileV1
  if (!nextProvider.id) return providers
  if (providers.some((provider) => provider.id === nextProvider.id)) {
    return providers.map((provider) => provider.id === nextProvider.id ? nextProvider : provider)
  }
  return [...providers, nextProvider]
}

export async function startOpenAiOAuthLogin(input: {
  settings: AppSettingsV1
  providerId: string
  applySettingsPatch: ApplySettingsPatch
  fetchImpl?: typeof fetch
}): Promise<OpenAiOAuthResult> {
  const providerId = normalizeModelProviderId(input.providerId) || OPENAI_PROVIDER_ID
  const callback = await startCallbackServer()
  const redirectUri = `http://localhost:${callback.port}${OPENAI_CALLBACK_PATH}`
  const pkce = createOpenAiPkcePair()
  const authorizeUrl = buildOpenAiAuthorizeUrl({
    redirectUri,
    challenge: pkce.challenge,
    state: pkce.state
  })

  try {
    await shell.openExternal(authorizeUrl)
    const callbackResult = await withTimeout(callback.waitForCallback, OAUTH_TIMEOUT_MS)
    if (!callbackResult.ok) return { ok: false, message: callbackResult.message }
    if (callbackResult.state !== pkce.state) {
      return { ok: false, message: 'OAuth state mismatch.' }
    }
    const tokenResponse = await exchangeOpenAiCode({
      code: callbackResult.code,
      verifier: pkce.verifier,
      redirectUri,
      fetchImpl: input.fetchImpl
    })
    if (!tokenResponse.access_token || !tokenResponse.refresh_token) {
      return { ok: false, message: 'Token response did not include access and refresh tokens.' }
    }
    const now = Date.now()
    const expiresAt = new Date(now + Math.max(1, tokenResponse.expires_in ?? 3600) * 1000).toISOString()
    const accountId = extractOpenAiAccountId(tokenResponse.access_token, tokenResponse.id_token)
    const oauth: ModelProviderOAuthV1 = {
      provider: 'openai',
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenType: tokenResponse.token_type ?? 'Bearer',
      scope: tokenResponse.scope ?? OPENAI_OAUTH_SCOPE,
      expiresAt,
      ...(accountId ? { accountId } : {}),
      updatedAt: new Date(now).toISOString()
    }
    const providers = providersWithOpenAiOAuth(input.settings, providerId, oauth)
    const selectedModel = providers.find((item) => item.id === providerId)?.models[0]
    const updated = await input.applySettingsPatch({
      provider: { providers },
      agents: {
        kun: {
          providerId,
          apiKey: '',
          baseUrl: '',
          ...(selectedModel ? { model: selectedModel } : {})
        }
      }
    })
    const updatedProvider = updated.provider.providers.find((provider) => provider.id === providerId)
    return updatedProvider
      ? { ok: true, status: statusFromProvider(updatedProvider) }
      : { ok: false, message: 'OpenAI provider was not saved.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    callback.server.close()
  }
}

export async function logoutOpenAiOAuth(input: {
  settings: AppSettingsV1
  providerId: string
  applySettingsPatch: ApplySettingsPatch
}): Promise<OpenAiOAuthResult> {
  const providerId = normalizeModelProviderId(input.providerId) || OPENAI_PROVIDER_ID
  const providers = input.settings.provider.providers.map((provider) => {
    if (provider.id !== providerId) return provider
    const { oauth: _oauth, ...rest } = provider
    void _oauth
    return rest
  })
  const updated = await input.applySettingsPatch({ provider: { providers } })
  const provider = updated.provider.providers.find((item) => item.id === providerId)
  return provider
    ? { ok: true, status: statusFromProvider(provider) }
    : { ok: false, message: 'OpenAI provider was not found.' }
}
