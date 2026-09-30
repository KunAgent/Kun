import { useState } from 'react'
import type { BuiltinGitHubMcpAuthorizationPreflight } from '@shared/github-mcp-authorization'
import type { MarketplaceNotice } from './PluginMarketplaceParts'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type GitHubMcpRuntimeCheck = {
  status?: string
  lastError?: string
}

const CONNECTION_CHECK_INTERVAL_MS = 1_000
const CONNECTION_CHECK_TIMEOUT_MS = 45_000
const CONNECTION_ERROR_GRACE_MS = 10_000

export function useGitHubMcpAuthorization(options: {
  t: Translate
  setNotice: (notice: MarketplaceNotice | null) => void
  refreshRuntime: () => Promise<GitHubMcpRuntimeCheck | null>
}) {
  const [preflight, setPreflight] = useState<BuiltinGitHubMcpAuthorizationPreflight | null>(null)
  const [busy, setBusy] = useState(false)

  const inspect = async (host?: string): Promise<void> => {
    setBusy(true)
    options.setNotice(null)
    try {
      setPreflight(await window.kunGui.preflightBuiltinGitHubMcpAuthorization(host))
    } catch (error) {
      options.setNotice(errorNotice(error))
    } finally {
      setBusy(false)
    }
  }

  const bind = async (host: string): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.kunGui.startBuiltinGitHubMcpLogin(host)
      if (!result.started) {
        options.setNotice({
          tone: 'error',
          message: options.t(result.reason === 'github-cli-unavailable'
            ? 'pluginGithubBindCliMissing'
            : result.reason === 'unsupported-host'
              ? 'pluginGithubEnterpriseUnsupported'
              : 'pluginGithubBindFailed')
        })
        return
      }
      const next = await window.kunGui.preflightBuiltinGitHubMcpAuthorization(host)
      setPreflight(next)
      if (next.status !== 'ready') {
        options.setNotice({ tone: 'error', message: options.t('pluginGithubBindFailed') })
      }
    } catch (error) {
      options.setNotice(errorNotice(error))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (input: {
    allowedOrganizations: string[]
    allowedRepositories: string[]
  }): Promise<void> => {
    if (preflight?.status !== 'ready') return
    setBusy(true)
    try {
      const result = await window.kunGui.confirmBuiltinGitHubMcpAuthorization({
        nonce: preflight.nonce,
        allowedHosts: [preflight.identity.host],
        ...input
      })
      setPreflight(null)
      if (!result.authorized) {
        options.setNotice({ tone: 'error', message: options.t('pluginGithubAuthExpired') })
        return
      }
      options.setNotice({ tone: 'info', message: options.t('pluginGithubAuthChecking') })
      const connection = await waitForGitHubMcpConnection(options.refreshRuntime)
      options.setNotice(connection.connected
        ? { tone: 'success', message: options.t('pluginGithubAuthSuccess') }
        : connection.timedOut
          ? { tone: 'error', message: options.t('pluginGithubConnectionTimeout') }
          : {
              tone: 'error',
              message: options.t('pluginGithubConnectionFailed', {
                message: connection.error || options.t('pluginGithubConnectionUnknown')
              })
            })
    } catch (error) {
      options.setNotice(errorNotice(error))
    } finally {
      setBusy(false)
    }
  }

  const disable = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.kunGui.disableBuiltinGitHubMcp()
      setPreflight(null)
      options.setNotice({ tone: 'success', message: options.t('pluginGithubDisabled') })
      await options.refreshRuntime()
    } catch (error) {
      options.setNotice(errorNotice(error))
    } finally {
      setBusy(false)
    }
  }

  return { preflight, busy, inspect, bind, confirm, disable, close: () => setPreflight(null) }
}

async function waitForGitHubMcpConnection(
  refreshRuntime: () => Promise<GitHubMcpRuntimeCheck | null>
): Promise<{ connected: boolean; timedOut: boolean; error?: string }> {
  const deadline = Date.now() + CONNECTION_CHECK_TIMEOUT_MS
  let failureObservedAt: number | undefined
  let lastError = ''

  while (Date.now() < deadline) {
    const runtime = await refreshRuntime()
    if (runtime?.status === 'connected') return { connected: true, timedOut: false }

    if (runtime?.status === 'error' || runtime?.status === 'authorization_required') {
      failureObservedAt ??= Date.now()
      lastError = runtime.lastError ?? ''
      if (Date.now() - failureObservedAt >= CONNECTION_ERROR_GRACE_MS) {
        return { connected: false, timedOut: false, ...(lastError ? { error: lastError } : {}) }
      }
    } else {
      failureObservedAt = undefined
    }

    await delay(CONNECTION_CHECK_INTERVAL_MS)
  }

  return { connected: false, timedOut: true, ...(lastError ? { error: lastError } : {}) }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function errorNotice(error: unknown): MarketplaceNotice {
  return { tone: 'error', message: error instanceof Error ? error.message : String(error) }
}
