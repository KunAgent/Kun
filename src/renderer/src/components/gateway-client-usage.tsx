import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { GatewayClientUsage as Usage } from '@shared/gateway-clients'

export function GatewayClientUsage({ usage, clientName }: { usage: Usage; clientName: string }): ReactElement {
  const { t } = useTranslation('settings')
  return <section className="grid min-w-0 grid-cols-1 gap-2 rounded-lg bg-ds-main p-3 text-[11px] text-ds-muted" data-gateway-client-usage>
    <h5 className="min-w-0 break-words font-semibold text-ds-ink">{t('gatewayConnection.usageTitle', { name: clientName })}</h5>
    <p>{t('gatewayConnection.usageTotals', { requests: usage.totalRequests, tokens: usage.totalTokens })}</p>
    {usage.budget ? <p>{t('providerConfiguration.budgetUsage', { ...usage.budget, limit: usage.budget.limit ?? '—' })}</p> : null}
    <p>{t('gatewayConnection.usageCostHint')}</p>
    <p>{t('gatewayConnection.usageSessionHint')}</p>
    <div className="max-h-64 min-w-0 max-w-full space-y-2 overflow-y-auto">
      {[...usage.requests].reverse().slice(0, 10).map((request, index) => <div key={`${request.timestamp}:${index}`} className="min-w-0 rounded-lg border border-ds-border p-2">
        <p>{request.timestamp ? new Date(request.timestamp).toLocaleString() : '—'} · {request.status ?? '—'} · {request.latencyMs ?? '—'} ms</p>
        <p className="break-all font-mono">{request.requestedModelId ?? '—'} → {request.actualProviderId ?? '—'} / {request.actualModelId ?? '—'}</p>
        <p>{request.tokenUsage === 'upstream' ? t('gatewayConnection.usageTokens', { input: request.promptTokens ?? '—', output: request.completionTokens ?? '—', cached: request.cacheHitTokens ?? '—' }) : t('gatewayConnection.usageUnavailable')}</p>
        <p>{t('gatewayConnection.usageRetries', { retries: request.retryCount ?? 0, failovers: request.failoverCount ?? 0 })}</p>
        {request.sessionId ? <p className="break-all font-mono">{t('gatewayConnection.session')}: {request.sessionId}</p> : null}
      </div>)}
      {!usage.requests.length ? <p>{t('gatewayConnection.noUsage')}</p> : null}
    </div>
  </section>
}
