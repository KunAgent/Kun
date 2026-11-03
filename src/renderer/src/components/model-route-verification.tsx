import type { TFunction } from 'i18next'
import { Activity, Loader2, Play } from 'lucide-react'
import type { ReactElement } from 'react'
import type { ModelRoutePoolV1 } from '@shared/app-settings'
import { ProviderRoutePreview } from './provider-route-preview'
import { settingsButtonClass } from './settings-button'
import { attemptStatusLabel, formatTarget, testProgress, testStatusClass, testStatusLabel } from './settings-section-model-routes-support'
import type { RoutePoolTestRecord, RouteStatus } from './settings-section-model-routes'

type RouteEvent = NonNullable<RouteStatus['events']>[number]

function Table({ title, head, children, empty }: { title: string; head: string[]; children: ReactElement[]; empty?: string }): ReactElement {
  return <div className="overflow-hidden rounded-xl border border-ds-border">
    <div className="bg-ds-main px-3 py-2 text-[11px] font-medium text-ds-muted">{title}</div>
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full text-left text-[11.5px]">
        <thead className="text-ds-faint"><tr>{head.map((label) => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
    {!children.length && empty ? <div className="px-3 py-6 text-center text-[11px] text-ds-faint">{empty}</div> : null}
  </div>
}

/**
 * Proving a routed model works end to end: a runtime-owned test that walks
 * its targets in order, its progress and answer, and the latest route events.
 */
export function ModelRouteVerification({ t, locale, pool, statusLoaded, runtimeReady, startPending, startError, buttonLabel, blockedReason, tests, events, onRun }: {
  t: TFunction
  locale?: string
  pool: ModelRoutePoolV1
  statusLoaded: boolean
  runtimeReady: boolean
  startPending: boolean
  startError: string
  buttonLabel: string
  /** Why a test cannot start yet; empty when it can. */
  blockedReason: string
  tests: RoutePoolTestRecord[]
  events: RouteEvent[]
  onRun: () => void
}): ReactElement {
  const latest = tests[0]
  const running = latest?.status === 'queued' || latest?.status === 'running'
  return <section className="grid min-w-0 gap-3" data-model-route-verification>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h4 className="text-[13px] font-semibold text-ds-ink">{t('modelRoutes.routeValidation')}</h4>
        <p className="mt-0.5 text-[11.5px] leading-5 text-ds-faint">{t('modelRoutes.routeValidationDesc')}</p>
      </div>
      <button aria-busy={startPending || running} className={settingsButtonClass()} type="button"
        disabled={startPending || running || !runtimeReady} onClick={onRun}>
        {startPending || running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {buttonLabel}
      </button>
    </div>

    {startError ? <div className="rounded-lg bg-ds-danger-soft px-3 py-2 text-[12px] text-ds-status-danger">{startError}</div> : null}
    {blockedReason ? <div className="rounded-lg border border-ds-border-muted px-3 py-2 text-[11.5px] text-ds-status-warning">{blockedReason}</div> : null}

    <ProviderRoutePreview key={JSON.stringify(pool)} pool={pool} routeId={pool.id} disabled={!runtimeReady} translation={t} />
    {latest ? <div className="grid gap-3 rounded-xl border border-ds-border bg-ds-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : <Activity className="h-4 w-4 text-accent" />}
          <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${testStatusClass(latest.status)}`}>{testStatusLabel(latest.status, t)}</span>
          <span className="text-[11px] text-ds-faint">{new Date(latest.createdAt).toLocaleString(locale)}</span>
        </div>
        <span className="text-[11px] text-ds-muted">{t('modelRoutes.attemptedTargets', { attempted: latest.attemptedTargets, total: latest.totalTargets })}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ds-main">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${testProgress(latest)}%` }} />
      </div>
      {latest.currentTarget ? <p className="text-[12px] text-ds-muted">{t('modelRoutes.testingTarget', { target: formatTarget(latest.currentTarget) })}</p> : null}
      {latest.selectedTarget ? <p className="text-[12px] text-ds-status-success">{t('modelRoutes.finalTargetValue', { target: formatTarget(latest.selectedTarget) })}</p> : null}
      {latest.output ? <div className="rounded-lg bg-ds-main px-3 py-2 text-[12px] text-ds-muted">{t('modelRoutes.modelResponse', { response: latest.output })}</div> : null}
      {latest.error ? <div className="rounded-lg bg-ds-danger-soft px-3 py-2 text-[12px] text-ds-status-danger">{latest.error.message}{latest.error.category ? ` · ${latest.error.category}` : ''}</div> : null}
    </div> : statusLoaded ? <div className="rounded-xl border border-dashed border-ds-border px-3 py-6 text-center text-[11px] text-ds-faint">{t('modelRoutes.noTests')}</div> : null}

    {latest?.attempts.length ? <Table title={t('modelRoutes.currentTargetProgress')}
      head={[t('modelRoutes.order'), t('modelRoutes.target'), t('modelRoutes.status'), t('modelRoutes.latencyError')]}>
      {latest.attempts.map((attempt) => <tr key={`${latest.id}-${attempt.targetId}`} className="border-t border-ds-border-muted text-ds-muted">
        <td className="px-3 py-2">{attempt.index}</td>
        <td className="px-3 py-2">{attempt.providerId} / {attempt.modelId}</td>
        <td className="px-3 py-2">{attemptStatusLabel(attempt.status, t)}</td>
        <td className="max-w-[320px] truncate px-3 py-2" title={attempt.message}>{attempt.latencyMs === undefined ? '—' : `${attempt.latencyMs} ms`}{attempt.category ? ` · ${attempt.category}` : ''}{attempt.message ? ` · ${attempt.message}` : ''}</td>
      </tr>)}
    </Table> : null}

    {tests.length ? <Table title={t('modelRoutes.recentTests')}
      head={[t('modelRoutes.time'), t('modelRoutes.result'), t('modelRoutes.attempts'), t('modelRoutes.finalTarget')]}>
      {tests.slice(0, 5).map((test) => <tr key={test.id} className="border-t border-ds-border-muted text-ds-muted">
        <td className="px-3 py-2">{new Date(test.createdAt).toLocaleString(locale)}</td>
        <td className="px-3 py-2">{testStatusLabel(test.status, t)}</td>
        <td className="px-3 py-2">{test.attemptedTargets} / {test.totalTargets}</td>
        <td className="px-3 py-2">{test.selectedTarget ? formatTarget(test.selectedTarget) : '—'}</td>
      </tr>)}
    </Table> : null}

    <Table title={t('modelRoutes.recentEvents')} empty={t('modelRoutes.noEvents')}
      head={[t('modelRoutes.time'), t('modelRoutes.target'), t('modelRoutes.result'), t('modelRoutes.latency')]}>
      {events.map((event) => <tr key={`${event.at}-${event.targetId}-${event.result}`} className="border-t border-ds-border-muted text-ds-muted">
        <td className="px-3 py-2">{new Date(event.at).toLocaleTimeString(locale)}</td>
        <td className="px-3 py-2">{event.providerId} / {event.modelId}</td>
        <td className="px-3 py-2">{event.result}{event.category ? ` · ${event.category}` : ''}</td>
        <td className="px-3 py-2">{event.latencyMs} ms</td>
      </tr>)}
    </Table>
  </section>
}
