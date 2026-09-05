import { useState } from 'react'
import type { BuiltinGitHubMcpAuthorizationPreflight } from '@shared/github-mcp-authorization'
import type { MarketplaceNotice } from './PluginMarketplaceParts'

type Translate = (key: string, values?: Record<string, unknown>) => string

export function useGitHubMcpAuthorization(options: {
  t: Translate
  setNotice: (notice: MarketplaceNotice | null) => void
  refreshRuntime: () => Promise<void>
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
      options.setNotice({
        tone: result.authorized ? 'success' : 'error',
        message: options.t(result.authorized ? 'pluginGithubAuthSuccess' : 'pluginGithubAuthExpired')
      })
      if (result.authorized) await options.refreshRuntime()
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

function errorNotice(error: unknown): MarketplaceNotice {
  return { tone: 'error', message: error instanceof Error ? error.message : String(error) }
}
