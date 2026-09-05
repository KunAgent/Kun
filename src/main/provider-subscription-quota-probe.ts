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
  defaultSubscriptionQuotaRuntime,
  probeGoogleCodeAssistQuota,
  probeGrokSubscriptionQuota,
  resolveAntigravityCredential,
  resolveClaudeToken,
  resolveCodexCredential,
  resolveCursorSession,
  resolveGrokCredential
} from './provider-subscription-quota-credentials'
import {
  parseClaudeSubscriptionQuota,
  parseCodexSubscriptionQuota,
  parseCursorSubscriptionQuota
} from './provider-subscription-quota-parsers'
import {
  requestCodexRateLimitResetCredits,
  requestCodexSubscriptionQuota,
  requestSubscriptionJson
} from './provider-subscription-quota-transport'
import type { CodexQuotaCredential } from './provider-subscription-quota-types'
import {
  ProviderQuotaAuthorizationError,
  ProviderQuotaMissingCredentialError,
  SubscriptionProbeContext,
  SubscriptionQuotaProbeKind,
  SubscriptionQuotaRuntime
} from './provider-subscription-quota-types'

async function probeCodexSubscriptionQuota(
  credential: CodexQuotaCredential,
  context: SubscriptionProbeContext
): Promise<{ metrics: ProviderQuotaMetric[]; summary?: string }> {
  // Mirror the official Codex client: fetch usage and reset-credit details together;
  // a details failure degrades to the count embedded in the usage response.
  const usagePromise = requestCodexSubscriptionQuota(credential, context)
  const detailsPromise = requestCodexRateLimitResetCredits(credential, context)
    .catch(() => undefined)
  return parseCodexSubscriptionQuota(await usagePromise, await detailsPromise)
}

export async function runSubscriptionQuotaProbe(
  kind: SubscriptionQuotaProbeKind,
  provider: ModelProviderProfileV1,
  context: SubscriptionProbeContext,
  runtimeOverrides: Partial<SubscriptionQuotaRuntime> = {}
): Promise<{ metrics: ProviderQuotaMetric[]; summary?: string; source?: string }> {
  const runtime = { ...defaultSubscriptionQuotaRuntime, ...runtimeOverrides }
  if (kind === 'claude-subscription') {
    const accessToken = await runtime.resolveClaudeToken(provider)
    if (!accessToken) {
      throw new ProviderQuotaMissingCredentialError(
        'Sign in with Claude Code or add a Claude setup token in Settings.'
      )
    }
    return {
      metrics: parseClaudeSubscriptionQuota(await requestSubscriptionJson(
        'https://api.anthropic.com/api/oauth/usage',
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'anthropic-beta': 'oauth-2025-04-20',
            'User-Agent': 'claude-code/2.1.0'
          }
        },
        context
      ))
    }
  }
  if (kind === 'codex-subscription') {
    let credential = await runtime.resolveCodexCredential(provider, undefined, context)
    if (!credential) {
      throw new ProviderQuotaMissingCredentialError(
        'Connect the ChatGPT subscription in Settings or sign in with Codex CLI.'
      )
    }
    try {
      return await probeCodexSubscriptionQuota(credential, context)
    } catch (error) {
      if (!(error instanceof ProviderQuotaAuthorizationError)) throw error
      const refreshed = await runtime.resolveCodexCredential(
        provider,
        credential.accessToken,
        context
      )
      if (!refreshed || refreshed.accessToken === credential.accessToken) {
        throw new ProviderQuotaMissingCredentialError(
          'The Codex login expired. Sign in to the ChatGPT subscription or Codex CLI again.'
        )
      }
      credential = refreshed
      return probeCodexSubscriptionQuota(credential, context)
    }
  }
  if (kind === 'grok-subscription') {
    let credential = await runtime.resolveGrokCredential(provider, undefined, context)
    if (!credential) {
      throw new ProviderQuotaMissingCredentialError(
        'Connect Grok in Settings or run `grok login` before refreshing quota.'
      )
    }
    try {
      return {
        metrics: await probeGrokSubscriptionQuota(credential, context),
        ...(credential.email ? { summary: credential.email } : {})
      }
    } catch (error) {
      if (!(error instanceof ProviderQuotaAuthorizationError)) throw error
      const refreshed = await runtime.resolveGrokCredential(
        provider,
        credential.accessToken,
        context
      )
      if (!refreshed || refreshed.accessToken === credential.accessToken) {
        throw new ProviderQuotaMissingCredentialError(
          'The Grok login expired. Connect Grok in Settings or run `grok login` again.'
        )
      }
      credential = refreshed
      return {
        metrics: await probeGrokSubscriptionQuota(credential, context),
        ...(credential.email ? { summary: credential.email } : {})
      }
    }
  }
  if (kind === 'cursor-subscription') {
    const session = await runtime.resolveCursorSession()
    if (!session) {
      throw new ProviderQuotaMissingCredentialError(
        'Sign in to Cursor.app on this computer before refreshing quota.'
      )
    }
    return parseCursorSubscriptionQuota(await requestSubscriptionJson(
      'https://cursor.com/api/usage-summary',
      {
        headers: {
          Accept: 'application/json',
          Cookie: session.cookieHeader
        }
      },
      context
    ))
  }
  if (kind === 'antigravity-subscription') {
    const credential = await runtime.resolveAntigravityCredential(context)
    if (!credential) {
      throw new ProviderQuotaMissingCredentialError(
        'Sign in to the official Antigravity app on this computer before refreshing quota.'
      )
    }
    return probeGoogleCodeAssistQuota(credential, context, 'antigravity')
  }
  if (kind === 'opencode-go-local') {
    const tryWeb = async (cookieHeader: string) => {
      const web = await runtime.fetchOpenCodeGoWebQuota(cookieHeader, context)
      if (web.metrics.length > 0) {
        return {
          metrics: web.metrics,
          ...(web.summary ? { summary: web.summary } : {}),
          source: 'OpenCode Go subscription usage'
        } as const
      }
      return undefined
    }

    let cookieHeader = await runtime.resolveOpenCodeGoCookie()
    if (cookieHeader) {
      try {
        const web = await tryWeb(cookieHeader)
        if (web) return web
      } catch (error) {
        if (!(error instanceof OpenCodeGoWebQuotaError)) throw error
        if (error.code === 'invalid_credentials') {
          clearOpenCodeGoCookieCache()
          cookieHeader = await runtime.resolveOpenCodeGoCookie()
          if (cookieHeader) {
            try {
              const web = await tryWeb(cookieHeader)
              if (web) return web
            } catch (retryError) {
              if (!(retryError instanceof OpenCodeGoWebQuotaError)) throw retryError
            }
          }
        }
      }
    }
    const quota = await runtime.resolveOpenCodeGoQuota()
    if (quota) {
      return {
        ...quota,
        source: 'OpenCode Go local usage estimate'
      }
    }
    throw new ProviderQuotaMissingCredentialError(
      getOpenCodeGoCookieFailureReason() === 'decrypt_failed'
        ? OPENCODE_GO_KEYCHAIN_MESSAGE
        : OPENCODE_GO_SIGN_IN_MESSAGE
    )
  }
  const accessToken = await runtime.resolveGeminiCliToken(context)
  if (!accessToken) {
    throw new ProviderQuotaMissingCredentialError(
      'Run Gemini CLI and sign in with Google before refreshing quota.'
    )
  }
  return probeGoogleCodeAssistQuota({ accessToken }, context, 'gemini-cli')
}
