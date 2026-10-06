import { useEffect, useState, type ReactElement } from 'react'
import { ExternalLink, FolderOpen, RefreshCw } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { HarnessIntegrationInfo, HarnessIntegrationOpenRequest } from '../../../../../kun/src/contracts/harness-integration'
import { rendererRuntimeClient } from '../../agent/runtime-client'

export type IntegrationT = (key: string, options?: Record<string, unknown>) => string
const secondaryButton = 'inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 py-1.5 text-[12px] text-ds-ink hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45'

export function useAgentIntegration(row: AdeHarnessRow) {
  const [info, setInfo] = useState<HarnessIntegrationInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [opening, setOpening] = useState<string | null>(null)
  const [openError, setOpenError] = useState('')
  const id = row.definition.id
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setLoadError(false)
    setInfo(null)
    const timer = setTimeout(() => {
      if (!active) return
      controller.abort()
      setLoadError(true)
      setLoading(false)
    }, 15_000)
    void rendererRuntimeClient.runtimeRequest(`/v1/harnesses/${encodeURIComponent(id)}/integration`, 'GET', undefined,
      { signal: controller.signal }).then((result) => {
      if (!active || controller.signal.aborted) return
      if (!result.ok) throw new Error('integration request failed')
      const value = JSON.parse(result.body) as HarnessIntegrationInfo
      if (value.harnessId !== id || !Array.isArray(value.configurations)) throw new Error('invalid integration response')
      setInfo(value)
    }).catch(() => {
      if (active && !controller.signal.aborted) setLoadError(true)
    }).finally(() => {
      clearTimeout(timer)
      if (active && !controller.signal.aborted) setLoading(false)
    })
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [id, row.status.checkedAt, revision])

  const open = async (request: Omit<HarnessIntegrationOpenRequest, 'harnessId'>, t: IntegrationT): Promise<void> => {
    if (opening) return
    setOpenError('')
    if (typeof window.kunGui?.openAgentIntegration !== 'function') {
      setOpenError(t('agentIntegrations.desktopOnly'))
      return
    }
    setOpening(`${request.action}:${request.index ?? ''}`)
    try {
      const result = await window.kunGui.openAgentIntegration({ harnessId: id, ...request })
      if (!result.ok) setOpenError(result.message || t('agentIntegrations.openError'))
    } catch {
      setOpenError(t('agentIntegrations.openError'))
    } finally { setOpening(null) }
  }
  const openDocs = async (url: string, t: IntegrationT): Promise<void> => {
    setOpenError('')
    try {
      if (typeof window.kunGui?.openExternal !== 'function') throw new Error('desktop unavailable')
      await window.kunGui.openExternal(url)
    } catch { setOpenError(t('agentIntegrations.openError')) }
  }
  return { info, loading, loadError, opening, openError, open, openDocs, reload: () => setRevision((value) => value + 1) }
}

export function AgentIntegrationLocations({ integration, t }: {
  integration: ReturnType<typeof useAgentIntegration>
  t: IntegrationT
}): ReactElement {
  const { info, loading, loadError, opening, openError, open, reload } = integration
  return <section className="mt-4 space-y-2" data-agent-integration-locations>
    <h3 className="text-[12px] font-semibold text-ds-ink">{t('agentIntegrations.configurationTitle')}</h3>
    <p className="text-[11px] text-ds-faint">{t('agentIntegrations.configurationHint')}</p>
    {loading ? <p role="status" aria-live="polite" className="text-[12px] text-ds-muted">{t('agentIntegrations.loadingLocations')}</p> : null}
    {loadError ? <div role="alert" className="space-y-2 text-[12px] text-ds-status-danger">
      <p>{t('agentIntegrations.locationsError')}</p>
      <button type="button" className={secondaryButton} onClick={reload}><RefreshCw size={14} />{t('adeAgentAction.retry')}</button>
    </div> : null}
    {info && !loading ? info.configurations.length ? <ul className="space-y-2">
      {info.configurations.map((target, index) => <li key={`${index}:${target.path}`}
        className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-ds-border-muted bg-ds-main/40 px-3 py-2"
        data-agent-configuration-index={index}>
        <div className="min-w-0 flex-1">
          <p className="break-all font-mono text-[11px] text-ds-ink">{target.path}</p>
          <p className="mt-0.5 text-[11px] text-ds-faint">{t(target.exists ? 'agentIntegrations.configurationExists' : 'agentIntegrations.configurationMissing')}</p>
        </div>
        <button type="button" disabled={!target.exists || Boolean(opening)}
          aria-busy={opening === `configuration:${index}`} className={secondaryButton}
          data-agent-open-configuration={index} onClick={() => void open({ action: 'configuration', index }, t)}>
          <FolderOpen size={14} />
          {t(opening === `configuration:${index}` ? 'agentIntegrations.opening' : 'agentIntegrations.openConfiguration',
            { kind: t(target.kind === 'directory' ? 'agentIntegrations.directory' : 'agentIntegrations.file') })}
        </button>
      </li>)}
    </ul> : <p className="text-[12px] text-ds-faint">{t('agentIntegrations.configurationEmpty')}</p> : null}
    {openError ? <p role="alert" className="break-words text-[12px] text-ds-status-danger">{openError}</p> : null}
  </section>
}

export function AgentIntegrationDocs({ url, integration, missing, t }: {
  url?: string
  integration: ReturnType<typeof useAgentIntegration>
  missing?: boolean
  t: IntegrationT
}): ReactElement | null {
  return url ? <button type="button" className={secondaryButton} data-agent-integration-docs
    onClick={() => void integration.openDocs(url, t)}>
    <ExternalLink size={14} />{t(missing ? 'agentIntegrations.installInstructions' : 'agentIntegrations.documentation')}
  </button> : null
}
