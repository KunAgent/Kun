import { ProviderModelEvidenceSummary } from './provider-model-evidence-summary'
import { settingsButtonClass } from './settings-button'
import {
  type ModelProviderProfileV1
} from '@shared/app-settings'
import {
  Brain,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Plus,
  Search,
  Trash2
} from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement
} from 'react'
import {
  PROVIDER_MODEL_REASONING_EFFORT_CHOICES,
  applyProviderModelForm,
  chatModelIdLooksNonText,
  chatModelProfile,
  describeContextWindowTokens,
  parseContextWindowInput,
  providerModelListEntries,
  removeProviderModel,
  sortReasoningEfforts,
  validateProviderModelForm,
  type ProviderModelForm,
  type ProviderModelKind
} from './provider-model-editor'
import { ProviderModelEditorDialog } from './settings-section-provider-models-dialog'
import {
  MODEL_LIST_PAGE_SIZE, ModelBadge, ModelName,
  editorStateForExisting,
  editorStateForNew,
  effectiveFormForEditor,
  modelEntryKey, modelKindLabelKey, type EditorState, type Translate
} from './settings-section-provider-models-support'

export function ProviderModelsManager({
  provider,
  t,
  selectControlClass,
  focusModelId,
  onChange
}: {
  provider: ModelProviderProfileV1
  t: Translate
  selectControlClass: string
  focusModelId?: string
  onChange: (next: ModelProviderProfileV1) => void
}): ReactElement {
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const dialogTitleId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)
  const editorOpenerRef = useRef<HTMLElement | null>(null)
  const editorOpen = editor !== null
  // Batch selection for bulk delete (#397). Survives search/page changes so a
  // user can search, select-all-visible, search again, select-all-visible, then
  // delete. Reset when the user navigates to a different provider.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!focusModelId || !provider.models.some((model) => model === focusModelId)) return
    setQuery(focusModelId)
    setPage(0)
  }, [focusModelId, provider.models])
  useEffect(() => {
    setSelected(new Set())
  }, [provider.id])

  useEffect(() => {
    if (!editorOpen || typeof document === 'undefined') return

    const opener = editorOpenerRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusInitialControl = (): void => {
      dialogRef.current
        ?.querySelector<HTMLElement>('[data-model-editor-initial-focus="true"]')
        ?.focus()
    }
    const frame = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(focusInitialControl)
      : null
    if (frame === null) focusInitialControl()

    return () => {
      if (frame !== null && typeof window !== 'undefined') window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      if (opener?.isConnected) opener.focus()
    }
  }, [editorOpen])

  const openEditor = (next: EditorState, opener: HTMLElement): void => {
    editorOpenerRef.current = opener
    setEditor(next)
  }

  const closeEditor = (): void => {
    setEditor(null)
  }

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeEditor()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current || typeof document === 'undefined') return

    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>([
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'a[href]',
      'summary'
    ].join(','))).filter((element) => element.getClientRects().length > 0)
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const updateForm = (patch: Partial<ProviderModelForm>): void => {
    setEditor((prev) => prev ? { ...prev, form: { ...prev.form, ...patch } } : prev)
  }

  const saveEditor = (): void => {
    if (!editor) return
    const form = effectiveFormForEditor(editor)
    if (validateProviderModelForm(form, provider).length > 0) return
    onChange(applyProviderModelForm(provider, form))
    closeEditor()
  }

  const deleteModel = (kind: ProviderModelKind, modelId: string): void => {
    onChange(removeProviderModel(provider, kind, modelId))
    setEditor((prev) =>
      prev?.mode === 'edit' && modelEntryKey(prev.form.kind, prev.form.originalModelId) === modelEntryKey(kind, modelId)
        ? null
        : prev
    )
    const key = modelEntryKey(kind, modelId)
    setSelected((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  const toggleSelected = (kind: ProviderModelKind, modelId: string): void => {
    const key = modelEntryKey(kind, modelId)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const modelEntries = providerModelListEntries(provider)
  // Search + pagination only kick in once a provider has more than one page of
  // models; smaller lists stay as a plain list (search box would just be noise).
  const showListTools = modelEntries.length > MODEL_LIST_PAGE_SIZE
  const normalizedQuery = query.trim().toLowerCase()
  const filteredEntries = showListTools && normalizedQuery
    ? modelEntries.filter(({ modelId }) => modelId.toLowerCase().includes(normalizedQuery))
    : modelEntries
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / MODEL_LIST_PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visibleEntries = showListTools
    ? filteredEntries.slice(safePage * MODEL_LIST_PAGE_SIZE, safePage * MODEL_LIST_PAGE_SIZE + MODEL_LIST_PAGE_SIZE)
    : filteredEntries
  const allVisibleSelected =
    visibleEntries.length > 0 &&
    visibleEntries.every(({ kind, modelId }) => selected.has(modelEntryKey(kind, modelId)))
  const selectVisible = (): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const { kind, modelId } of visibleEntries) next.add(modelEntryKey(kind, modelId))
      return next
    })
  }
  const clearVisible = (): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const { kind, modelId } of visibleEntries) next.delete(modelEntryKey(kind, modelId))
      return next
    })
  }
  const deleteSelected = (): void => {
    if (selected.size === 0) return
    let next = provider
    for (const { kind, modelId } of modelEntries) {
      if (selected.has(modelEntryKey(kind, modelId))) {
        next = removeProviderModel(next, kind, modelId)
      }
    }
    if (next !== provider) onChange(next)
    setSelected(new Set())
    setEditor((prev) =>
      prev?.mode === 'edit' &&
      selected.has(modelEntryKey(prev.form.kind, prev.form.originalModelId))
        ? null
        : prev
    )
  }
  const effectiveForm = editor ? effectiveFormForEditor(editor) : null
  const errors = editor && effectiveForm ? validateProviderModelForm(effectiveForm, provider) : []
  const showNonTextWarning = Boolean(effectiveForm && chatModelIdLooksNonText(effectiveForm))
  const parsedContextTokens =
    editor && editor.contextText.trim() !== '' ? parseContextWindowInput(editor.contextText) : null
  const parsedMaxOutputTokens =
    editor && editor.maxOutputText.trim() !== '' ? parseContextWindowInput(editor.maxOutputText) : null
  const editingKey = editor?.mode === 'edit' ? modelEntryKey(editor.form.kind, editor.form.originalModelId) : ''
  const reasoningEffortPool = effectiveForm
    ? sortReasoningEfforts([...PROVIDER_MODEL_REASONING_EFFORT_CHOICES, ...effectiveForm.reasoningEfforts])
    : PROVIDER_MODEL_REASONING_EFFORT_CHOICES

  return (
    <div className="grid gap-2.5">
      <p className="text-[12px] leading-5 text-ds-faint">{t('providerModelListDesc')}</p>
      {modelEntries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ds-border-muted px-3 py-3 text-[12.5px] text-ds-faint">
          {t('providerModelEmpty')}
        </p>
      ) : (
        <>
          {showListTools ? (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint"
                strokeWidth={1.9}
              />
              <input
                className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card py-2 pl-9 pr-3 text-[13px] font-normal text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                value={query}
                placeholder={t('providerModelSearchPlaceholder')}
                aria-label={t('providerModelSearchPlaceholder')}
                spellCheck={false}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(0)
                }}
              />
            </div>
          ) : null}
          {showListTools && visibleEntries.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <button className={settingsButtonClass()}
                  type="button"
                  onClick={allVisibleSelected ? clearVisible : selectVisible}
                >
                  {allVisibleSelected
                    ? t('providerModelBatchClearVisible')
                    : t('providerModelBatchSelectVisible', { count: visibleEntries.length })}
                </button>
                {selected.size > 0 ? (
                  <span className="text-[12px] text-ds-faint">
                    {t('providerModelBatchSelectedCount', { count: selected.size })}
                  </span>
                ) : null}
              </div>
              {selected.size > 0 ? (
                <button
                  type="button"
                  onClick={deleteSelected}
                  className={settingsButtonClass({ variant: 'danger' })}
                >
                  <Trash2 className="h-3 w-3" strokeWidth={2} />
                  {t('providerModelBatchDelete', { count: selected.size })}
                </button>
              ) : null}
            </div>
          ) : null}
          {filteredEntries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ds-border-muted px-3 py-3 text-[12.5px] text-ds-faint">
              {t('providerModelSearchEmpty', { query: query.trim() })}
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {visibleEntries.map(({ kind, modelId }) => {
                const profile = kind === 'chat' ? chatModelProfile(provider, modelId) : undefined
                const active = editingKey !== '' && editingKey === modelEntryKey(kind, modelId)
                const isSelected = selected.has(modelEntryKey(kind, modelId))
                return (
                  <li
                    key={modelEntryKey(kind, modelId)}
                    className={`flex items-start gap-2 rounded-xl border px-3 py-2 ${
                      active
                        ? 'border-accent/60 bg-ds-main/45 ring-1 ring-accent/30'
                        : isSelected
                          ? 'border-accent/40 bg-ds-main/35'
                          : 'border-ds-border bg-ds-card'
                    }`}
                  >
                    {showListTools ? (
                      <input
                        type="checkbox"
                        className="mt-1 h-3.5 w-3.5 shrink-0 accent-accent"
                        aria-label={t('providerModelBatchToggleRow', { model: modelId })}
                        checked={isSelected}
                        onChange={() => toggleSelected(kind, modelId)}
                      />
                    ) : null}
                    <span className="grid min-w-0 flex-1 gap-1.5">
                      <ModelName modelId={modelId} />
                      <span className="flex min-w-0 flex-wrap items-center gap-1">
                        <ModelBadge tone={kind === 'chat' ? 'faint' : 'muted'}>
                          {t(modelKindLabelKey(kind))}
                        </ModelBadge>
                        {kind === 'chat' && profile ? (
                          <>
                            {profile.contextWindowTokens ? (
                              <ModelBadge>{t('providerModelContextBadge', {
                                size: describeContextWindowTokens(profile.contextWindowTokens)
                              })}</ModelBadge>
                            ) : null}
                            {profile.maxOutputTokens ? (
                              <ModelBadge>{t('providerModelMaxOutputBadge', {
                                size: describeContextWindowTokens(profile.maxOutputTokens)
                              })}</ModelBadge>
                            ) : null}
                            {profile.inputModalities.includes('image') ? (
                              <ModelBadge icon={<Eye className="h-2.5 w-2.5" strokeWidth={1.9} />}>
                                {t('modelProviderVisionBadge')}
                              </ModelBadge>
                            ) : null}
                            {profile.reasoning ? (
                              <ModelBadge icon={<Brain className="h-2.5 w-2.5" strokeWidth={1.9} />}>
                                {t('providerModelReasoningBadge')}
                              </ModelBadge>
                            ) : null}
                            {!profile.supportsToolCalling ? (
                              <ModelBadge tone="warning">{t('providerModelNoToolsBadge')}</ModelBadge>
                            ) : null}
                          </>
                        ) : kind === 'chat' ? (
                          <ModelBadge tone="faint">{t('providerModelDefaultProfileBadge')}</ModelBadge>
                        ) : null}
                      </span>
                      {kind === 'chat' && profile ? <ProviderModelEvidenceSummary profile={profile} /> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 pt-0.5">
                      <button
                        type="button"
                        aria-label={t('providerModelEditAction', { model: modelId })}
                        onClick={(event) => openEditor(
                          editorStateForExisting(provider, kind, modelId),
                          event.currentTarget
                        )}
                        className={settingsButtonClass({ variant: 'ghost', size: 'icon' })}
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.9} />
                      </button>
                      <button
                        type="button"
                        aria-label={t('providerModelDeleteAction', { model: modelId })}
                        onClick={() => deleteModel(kind, modelId)}
                        className={settingsButtonClass({ variant: 'danger-ghost', size: 'icon' })}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {showListTools && filteredEntries.length > MODEL_LIST_PAGE_SIZE ? (
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="text-[12px] text-ds-faint">
                {t('providerModelPageCount', { shown: visibleEntries.length, total: filteredEntries.length })}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safePage === 0}
                  aria-label={t('providerModelPagePrev')}
                  onClick={() => setPage(Math.max(0, safePage - 1))}
                  className={settingsButtonClass({ variant: 'ghost', size: 'icon' })}
                >
                  <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
                <span className="px-1 text-[12px] tabular-nums text-ds-muted">
                  {t('providerModelPageIndicator', { page: safePage + 1, total: pageCount })}
                </span>
                <button
                  type="button"
                  disabled={safePage >= pageCount - 1}
                  aria-label={t('providerModelPageNext')}
                  onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                  className={settingsButtonClass({ variant: 'ghost', size: 'icon' })}
                >
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
      <button
        type="button"
        onClick={(event) => openEditor(editorStateForNew(provider), event.currentTarget)}
        className={settingsButtonClass({ className: 'w-fit' })}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
        {t('providerModelAdd')}
      </button>
      <button
        type="button"
        title={t('providerModelDefaultsHint')}
        onClick={(event) => openEditor(editorStateForExisting(provider, 'chat', '*'), event.currentTarget)}
        className={settingsButtonClass({ variant: 'ghost', className: 'w-fit' })}
      >
        {t(provider.modelProfiles['*'] ? 'providerModelDefaultsEdit' : 'providerModelDefaultsAdd')}
      </button>
      <ProviderModelEditorDialog view={{
        editor, closeEditor, dialogRef, dialogTitleId, handleDialogKeyDown, t, updateForm,
        selectControlClass, setEditor, parsedContextTokens, parsedMaxOutputTokens,
        reasoningEffortPool, effectiveForm, errors, showNonTextWarning, provider, saveEditor
      }} />
    </div>
  )
}
