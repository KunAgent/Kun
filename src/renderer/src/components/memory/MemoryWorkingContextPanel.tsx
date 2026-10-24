import { useEffect, useId, useRef, useState } from 'react'
import type { MemoryWorkingContextPreview } from '@shared/memory-working-context'
import { previewRuntimeMemoryContext } from '../../agent/kun-runtime-memory-context'
import { settingsButtonClass } from '../settings-button'
import { MemoryRelationAnnotations } from './MemoryRelationAnnotations'

export function MemoryWorkingContextPanel({ enabled, automaticEnabled, t }: {
  enabled: boolean
  automaticEnabled: boolean
  t: (key: string) => string
}) {
  const inputId = useId()
  const [workspace, setWorkspace] = useState('')
  const [query, setQuery] = useState('')
  const [snapshot, setPreview] = useState<{ value: MemoryWorkingContextPreview; automatic: boolean } | null>(null)
  const preview = enabled && snapshot?.automatic === automaticEnabled ? snapshot.value : null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const clear = () => {
    controller.current?.abort()
    controller.current = null
    setPreview(null); setBusy(false); setError(false)
  }
  useEffect(() => {
    controller.current?.abort()
    controller.current = null
    setPreview(null); setBusy(false); setError(false)
    return () => controller.current?.abort()
  }, [enabled, automaticEnabled])

  const run = async () => {
    if (!enabled || !workspace.trim() || !query.trim() || controller.current) return
    const pending = new AbortController()
    controller.current = pending
    setBusy(true); setPreview(null); setError(false)
    try {
      const result = await previewRuntimeMemoryContext({ query: query.trim(), workspace: workspace.trim() }, pending.signal)
      if (!pending.signal.aborted) setPreview({ value: result, automatic: automaticEnabled })
    } catch {
      if (!pending.signal.aborted) setError(true)
    } finally {
      if (controller.current === pending) controller.current = null
      if (!pending.signal.aborted) setBusy(false)
    }
  }
  const inputClass = 'w-full rounded-md border border-ds-border bg-ds-elevated px-3 py-2 text-[13px] text-ds-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ds-focus'
  return <section className="space-y-4" aria-busy={busy}>
    <p className="max-w-[72ch] text-[13px] leading-6 text-ds-muted">{t('memoryContextDescription')}</p>
    <p className="text-[12px] text-ds-muted">{t(automaticEnabled ? 'memoryContextAutomaticOn' : 'memoryContextAutomaticOff')}</p>
    {!enabled ? <p role="status" className="text-[13px] text-ds-muted">{t('memoryContextDisabled')}</p> : null}
    <label className="block space-y-2 text-[13px] text-ds-ink">
      <span id={`${inputId}-workspace`}>{t('memoryContextWorkspace')}</span>
      <input aria-labelledby={`${inputId}-workspace`} value={workspace} maxLength={4096} disabled={!enabled} className={inputClass}
        onChange={(event) => { clear(); setWorkspace(event.target.value) }} />
    </label>
    <label className="block space-y-2 text-[13px] text-ds-ink">
      <span id={`${inputId}-query`}>{t('memoryContextQuery')}</span>
      <textarea aria-labelledby={`${inputId}-query`} value={query} maxLength={2000} rows={3} disabled={!enabled} className={inputClass}
        onChange={(event) => { clear(); setQuery(event.target.value) }} />
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!enabled || !workspace.trim() || !query.trim() || busy}
        className={settingsButtonClass({ variant: 'primary' })} onClick={() => void run()}>{t('memoryContextPreview')}</button>
      {busy ? <button type="button" className={settingsButtonClass()} onClick={clear}>{t('memoryContextCancel')}</button> : null}
    </div>
    {busy ? <p role="status" className="text-[12px] text-ds-muted">{t('memoryContextLoading')}</p> : null}
    {error ? <p role="alert" className="text-[12px] text-ds-danger">{t('memoryContextError')}</p> : null}
    {preview ? <div className="space-y-4 border-t border-ds-border-muted pt-4" role="status">
      <p className="text-[12px] text-ds-muted">{t('memoryContextBudget')}: {preview.characterCount} / {preview.characterBudget}</p>
      {preview.relations.state === 'unavailable' ? <p className="text-[12px] text-ds-muted">{t('memoryContextFallback')}</p> : null}
      {!preview.memories.length ? <p className="text-[13px] text-ds-muted">{t('memoryContextEmpty')}</p> : null}
      <ol className="divide-y divide-ds-border-muted">
        {preview.memories.map((memory) => <li key={memory.id} className="space-y-2 py-3">
          <p className="break-all text-[12px] text-ds-muted">{memory.id} · r{memory.revision} · {t(`memoryScope_${memory.scope}`)}</p>
          <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-ds-ink">{memory.content}</p>
        </li>)}
      </ol>
      {!preview.relations.annotations.length && preview.memories.length
        ? <p className="text-[12px] text-ds-muted">{t('memoryContextNoRelations')}</p> : null}
      <MemoryRelationAnnotations annotations={preview.relations.annotations} />
      {preview.relations.omittedByBudget > 0
        ? <p className="text-[12px] text-ds-muted">{t('memoryContextOmitted')}: {preview.relations.omittedByBudget}</p> : null}
    </div> : null}
  </section>
}
