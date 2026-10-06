import type { ReactElement } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { AgentIcon } from '../agent-icon'
import { AgentIntegrationDocs, AgentIntegrationLocations, useAgentIntegration, type IntegrationT } from './AgentIntegrationLocations'
import { AgentApplicationPathSettings } from './AgentApplicationPathSettings'

export function AgentCenterApplicationCard({ row, settings, probing, onProbe, onSetBinaryPath, beforeSave, t }: {
  row: AdeHarnessRow
  settings: KunHarnessSettingsV1
  probing: boolean
  onProbe: () => void
  onSetBinaryPath: (path: string) => void
  beforeSave?: () => Promise<boolean>
  t: IntegrationT
}): ReactElement {
  const integration = useAgentIntegration(row)
  const { info, loading, opening, open } = integration
  const target = info?.application
  const installed = target ? target.exists : row.status.installed === 'yes'
  const checking = probing || row.status.detecting
  const missing = !installed && !checking && !loading && Boolean(info)
  const docsUrl = info?.docsUrl ?? row.definition.application?.configurationDocsUrl ?? row.definition.setup?.docsUrl
  const applicationPath = target?.path ?? row.status.applicationPath
  return <div data-agent-card={row.definition.id} data-agent-integration-kind="application" className="px-1 py-3">
    <div className="flex min-w-0 items-start gap-3">
      <AgentIcon harnessId={row.definition.id} size={20} className="mt-0.5 shrink-0 text-ds-muted" />
      <div className="min-w-0">
        <h2 className="break-words text-[13px] font-semibold text-ds-ink">{row.definition.displayName}</h2>
        <p role="status" aria-live="polite" className="mt-1 text-[12px] text-ds-muted">
          {t(checking ? 'agentIntegrations.detecting' : installed ? 'agentIntegrations.installed' : row.status.installed === 'unknown' && !target ? 'agentIntegrations.installUnknown' : 'agentIntegrations.notInstalled')}
        </p>
      </div>
    </div>
    <p className="mt-3 text-[12px] text-ds-muted">{t('agentIntegrations.applicationExplanation')}</p>
    {missing ? <p className="mt-2 text-[12px] text-ds-muted">{t('agentIntegrations.missingApplication')}</p> : null}
    {applicationPath ? <div className="mt-3 rounded-lg border border-ds-border-muted bg-ds-main/40 px-3 py-2">
      <p className="text-[11px] font-medium text-ds-muted">{t('agentIntegrations.applicationPath')}</p>
      <p className="mt-1 break-all font-mono text-[11px] text-ds-ink">{applicationPath}</p>
    </div> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" data-agent-open-application disabled={loading || !target?.exists || Boolean(opening) || checking}
        aria-busy={opening === 'application:'} onClick={() => void open({ action: 'application' }, t)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45">
        <ExternalLink size={14} />{t(opening === 'application:' ? 'agentIntegrations.opening' : 'agentIntegrations.openApplication')}
      </button>
      <AgentIntegrationDocs url={docsUrl} integration={integration} missing={missing} t={t} />
      <button type="button" disabled={checking} aria-busy={checking} onClick={() => { onProbe(); integration.reload() }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 py-1.5 text-[12px] text-ds-ink hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45">
        <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />{t('adeAgentAction.retry')}
      </button>
    </div>
    <AgentApplicationPathSettings harnessId={row.definition.id} settings={settings} onSetBinaryPath={onSetBinaryPath}
      beforeSave={beforeSave} onSaved={() => { integration.reload(); onProbe() }} t={t} />
    <AgentIntegrationLocations integration={integration} t={t} />
  </div>
}
