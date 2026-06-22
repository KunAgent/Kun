import { describe, expect, it } from 'vitest'
import {
  buildAnthropicAuthorizeUrl,
  encodeAnthropicCredentials,
  isAnthropicOAuthCredentials,
  parseAnthropicCredentials,
  type AnthropicOAuthCredentials
} from './anthropic-auth'

const creds: AnthropicOAuthCredentials = {
  kind: 'anthropic-oauth',
  accessToken: 'sk-ant-oat01-abc',
  refreshToken: 'sk-ant-ort01-xyz',
  expiresAt: 1_700_000_000_000,
  email: 'user@example.com'
}

describe('anthropic-auth credential helpers', () => {
  it('round-trips encode → parse', () => {
    const decoded = parseAnthropicCredentials(encodeAnthropicCredentials(creds))
    expect(decoded).toEqual(creds)
  })

  it('detects anthropic-oauth credentials and rejects others', () => {
    expect(isAnthropicOAuthCredentials(encodeAnthropicCredentials(creds))).toBe(true)
    expect(isAnthropicOAuthCredentials('sk-ant-api03-plainkey')).toBe(false)
    expect(isAnthropicOAuthCredentials('{"kind":"codex-oauth"}')).toBe(false)
    expect(isAnthropicOAuthCredentials('{not json')).toBe(false)
    expect(isAnthropicOAuthCredentials('')).toBe(false)
  })

  it('parse returns null for incomplete credentials', () => {
    expect(parseAnthropicCredentials('sk-ant-api03-plainkey')).toBeNull()
    expect(
      parseAnthropicCredentials(JSON.stringify({ kind: 'anthropic-oauth', accessToken: 'a' }))
    ).toBeNull()
  })
})

describe('buildAnthropicAuthorizeUrl', () => {
  it('includes the required PKCE + Claude Code OAuth params', () => {
    const url = new URL(buildAnthropicAuthorizeUrl('CHALLENGE', 'STATE'))
    expect(url.origin + url.pathname).toBe('https://claude.ai/oauth/authorize')
    const p = url.searchParams
    expect(p.get('code')).toBe('true')
    expect(p.get('response_type')).toBe('code')
    expect(p.get('client_id')).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e')
    expect(p.get('redirect_uri')).toBe('http://localhost:53692/callback')
    expect(p.get('code_challenge')).toBe('CHALLENGE')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('state')).toBe('STATE')
    expect(p.get('scope')).toContain('user:inference')
    expect(p.get('scope')).toContain('org:create_api_key')
  })
})
