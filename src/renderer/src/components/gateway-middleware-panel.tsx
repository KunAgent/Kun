import type { TFunction } from 'i18next'
import { Layers, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { ModelProviderSettingsV1 } from '@shared/app-settings'
import type { GatewayMiddlewareConfig, GatewayMiddlewareStats } from '../../../../kun/src/contracts/gateway-middleware.js'
import { settingsButtonClass } from './settings-button'
import { Toggle } from './settings-controls'

type MiddlewareType = GatewayMiddlewareConfig['type']

const inputClass = 'w-full min-w-0 rounded-lg border border-ds-border bg-ds-main px-2.5 py-1.5 text-[12px] text-ds-ink'

function newEntry(type: MiddlewareType): GatewayMiddlewareConfig {
  const id = `${type}-${Date.now().toString(36)}`
  switch (type) {
    case 'model-map': return { id, enabled: true, type, mapping: {} }
    case 'system-prompt': return { id, enabled: true, type, text: 'Answer concisely.', position: 'append' }
    case 'think-tags': return { id, enabled: true, type, mode: 'reasoning' }
    case 'script': return { id, enabled: true, type, file: 'my-middleware.js' }
  }
}

function mappingText(mapping: Record<string, string>): string {
  return Object.entries(mapping).map(([from, to]) => `${from} = ${to}`).join('\n')
}

function parseMapping(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const [from, ...rest] = line.split('=')
    const to = rest.join('=').trim()
    if (from?.trim() && to) out[from.trim()] = to
  }
  return out
}

function EntryFields({ entry, t, update }: { entry: GatewayMiddlewareConfig; t: TFunction; update: (next: GatewayMiddlewareConfig) => void }): ReactElement {
  if (entry.type === 'model-map') {
    return <label className="grid gap-1 text-[11px] text-ds-muted">{t('gatewayMiddleware.mapping')}
      <textarea rows={3} defaultValue={mappingText(entry.mapping)} placeholder="fast = deepseek/deepseek-v4-flash" spellCheck={false}
        onBlur={(event) => update({ ...entry, mapping: parseMapping(event.target.value) })} className={`${inputClass} font-mono`} />
      <span className="text-ds-faint">{t('gatewayMiddleware.mappingHint')}</span>
    </label>
  }
  if (entry.type === 'system-prompt') {
    return <div className="grid gap-2">
      <textarea rows={3} defaultValue={entry.text} aria-label={t('gatewayMiddleware.promptText')}
        onBlur={(event) => event.target.value.trim() && update({ ...entry, text: event.target.value })} className={inputClass} />
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={entry.position} aria-label={t('gatewayMiddleware.position')} className={inputClass}
          onChange={(event) => update({ ...entry, position: event.target.value as typeof entry.position })}>
          {(['append', 'prepend', 'replace'] as const).map((position) => <option key={position} value={position}>{t(`gatewayMiddleware.positions.${position}`)}</option>)}
        </select>
        <input defaultValue={(entry.agents ?? []).join(', ')} placeholder={t('gatewayMiddleware.agentsPlaceholder')} aria-label={t('gatewayMiddleware.agents')}
          onBlur={(event) => {
            const agents = event.target.value.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
            update({ ...entry, ...(agents.length ? { agents } : { agents: undefined }) })
          }} className={inputClass} />
      </div>
    </div>
  }
  if (entry.type === 'think-tags') {
    return <select value={entry.mode} aria-label={t('gatewayMiddleware.thinkMode')} className={inputClass}
      onChange={(event) => update({ ...entry, mode: event.target.value as typeof entry.mode })}>
      <option value="reasoning">{t('gatewayMiddleware.thinkReasoning')}</option>
      <option value="strip">{t('gatewayMiddleware.thinkStrip')}</option>
    </select>
  }
  return <label className="grid gap-1 text-[11px] text-ds-muted">{t('gatewayMiddleware.scriptFile')}
    <input defaultValue={entry.file} spellCheck={false} className={`${inputClass} font-mono`}
      onBlur={(event) => /^[A-Za-z0-9._-]+\.js$/.test(event.target.value.trim()) && update({ ...entry, file: event.target.value.trim() })} />
    <span className="text-ds-faint">{t('gatewayMiddleware.scriptHint')}</span>
  </label>
}

