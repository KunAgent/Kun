import type { ExtensionCredentialStore } from '../services/extension-credential-store.js'
import type { FigmaCredentialSource } from './figma-credential.js'

/**
 * Opaque reference for Kun's encrypted credential store. Ordinary settings and
 * model context only ever see this reference, never the token itself.
 */
export const FIGMA_CREDENTIAL_REFERENCE = 'cred_figma-pat'

export type FigmaCredentialStatus = {
  stored: boolean
  expiresAt?: string
}

/**
 * Encrypted-at-rest storage for the Figma personal access token.
 *
 * A PAT cannot be refreshed, so expiry is only reported: Kun never guesses a
 * new lifetime from the token string and never silently retries with another
 * credential.
 */
export class FigmaCredentialStore implements FigmaCredentialSource {
  constructor(private readonly store: Pick<ExtensionCredentialStore, 'get' | 'set' | 'delete'>) {}

  async readToken(): Promise<string | undefined> {
    const payload = await this.payload()
    const token = payload?.accessToken?.trim()
    return token ? token : undefined
  }

  async saveToken(token: string, expiresAt?: string): Promise<void> {
    const trimmed = token.trim()
    if (!trimmed) throw new Error('A Figma personal access token is required')
    await this.store.set(FIGMA_CREDENTIAL_REFERENCE, {
      accessToken: trimmed,
      tokenType: 'personal_access_token',
      ...(expiresAt ? { expiresAt } : {})
    })
  }

  async clearToken(): Promise<void> {
    await this.store.delete(FIGMA_CREDENTIAL_REFERENCE)
  }

  async status(): Promise<FigmaCredentialStatus> {
    const payload = await this.payload()
    if (!payload?.accessToken?.trim()) return { stored: false }
    return { stored: true, ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}) }
  }

  private async payload(): Promise<{ accessToken?: string; expiresAt?: string } | null> {
    try {
      return await this.store.get(FIGMA_CREDENTIAL_REFERENCE)
    } catch {
      return null
    }
  }
}
