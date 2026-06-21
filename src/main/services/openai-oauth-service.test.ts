import { describe, expect, it, vi } from 'vitest'
import {
  buildOpenAiAuthorizeUrl,
  createOpenAiPkcePair,
  openAiTokenExchangeErrorMessage
} from './openai-oauth-service'

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn()
  }
}))

describe('OpenAI OAuth service', () => {
  it('generates PKCE verifier, challenge, and state values', () => {
    const pair = createOpenAiPkcePair()

    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pair.state).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pair.verifier).not.toBe(pair.challenge)
  })

  it('builds the Codex-style OpenAI authorization URL', () => {
    const url = new URL(buildOpenAiAuthorizeUrl({
      redirectUri: 'http://localhost:1455/auth/callback',
      challenge: 'challenge',
      state: 'state'
    }))

    expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:1455/auth/callback')
    expect(url.searchParams.get('scope')).toBe(
      'openid profile email offline_access api.connectors.read api.connectors.invoke'
    )
    expect(url.searchParams.get('code_challenge')).toBe('challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('state')
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true')
    expect(url.searchParams.get('originator')).toBe('codex_cli_rs')
  })

  it('explains OpenAI unsupported-region token exchange errors', () => {
    const message = openAiTokenExchangeErrorMessage(403, JSON.stringify({
      error: {
        code: 'unsupported_country_region_territory',
        message: 'Country, region, or territory not supported',
        type: 'request_forbidden'
      }
    }))

    expect(message).toContain('country, region, or territory is not supported')
    expect(message).toContain('Token exchange failed (403): unsupported_country_region_territory')
  })
})
