import { useCallback, useEffect, useRef, useState } from 'react'
import { BUILTIN_GITHUB_MCP_SERVER_ID } from '@shared/github-mcp'
import { getProvider } from '../../agent/registry'
import type { CoreRuntimeInfoJson, CoreRuntimeToolDiagnosticsJson } from '../../agent/kun-contract'
import { runtimeOverlayErrorMessage } from '../PluginMarketplaceRuntimePanels'
import type { GitHubMcpRuntimeCheck } from '../use-github-mcp-authorization'

type Translate = (key: string, values?: Record<string, unknown>) => string

/**
 * The Kun config text that holds MCP servers plus the runtime's view of them
 * (connection status, tool counts). Writes always go through `write` so the
 * in-memory text matches what was saved.
 */
export function usePluginMcp({ t, active }: { t: Translate; active: boolean }) {
  const [configText, setConfigText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [runtimeInfo, setRuntimeInfo] = useState<CoreRuntimeInfoJson | null>(null)
  const [diagnostics, setDiagnostics] = useState<CoreRuntimeToolDiagnosticsJson | null>(null)
  const [overlayLoading, setOverlayLoading] = useState(false)
  const [overlayError, setOverlayError] = useState('')
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const textRef = useRef('')

  const read = useCallback(async (): Promise<string> => {
    if (typeof window.kunGui?.getKunConfigFile !== 'function') return textRef.current
    const file = await window.kunGui.getKunConfigFile()
    textRef.current = file.content
    setConfigText(file.content)
    setLoaded(true)
    setLoadError('')
    return file.content
  }, [])

  /** Latest config text, reading it first if this view has not loaded it yet. */
  const current = useCallback(async (): Promise<string> => (loaded ? textRef.current : read()), [loaded, read])

  const write = useCallback(async (text: string): Promise<{ path: string }> => {
    const result = await window.kunGui.setKunConfigFile(text)
    textRef.current = text
    setConfigText(text)
    setLoaded(true)
    return { path: result.path }
  }, [])

  useEffect(() => {
    if (loaded) return
    void read().catch((error) => setLoadError(error instanceof Error ? error.message : String(error)))
  }, [loaded, read])

  const refreshOverlay = useCallback(async (): Promise<GitHubMcpRuntimeCheck | null> => {
    if (typeof window.kunGui?.runtimeRequest !== 'function') {
      setRuntimeInfo(null)
      setDiagnostics(null)
      setOverlayError(t('pluginMcpRuntimeUnavailable'))
      return null
    }
    const provider = getProvider()
    if (!provider.getRuntimeInfo && !provider.getToolDiagnostics) {
      setOverlayError(t('pluginMcpRuntimeUnavailable'))
      return null
    }
    setOverlayLoading(true)
    setOverlayError('')
    try {
      const [runtimeResult, diagnosticsResult] = await Promise.allSettled([
        provider.getRuntimeInfo?.(),
        provider.getToolDiagnostics?.()
      ])
      if (runtimeResult.status === 'fulfilled' && runtimeResult.value) setRuntimeInfo(runtimeResult.value)
      if (diagnosticsResult.status === 'fulfilled' && diagnosticsResult.value) setDiagnostics(diagnosticsResult.value)
      const errors = [runtimeResult, diagnosticsResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => runtimeOverlayErrorMessage(result.reason, t('pluginMcpRuntimeUnavailable')))
      if (errors.length > 0) setOverlayError(errors[0] ?? t('pluginActionFailed'))
      setCheckedAt(Date.now())
      const github = diagnosticsResult.status === 'fulfilled'
        ? diagnosticsResult.value?.mcpServers?.find((server) => server.id === BUILTIN_GITHUB_MCP_SERVER_ID)
        : undefined
      return github
        ? {
            status: typeof github.status === 'string' ? github.status : undefined,
            lastError: typeof github.lastError === 'string' ? github.lastError : undefined
          }
        : null
    } finally {
      setOverlayLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!active) return
    void refreshOverlay()
  }, [active, refreshOverlay])

  return {
    configText,
    loaded,
    loadError,
    read,
    current,
    write,
    runtimeInfo,
    diagnostics,
    overlayLoading,
    overlayError,
    checkedAt,
    refreshOverlay
  }
}

export type PluginMcpState = ReturnType<typeof usePluginMcp>
