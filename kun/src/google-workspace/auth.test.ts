import { describe, expect, it } from 'vitest'
import { sanitizeGoogleWorkspaceAuth, validateGoogleAuthorizationUrl } from './auth.js'
import { GOOGLE_WORKSPACE_IDENTITY_SCOPES, GOOGLE_WORKSPACE_SCOPES } from './types.js'
const validUrl = (): URL => {
  const url = new URL('https://accounts.google.com/o/oauth2/auth')
  url.searchParams.set('client_id', '123.apps.googleusercontent.com')
  url.searchParams.set('redirect_uri', 'http://localhost:12345')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', [...GOOGLE_WORKSPACE_SCOPES, ...GOOGLE_WORKSPACE_IDENTITY_SCOPES].join(' '))
  return url
}
describe('Google Workspace auth boundary', () => {
  it('does not infer live auth from credential presence', () => {
    expect(sanitizeGoogleWorkspaceAuth({ client_config_exists: true, encrypted_credentials_exists: true }).state).toBe('error')
    expect(sanitizeGoogleWorkspaceAuth({ client_config_exists: true }).state).toBe('disconnected')
    expect(sanitizeGoogleWorkspaceAuth({}).state).toBe('setup_required')
  })
  it('uses an allowlist, dropping every secret/path/account/project/error field', () => {
    const raw = { token_valid: true, client_config_exists: true, token: 'private', user: 'private@example.com',
      encrypted_credentials: '/private/credentials.enc', config_client_id: 'private', project_id: 'private',
      client_config_error: 'private', scopes: [...GOOGLE_WORKSPACE_SCOPES, 'private', 'https://www.googleapis.com/auth/cloud-platform'] }
    expect(sanitizeGoogleWorkspaceAuth(raw)).toEqual({ state: 'connected', scopes: [...GOOGLE_WORKSPACE_SCOPES] })
    expect(JSON.stringify(sanitizeGoogleWorkspaceAuth(raw))).not.toContain('private')
  })
  it('allows only the pinned Google localhost flow and exact requested scopes', () => {
    expect(validateGoogleAuthorizationUrl(validUrl().href)).toBe(validUrl().href)
    for (const update of [
      (u: URL) => { u.hostname = 'accounts.google.com.evil.example' },
      (u: URL) => { u.protocol = 'http:' },
      (u: URL) => { u.username = 'evil' },
      (u: URL) => { u.searchParams.set('redirect_uri', 'https://evil.example/callback') },
      (u: URL) => { u.searchParams.set('scope', 'https://www.googleapis.com/auth/drive') },
      (u: URL) => { u.searchParams.append('redirect_uri', 'http://localhost:12') },
      (u: URL) => { u.searchParams.set('client_id', 'not-google') },
      (u: URL) => { u.pathname = '/logout' }
    ]) {
      const url = validUrl(); update(url)
      expect(validateGoogleAuthorizationUrl(url.href)).toBeUndefined()
    }
  })
})
