import { Fragment, useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import { Activity, Pause, Play, RefreshCw } from 'lucide-react'
import type { GatewayRouteTrace } from '../../../../kun/src/contracts/gateway-route-trace.js'
import { settingsButtonClass } from './settings-button'
import i18n from '../i18n'

const PATH = '/v1/model-gateway/route-traces'
const WAIT_SECONDS = 15
const SHOWN = 30

function clock(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Merges changed traces into the list by request id, newest first. */
export function mergeRouteTraces(current: GatewayRouteTrace[], changed: GatewayRouteTrace[]): GatewayRouteTrace[] {
  const byId = new Map(current.map((trace) => [trace.requestId, trace]))
  for (const trace of changed) byId.set(trace.requestId, trace)
  return [...byId.values()].sort((left, right) => right.seq - left.seq).slice(0, SHOWN)
}

function statusClass(trace: GatewayRouteTrace): string {
  if (!trace.done) return 'text-accent'
  return trace.status === 'completed' ? 'text-emerald-700 dark:text-emerald-200' : trace.status === 'failed' ? 'text-red-600' : 'text-ds-faint'
}

/**
 * Recent gateway requests from every caller: what was asked, what served it,
 * why, and each fallback. Long-polls only while the gateway page is visible.
 */
export function GatewayRouteTracePanel({ active, t }: { active: boolean; t: TFunction }): ReactElement {
  const [traces, setTraces] = useState<GatewayRouteTrace[]>([])
  const [paused, setPaused] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const fetchOnce = useCallback(async (wait: number, requestId?: string): Promise<boolean> => {
    let result: Awaited<ReturnType<typeof window.kunGui.runtimeRequest>>
    try {
      result = await window.kunGui.runtimeRequest(`${PATH}?after=${seq.current}${wait ? `&wait=${wait}` : ''}`, 'GET', undefined,
        requestId ? { requestId, priority: 'background' } : { priority: 'background' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
    if (!result.ok) { setError(`HTTP ${result.status}`); return false }
    const body = JSON.parse(result.body) as { seq?: number; traces?: GatewayRouteTrace[] }
    setError(null)
    // A runtime that restarted without its saved traces counts from zero again: start over.
    if (typeof body.seq === 'number' && body.seq < seq.current) {
      seq.current = 0
      setTraces([])
      return fetchOnce(0)
    }
    if (typeof body.seq === 'number') seq.current = body.seq
    if (body.traces?.length) setTraces((current) => mergeRouteTraces(current, body.traces!))
    return true
  }, [])
  useEffect(() => {
    if (!active || paused) return
    let stopped = false
    const requestId = `route-traces-${Math.random().toString(36).slice(2)}`
    void (async () => {
      await fetchOnce(0)
      while (!stopped) {
        const started = Date.now()
        let ok = false
        ok = await fetchOnce(WAIT_SECONDS, requestId)
        // Back off after failures, and never poll faster than once a second even if the runtime answers at once.
        const pause = !ok ? 5_000 : Math.max(0, 1_000 - (Date.now() - started))
        if (pause && !stopped) await new Promise((resolve) => setTimeout(resolve, pause))
      }
    })()
    return () => {
      stopped = true
      void window.kunGui.cancelRuntimeRequest?.(requestId)
    }
  }, [active, paused, fetchOnce])
  const why = (trace: GatewayRouteTrace): string => {
    if (!trace.decision) return '—'
    const label = t(`gatewayRoutes.decisions.${trace.decision}`, { defaultValue: trace.decision })
    return trace.rule ? `${label} · ${trace.rule}` : trace.intent ? `${label} · ${trace.intent}` : label
  }
  return <section className="grid min-w-0 gap-3 rounded-2xl border border-ds-border bg-ds-card p-4" data-gateway-route-traces>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-ds-ink"><Activity className="h-4 w-4 text-accent" />{t('gatewayRoutes.title')}</h3>
        <p className="mt-1 max-w-[46rem] text-[12px] leading-5 text-ds-muted">{t('gatewayRoutes.description')}</p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button type="button" className={settingsButtonClass()} onClick={() => setPaused((value) => !value)}
          aria-label={t(paused ? 'gatewayRoutes.resume' : 'gatewayRoutes.pause')}>
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}{t(paused ? 'gatewayRoutes.resume' : 'gatewayRoutes.pause')}
        </button>
        <button type="button" className={settingsButtonClass()} aria-label={t('gatewayRoutes.refresh')} onClick={() => void fetchOnce(0)}>
          <RefreshCw className="h-3.5 w-3.5" /></button>
      </div>
    </div>
    {error ? <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-700 dark:text-amber-200">
      {t('gatewayRoutes.loadFailed', { reason: error })}</p> : null}
    {!traces.length ? <p className="rounded-lg bg-ds-main px-3 py-2 text-[11.5px] text-ds-muted">{t('gatewayRoutes.empty')}</p> :
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-left text-[11.5px]">
          <thead className="text-[10.5px] uppercase tracking-wide text-ds-faint">
            <tr>{['time', 'caller', 'asked', 'served', 'why', 'result'].map((key) => <th key={key} className="px-2 py-1 font-medium">{t(`gatewayRoutes.${key}`)}</th>)}</tr>
          </thead>
          <tbody>
            {traces.map((trace) => <Fragment key={trace.requestId}>
              <tr className="cursor-pointer border-t border-ds-border-muted hover:bg-ds-hover" onClick={() => setOpen(open === trace.requestId ? null : trace.requestId)}
                aria-expanded={open === trace.requestId}>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-ds-faint">{clock(trace.startedAt)}</td>
                <td className="max-w-[10rem] truncate px-2 py-1.5 text-ds-ink" title={trace.client}>{trace.agent ?? trace.client ?? '—'}</td>
                <td className="max-w-[10rem] truncate px-2 py-1.5 font-mono text-ds-ink">{trace.asked}</td>
                <td className="max-w-[14rem] truncate px-2 py-1.5 font-mono text-ds-ink">{trace.served ?? trace.model ?? '—'}
                  {trace.tries.length > 1 ? <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">×{trace.tries.length}</span> : null}</td>
                <td className="max-w-[12rem] truncate px-2 py-1.5 text-ds-muted">{why(trace)}</td>
                <td className={`whitespace-nowrap px-2 py-1.5 ${statusClass(trace)}`}>
                  {trace.done ? t(`gatewayRoutes.status.${trace.status ?? 'completed'}`) : t('gatewayRoutes.running')}
                  {trace.durationMs !== undefined ? <span className="ml-1 text-ds-faint">{t('gatewayRoutes.duration', { ms: trace.durationMs })}</span> : null}
                </td>
              </tr>
              {open === trace.requestId ? <tr><td colSpan={6} className="bg-ds-main/60 px-3 py-2">
                <ol className="grid gap-1 text-[11px]">
                  {trace.tries.map((attempt, index) => <li key={index} className="flex flex-wrap items-center gap-2">
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-ds-card text-[9.5px] text-ds-muted">{index + 1}</span>
                    <span className="font-mono text-ds-ink">{attempt.providerId}/{attempt.modelId}</span>
                    {attempt.decision ? <span className="text-ds-faint">{t(`gatewayRoutes.decisions.${attempt.decision}`, { defaultValue: attempt.decision })}</span> : null}
                    {attempt.fail ? <span className="text-red-600">{t('gatewayRoutes.triedFailed', { model: attempt.modelId, reason: attempt.fail })}</span> : null}
                  </li>)}
                  {trace.firstTokenMs !== undefined ? <li className="text-ds-faint">{t('gatewayRoutes.firstToken', { ms: trace.firstTokenMs })}</li> : null}
                </ol>
              </td></tr> : null}
            </Fragment>)}
          </tbody>
        </table>
      </div>}
  </section>
}
