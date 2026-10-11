import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, RefreshCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NormalizedThread } from '../../agent/types'
import type { AdeTaskSettingsMutation, AdeTaskSettingsResponse } from '@shared/ade-task-settings'
import { AdeProjectDefaultsFieldsSchema } from '@shared/ade-project-defaults'
import { getTaskSettings, saveTaskSettings } from '../../agent/kun-task-settings-client'
import { useChatStore } from '../../store/chat-store'
import { applySavedTaskRoute, captureTaskComposerSelection } from './task-settings-composer'
import { formatRuntimeError } from '../../lib/format-runtime-error'
import { TaskSettingsFields, TASK_SETTINGS_FIELDS, type TaskSettingsField } from './task-settings-fields'

type Draft = Required<Pick<AdeTaskSettingsMutation, 'expectedRevision' | 'set' | 'unset'>>
const drafts = new Map<string, Draft>()
const freshDraft = (revision: string): Draft => ({ expectedRevision: revision, set: {}, unset: [] })

export function TaskSettingsDrawer({ thread, onClose }: {
  thread: NormalizedThread
  onClose: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const labelId = useId()
  const panel = useRef<HTMLElement | null>(null)
  const generation = useRef(0)
  const [snapshot, setSnapshot] = useState<AdeTaskSettingsResponse | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(() => drafts.get(thread.id) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [leave, setLeave] = useState(false)
  const [saved, setSaved] = useState(false)
  const dirty = Boolean(loadedFor === thread.id && draft && (Object.keys(draft.set).length || draft.unset.length))
  const closeRef = useRef(() => undefined as void)
  closeRef.current = () => {
    if (saving) return
    if (leave) { setLeave(false); panel.current?.focus(); return }
    if (dirty) setLeave(true)
    else onClose()
  }

  const load = useCallback(async (replaceDraft = false): Promise<void> => {
    const request = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const next = await getTaskSettings(thread.id)
      if (request !== generation.current) return
      const remembered = replaceDraft ? undefined : drafts.get(thread.id)
      setSnapshot(next)
      setLoadedFor(thread.id)
      setDraft(remembered ?? freshDraft(next.revision))
      setConflict(Boolean(remembered && remembered.expectedRevision !== next.revision))
      setUnsupported(false)
      if (replaceDraft) drafts.delete(thread.id)
    } catch (cause) {
      if (request !== generation.current) return
      const status = (cause as { status?: number }).status
      setUnsupported(status === 404 || status === 501)
      setError(status === 404 || status === 501 ? null : formatRuntimeError(cause))
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [thread.id])

  useEffect(() => {
    void load()
    return () => { generation.current += 1 }
  }, [load])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab' || !panel.current) return
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')]
        .filter((element) => !element.closest('fieldset[disabled]'))
      const first = focusable[0], last = focusable.at(-1)
      if (!first || !last) { event.preventDefault(); panel.current.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  useEffect(() => {
    if (leave) panel.current?.querySelector<HTMLButtonElement>('[data-task-keep-editing]')?.focus()
  }, [leave])

  const changeDraft = (next: Draft): void => {
    drafts.set(thread.id, next)
    setDraft(next)
    setSaved(false)
    setError(null)
  }
  const save = async (closeAfter = false): Promise<void> => {
    if (!draft || !dirty || saving) return
    const checked = AdeProjectDefaultsFieldsSchema.safeParse(draft.set)
    if (!checked.success) { setError(t('taskSettings.invalid')); return }
    const request = generation.current
    const composerBefore = captureTaskComposerSelection()
    const routeChanged = draft.set.route !== undefined || draft.unset.includes('route')
    setSaving(true)
    setError(null)
    try {
      const next = await saveTaskSettings(thread.id, {
        expectedRevision: draft.expectedRevision,
        ...(Object.keys(draft.set).length ? { set: draft.set } : {}),
        ...(draft.unset.length ? { unset: draft.unset } : {})
      })
      drafts.delete(thread.id)
      if (routeChanged) applySavedTaskRoute(thread.id, composerBefore, next)
      if (request !== generation.current) return
      setSnapshot(next)
      setLoadedFor(thread.id)
      setDraft(freshDraft(next.revision))
      setConflict(false)
      setLeave(false)
      setSaved(true)
      void useChatStore.getState().refreshThreads()
      if (closeAfter) onClose()
    } catch (cause) {
      if (request !== generation.current) return
      const stale = (cause as { status?: number }).status === 409
      setConflict(stale)
      setError(stale ? t('taskSettings.conflict') : formatRuntimeError(cause))
    } finally {
      if (request === generation.current) setSaving(false)
    }
  }

  if (typeof document === 'undefined') return null
  const scopedSnapshot = loadedFor === thread.id ? snapshot : null
  const selected = scopedSnapshot?.pending ?? scopedSnapshot?.current
  const restored = new Set(draft?.unset ?? [])
  const effective = selected && scopedSnapshot ? {
    ...selected,
    ...Object.fromEntries(TASK_SETTINGS_FIELDS.filter((field) => restored.has(field)).map((field) => [field, scopedSnapshot.inherited[field]]))
  } : undefined
  const readOnly = typeof window !== 'undefined' && window.kunGui?.isRemoteWeb === true

  return createPortal(
    <div className="ds-no-drag fixed inset-0 z-[110] flex justify-end bg-black/25" onPointerDown={(event) => {
      if (event.target === event.currentTarget) closeRef.current()
    }}>
      <aside ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={labelId}
        className="flex h-full w-full max-w-[440px] min-w-0 flex-col border-l border-ds-border bg-ds-main shadow-2xl outline-none">
        <header className="flex shrink-0 items-start gap-3 border-b border-ds-border-muted p-4">
          <div className="min-w-0 flex-1">
            <h2 id={labelId} className="text-[15px] font-semibold text-ds-ink">{t('taskSettings.title')}</h2>
            <p className="mt-1 truncate text-[12px] text-ds-muted" title={thread.title}>{thread.title}</p>
          </div>
          <button type="button" disabled={saving} onClick={() => closeRef.current()} aria-label={t('close')}
            className="rounded-lg p-1.5 text-ds-muted hover:bg-ds-hover disabled:opacity-50"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <p className="text-[12px] leading-5 text-ds-muted">{t('taskSettings.scopeHint')}</p>
          <div className="rounded-xl border border-ds-border-muted px-3 py-2">
            <div className="text-[11px] font-medium text-ds-muted">{t('taskSettings.workspace')}</div>
            <div className="mt-1 break-all text-[12px] text-ds-ink">{thread.workspace || '—'}</div>
            <p className="mt-1 text-[11px] text-ds-faint">{t('taskSettings.workspaceReadOnly')}</p>
          </div>
          {loading ? <p role="status" className="flex items-center gap-2 text-xs text-ds-muted"><Loader2 className="h-4 w-4 animate-spin" />{t('workersLoading')}</p> : null}
          {error ? <p role="alert" className="break-words text-xs text-red-600 dark:text-red-300">{error}</p> : null}
          {unsupported ? <div className="space-y-2 text-[12px] text-ds-muted">
            <p>{t('taskSettings.unsupported')}</p><p>{thread.harnessId || 'Kun'} · {thread.model}</p>
          </div> : null}
          {conflict ? <div className="rounded-lg bg-amber-500/10 p-3 text-[12px] text-amber-700 dark:text-amber-300">
            <p>{t('taskSettings.conflict')}</p>
            <button type="button" disabled={saving} className="mt-2 underline" onClick={() => void load(true)}>{t('taskSettings.reload')}</button>
          </div> : null}
          {scopedSnapshot?.pending ? <div className="rounded-lg bg-accent/10 px-3 py-2 text-[12px] text-accent">
            <p>{t('taskSettings.pending')}</p>
            <p className="mt-1 truncate text-[11px]">{t('taskSettings.currentRoute')}: {scopedSnapshot.current.route.harnessId || 'Kun'} · {scopedSnapshot.current.route.model}</p>
          </div> : null}
          {effective && draft ? <TaskSettingsFields value={draft.set} effective={effective} restored={restored}
            editable={scopedSnapshot?.editable} disabled={saving || readOnly || conflict} onChange={(field, value) => {
              changeDraft({ ...draft, set: { ...draft.set, [field]: value }, unset: draft.unset.filter((entry) => entry !== field) })
            }} onRestore={(field: TaskSettingsField) => {
              const set = { ...draft.set }; delete set[field]
              changeDraft({ ...draft, set, unset: [...new Set([...draft.unset, field])] })
            }} /> : null}
          {readOnly ? <p className="text-xs text-ds-muted">{t('taskSettings.readOnly')}</p> : null}
        </div>
        <footer className="shrink-0 space-y-3 border-t border-ds-border-muted p-4">
          {leave ? <div role="alert" className="space-y-2 text-[12px] text-ds-ink">
            <p>{t('taskSettings.leave')}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" data-task-keep-editing disabled={saving} className="rounded-lg border border-ds-border px-3 py-2" onClick={() => { setLeave(false); panel.current?.focus() }}>{t('taskSettings.keep')}</button>
              <button type="button" disabled={saving} className="rounded-lg border border-ds-border px-3 py-2" onClick={() => { drafts.delete(thread.id); onClose() }}>{t('taskSettings.discard')}</button>
              <button type="button" disabled={saving || conflict || readOnly} className="rounded-lg bg-accent px-3 py-2 text-white disabled:opacity-50" onClick={() => void save(true)}>{t('taskSettings.saveClose')}</button>
            </div>
          </div> : <div className="flex items-center justify-between gap-2">
            <span role="status" className="text-[11px] text-ds-muted">{saved ? t('taskSettings.saved') : dirty ? t('taskSettings.unsaved') : t('taskSettings.taskOnly')}</span>
            <div className="flex items-center gap-2">
              {!dirty ? <button type="button" disabled={loading || saving} onClick={() => void load()} aria-label={t('reviewRefresh')}
                className="rounded-lg p-2 text-ds-muted hover:bg-ds-hover"><RefreshCw className="h-4 w-4" /></button> : null}
              <button type="button" disabled={!dirty || saving || conflict || readOnly} onClick={() => void save()}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[12px] font-medium text-white disabled:opacity-40">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{t('taskSettings.save')}
              </button>
            </div>
          </div>}
        </footer>
      </aside>
    </div>, document.body
  )
}
