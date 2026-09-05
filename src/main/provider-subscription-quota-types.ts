import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { validateClaudeSubscriptionToken } from '../shared/claude-subscription-auth'
import type { ModelProviderProfileV1 } from '../shared/app-settings'
import type { ProviderQuotaMetric } from '../shared/provider-quota'
import {
  GeminiCliOAuthSource
} from '../../kun/src/adapters/model/gemini-cli-oauth.js'
import { geminiCliRequestHeaders } from '../../kun/src/adapters/model/provider-cli-identity.js'
import {
  readOpenCodeGoLocalQuota,
  type OpenCodeGoLocalQuotaResult
} from '../../kun/src/services/opencode-go-local-quota.js'
import {
  clearOpenCodeGoCookieCache,
  getOpenCodeGoCookieFailureReason,
  OPENCODE_GO_KEYCHAIN_MESSAGE,
  OPENCODE_GO_SIGN_IN_MESSAGE,
  resolveOpenCodeGoCookie as resolveOpenCodeGoCookieImpl
} from '../../kun/src/services/provider-subscription-quota.js'
import {
  fetchOpenCodeGoWebQuota as fetchOpenCodeGoWebQuotaImpl,
  OpenCodeGoWebQuotaError,
  type OpenCodeGoWebQuotaResult
} from '../../kun/src/services/opencode-go-web-quota.js'
import {
  codexUserAgent,
  parseCodexCredentials,
  refreshCodexToken,
  type CodexOAuthCredentials
} from './codex-auth'
import {
  isGrokCredentialExpired,
  parseGrokCredentials,
  refreshGrokToken,
  type GrokOAuthCredentials
} from './grok-auth'

import {
  resolveAntigravityCredential,
  resolveClaudeToken,
  resolveCodexCredential,
  resolveCursorSession,
  resolveGrokCredential
} from './provider-subscription-quota-credentials'

export type SubscriptionQuotaProbeKind =
  | 'claude-subscription'
  | 'codex-subscription'
  | 'grok-subscription'
  | 'cursor-subscription'
  | 'antigravity-subscription'
  | 'gemini-cli-subscription'
  | 'opencode-go-local'

export type SubscriptionQuotaFetch = (
  input: string | URL,
  init: RequestInit | undefined,
  proxyUrl: string
) => Promise<Response>

export type SubscriptionProbeContext = {
  fetcher: SubscriptionQuotaFetch
  proxyUrl: string
}

export type CodexQuotaCredential = {
  accessToken: string
  accountId?: string
}

export type GrokQuotaCredential = {
  accessToken: string
  email?: string
}

export type CursorQuotaSession = {
  cookieHeader: string
}

export type GoogleQuotaCredential = {
  accessToken: string
  accountEmail?: string
}

export type SubscriptionQuotaRuntime = {
  resolveClaudeToken(provider: ModelProviderProfileV1): Promise<string | undefined>
  resolveCodexCredential(
    provider: ModelProviderProfileV1,
    rejectedAccessToken?: string,
    context?: SubscriptionProbeContext
  ): Promise<CodexQuotaCredential | undefined>
  resolveGrokCredential(
    provider: ModelProviderProfileV1,
    rejectedAccessToken?: string,
    context?: SubscriptionProbeContext
  ): Promise<GrokQuotaCredential | undefined>
  resolveCursorSession(): Promise<CursorQuotaSession | undefined>
  resolveAntigravityCredential(
    context: SubscriptionProbeContext
  ): Promise<GoogleQuotaCredential | undefined>
  resolveGeminiCliToken(context: SubscriptionProbeContext): Promise<string | undefined>
  resolveOpenCodeGoQuota(): Promise<OpenCodeGoLocalQuotaResult | undefined>
  resolveOpenCodeGoCookie(): Promise<string | undefined>
  fetchOpenCodeGoWebQuota(
    cookieHeader: string,
    context: SubscriptionProbeContext
  ): Promise<OpenCodeGoWebQuotaResult>
}

export class ProviderQuotaMissingCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderQuotaMissingCredentialError'
  }
}

export class ProviderQuotaAuthorizationError extends Error {
  constructor(readonly status: number) {
    super('The provider did not authorize quota access for the existing login.')
    this.name = 'ProviderQuotaAuthorizationError'
  }
}