/** Gateway middleware: ordered transforms on every external agent's requests and replies. */
export function GatewayMiddlewarePanel({ settings, onChange, active, t }: {
  settings: ModelProviderSettingsV1
  onChange: (next: ModelProviderSettingsV1) => void
  active: boolean
  t: TFunction
}): ReactElement {
  const entries = settings.localGateway.middleware ?? []
  const [stats, setStats] = useState<GatewayMiddlewareStats[]>([])
  const [adding, setAdding] = useState<MiddlewareType>('model-map')
  const save = (next: GatewayMiddlewareConfig[]): void => onChange({ ...settings, localGateway: { ...settings.localGateway, middleware: next } })
  const refresh = useCallback(async () => {
    try {
      const result = await window.kunGui.runtimeRequest('/v1/model-gateway/middleware', 'GET')
      if (result.ok) setStats((JSON.parse(result.body) as { middleware?: GatewayMiddlewareStats[] }).middleware ?? [])
    } catch { /* counters are informational */ }
  }, [])
  useEffect(() => { if (active) void refresh() }, [active, refresh])
  const move = (index: number, delta: number): void => {
    const next = [...entries]
    const [entry] = next.splice(index, 1)
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, entry!)
    save(next)
  }
  return <section className="grid min-w-0 gap-3 rounded-2xl border border-ds-border bg-ds-card p-4" data-gateway-middleware>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-ds-ink"><Layers className="h-4 w-4 text-accent" />{t('gatewayMiddleware.title')}</h3>
        <p className="mt-1 max-w-[46rem] text-[12px] leading-5 text-ds-muted">{t('gatewayMiddleware.description')}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <select value={adding} aria-label={t('gatewayMiddleware.type')} onChange={(event) => setAdding(event.target.value as MiddlewareType)}
          className="rounded-lg border border-ds-border bg-ds-main px-2 py-1.5 text-[12px] text-ds-ink">
          {(['model-map', 'system-prompt', 'think-tags', 'script'] as const).map((type) => <option key={type} value={type}>{t(`gatewayMiddleware.types.${type}`)}</option>)}
        </select>
        <button type="button" className={settingsButtonClass()} disabled={entries.length >= 32} onClick={() => save([...entries, newEntry(adding)])}>
          <Plus className="h-3.5 w-3.5" />{t('gatewayMiddleware.add')}</button>
        <button type="button" className={settingsButtonClass()} aria-label={t('gatewayMiddleware.refresh')} onClick={() => void refresh()}><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>
    </div>
    {!entries.length ? <p className="rounded-lg bg-ds-main px-3 py-2 text-[11.5px] text-ds-muted">{t('gatewayMiddleware.empty')}</p> : null}
    <ol className="grid gap-2">
      {entries.map((entry, index) => {
        const stat = stats.find((item) => item.id === entry.id)
        const update = (next: GatewayMiddlewareConfig): void => save(entries.map((item) => item.id === entry.id ? next : item))
        return <li key={entry.id} className="grid gap-2 rounded-xl border border-ds-border p-3" data-gateway-middleware-entry={entry.type}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-ds-main text-[10.5px] text-ds-muted">{index + 1}</span>
            <span className="text-[12.5px] font-medium text-ds-ink">{t(`gatewayMiddleware.types.${entry.type}`)}</span>
            <span className="flex-1 text-[10.5px] text-ds-faint">
              {stat ? t('gatewayMiddleware.stats', { calls: stat.calls, micros: Math.round(stat.averageMicros), failures: stat.failures }) : ''}
            </span>
            <button type="button" className={settingsButtonClass({ variant: 'ghost', size: 'icon' })} disabled={index === 0} aria-label={t('gatewayMiddleware.moveUp')} onClick={() => move(index, -1)}>↑</button>
            <button type="button" className={settingsButtonClass({ variant: 'ghost', size: 'icon' })} disabled={index === entries.length - 1} aria-label={t('gatewayMiddleware.moveDown')} onClick={() => move(index, 1)}>↓</button>
            <Toggle checked={entry.enabled} onChange={(enabled) => update({ ...entry, enabled })} ariaLabel={t('gatewayMiddleware.enabled')} />
            <button type="button" className={settingsButtonClass({ variant: 'danger-ghost', size: 'icon' })} aria-label={t('gatewayMiddleware.remove')}
              onClick={() => save(entries.filter((item) => item.id !== entry.id))}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
          <EntryFields entry={entry} t={t} update={update} />
          {stat?.loadError ? <p role="alert" className="text-[11px] text-red-600">{t('gatewayMiddleware.loadError', { error: stat.loadError })}</p> : null}
          {stat?.lastError ? <p className="text-[11px] text-amber-700 dark:text-amber-200">{t('gatewayMiddleware.lastError', { error: stat.lastError })}</p> : null}
        </li>
      })}
    </ol>
    <p className="text-[11px] leading-5 text-ds-faint">{t('gatewayMiddleware.boundaries')}</p>
  </section>
}
