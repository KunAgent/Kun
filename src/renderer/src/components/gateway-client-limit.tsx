import { useEffect, useState, type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import type { GatewayClientLimit } from '@shared/gateway-clients'

function Bar({ used, total, tone }: { used: number; total: number; tone: 'ok' | 'warn' | 'full' }): ReactElement {
  const share = total > 0 ? Math.min(1, used / total) : 0
  const color = tone === 'full' ? 'bg-red-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-accent'
  return <span className="block h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-ds-main" role="presentation">
    <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.round(share * 100)}%` }} />
  </span>
}

const tone = (used: number, total: number): 'ok' | 'warn' | 'full' => total > 0 && used >= total ? 'full' : total > 0 && used / total >= 0.8 ? 'warn' : 'ok'

function time(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** One key's window usage, remaining allowance and reset time, read from the runtime. */
export function GatewayClientLimitBar({ clientId, active, t }: { clientId: string; active: boolean; t: TFunction }): ReactElement | null {
  const [limit, setLimit] = useState<GatewayClientLimit | null>(null)
  useEffect(() => {
    if (!active || typeof window.kunGui?.gatewayClients !== 'function') return
    let cancelled = false
    void window.kunGui.gatewayClients({ action: 'limit', clientId }).then((result) => {
      if (!cancelled && result.ok && result.limit) setLimit(result.limit)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [active, clientId])
  if (!limit) return null
  const period = (value: string): string => t(`gatewayLimits.periods.${value}`, { defaultValue: value })
  const tokens = limit.tokenBudget
  const cost = limit.cost
  return <div className="flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-ds-muted" data-gateway-client-limit={clientId}>
    {limit.limited ? <span className="rounded-full bg-red-50 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-500/10 dark:text-red-200">{t('gatewayLimits.limited')}</span> : null}
    {tokens ? <span className="flex min-w-0 items-center gap-1.5">
      <Bar used={tokens.used} total={tokens.tokens} tone={tone(tokens.used, tokens.tokens)} />
      {t('gatewayLimits.tokens', { used: tokens.used.toLocaleString(), total: tokens.tokens.toLocaleString(), period: period(tokens.period) })}
      <span className="text-ds-faint">· {t('gatewayLimits.resets', { time: time(tokens.resetsAt) })}</span>
    </span> : null}
    {cost ? <span className="flex min-w-0 items-center gap-1.5">
      <Bar used={cost.used} total={cost.usd} tone={tone(cost.used, cost.usd)} />
      {t('gatewayLimits.cost', { used: cost.used.toFixed(2), total: cost.usd.toFixed(2), period: period(cost.period) })}
      <span className="text-ds-faint">({t(cost.enforce ? 'gatewayLimits.costEnforced' : 'gatewayLimits.costAlert')})</span>
    </span> : null}
    {!tokens && !cost ? <span className="text-ds-faint">{t('gatewayLimits.noLimits')}</span> : null}
    {limit.rate ? <span className="text-ds-faint">{t('gatewayLimits.inFlight', { active: limit.rate.active, max: limit.rate.maxConcurrent })}</span> : null}
  </div>
}
