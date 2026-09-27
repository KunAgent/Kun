import {
  MODEL_ENDPOINT_FORMATS,
  type ModelEndpointFormat,
  type ModelProviderProfileV1,
  type ModelReasoningEffort,
  type ModelReasoningRequestProtocol
} from '@shared/app-settings'
import {
  X
} from 'lucide-react'
import {
  type Dispatch,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
  type SetStateAction
} from 'react'
import {
  CONTEXT_WINDOW_PRESETS,
  PROVIDER_MODEL_REASONING_PROTOCOLS,
  describeContextWindowTokens,
  sortReasoningEfforts,
  type ProviderModelForm,
  type ProviderModelFormError
} from './provider-model-editor'
import { AdvancedSettingsDisclosure } from './settings-controls'

import {
  ENDPOINT_FORMAT_LABEL_KEYS,
  MODEL_KIND_META,
  REASONING_EFFORT_LABEL_KEYS,
  REASONING_PROTOCOL_LABEL_KEYS,
  ToggleField,
  chipButtonClass,
  fieldLabelClass,
  formErrorMessage,
  textInputClass,
  type EditorState,
  type Translate
} from './settings-section-provider-models-support'

type ProviderModelEditorDialogView = {
  editor: EditorState | null
  closeEditor: () => void
  dialogRef: RefObject<HTMLElement | null>
  dialogTitleId: string
  handleDialogKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  t: Translate
  updateForm: (patch: Partial<ProviderModelForm>) => void
  selectControlClass: string
  setEditor: Dispatch<SetStateAction<EditorState | null>>
  parsedContextTokens: number | null
  parsedMaxOutputTokens: number | null
  reasoningEffortPool: ModelReasoningEffort[]
  effectiveForm: ProviderModelForm | null
  errors: ProviderModelFormError[]
  showNonTextWarning: boolean
  provider: ModelProviderProfileV1
  saveEditor: () => void
}

export function ProviderModelEditorDialog({ view }: { view: ProviderModelEditorDialogView }): ReactElement {
  const { editor, closeEditor, dialogRef, dialogTitleId, handleDialogKeyDown, t, updateForm, selectControlClass, setEditor, parsedContextTokens, parsedMaxOutputTokens, reasoningEffortPool, effectiveForm, errors, showNonTextWarning, provider, saveEditor } = view
  return (
    <>
      {editor ? (
        <div
          className="ds-no-drag fixed inset-0 z-50 grid place-items-center overscroll-none bg-slate-950/40 p-4 backdrop-blur-md dark:bg-black/65"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor()
          }}
        >
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            onKeyDown={handleDialogKeyDown}
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-panel"
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-ds-border px-5 py-4">
              <h2 id={dialogTitleId} className="min-w-0 break-words text-[15px] font-semibold text-ds-ink">
                {editor.mode === 'add'
                  ? t('providerModelAddTitle')
                  : t('providerModelEditTitle', { model: editor.form.originalModelId })}
              </h2>
              <button
                type="button"
                aria-label={t('providerModelCancel')}
                onClick={closeEditor}
                className="shrink-0 rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </header>

            <div className="grid min-h-0 flex-1 gap-3 overscroll-contain overflow-y-auto px-5 py-4">
              {editor.mode === 'add' ? (
                <div className="grid gap-2">
                  <span className="text-[12px] font-semibold text-ds-muted">{t('providerModelKindLabel')}</span>
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {MODEL_KIND_META.map(({ kind, icon: Icon, titleKey, descKey }) => {
                      const selected = editor.form.kind === kind
                      return (
                        <button
                          key={kind}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => updateForm({ kind })}
                          className={`grid gap-1 rounded-xl border px-3 py-2.5 text-left transition ${
                            selected
                              ? 'border-accent/60 bg-ds-main/45 ring-1 ring-accent/30'
                              : 'border-ds-border bg-ds-card hover:bg-ds-hover'
                          }`}
                        >
                          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ds-ink">
                            <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                            {t(titleKey)}
                          </span>
                          <span className="text-[11.5px] leading-4 text-ds-faint">{t(descKey)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              <label className={fieldLabelClass}>
                {t('providerModelIdLabel')}
                <input
                  data-model-editor-initial-focus="true"
                  className={`${textInputClass} font-mono text-[13px]`}
                  value={editor.form.modelId}
                  placeholder={t('providerModelIdPlaceholder')}
                  spellCheck={false}
                  onChange={(e) => updateForm({ modelId: e.target.value })}
                />
                <span className="text-[12px] font-normal leading-5 text-ds-faint">{t('providerModelIdHint')}</span>
                {showNonTextWarning ? (
                  <span className="text-[12px] font-normal leading-5 text-amber-600 dark:text-amber-300">
                    {t('providerModelNonTextWarning')}
                  </span>
                ) : null}
              </label>

              {editor.form.kind === 'chat' ? (
                <>
                  <div className="grid gap-2 md:grid-cols-2">
                    <ToggleField
                      label={t('providerModelVisionLabel')}
                      description={t('providerModelVisionDesc')}
                      checked={editor.form.visionInput}
                      onChange={(value) => updateForm({ visionInput: value })}
                    />
                    <ToggleField
                      label={t('providerModelToolsLabel')}
                      description={t('providerModelToolsDesc')}
                      checked={editor.form.supportsToolCalling}
                      onChange={(value) => updateForm({ supportsToolCalling: value })}
                    />
                  </div>
                  <ToggleField
                    label={t('providerModelReasoningLabel')}
                    description={t('providerModelReasoningDesc')}
                    checked={editor.form.reasoningEnabled}
                    onChange={(value) => updateForm({ reasoningEnabled: value })}
                  />

                  <AdvancedSettingsDisclosure
                    title={t('providerModelAdvancedTitle')}
                    description={t('providerModelAdvancedDesc')}
                    contentClassName="max-h-[min(48dvh,480px)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
                  >
                    <div className="grid gap-3 px-3 py-3">
                      <div className="grid gap-1.5">
                        <span className="text-[12px] font-semibold text-ds-muted">{t('providerModelContextLabel')}</span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {CONTEXT_WINDOW_PRESETS.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setEditor((prev) =>
                                prev ? { ...prev, contextText: describeContextWindowTokens(preset) } : prev
                              )}
                              className={chipButtonClass(parsedContextTokens === preset)}
                            >
                              {describeContextWindowTokens(preset)}
                            </button>
                          ))}
                          <input
                            className="w-36 min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-1.5 font-mono text-[12.5px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={editor.contextText}
                            placeholder={t('providerModelContextPlaceholder')}
                            spellCheck={false}
                            onChange={(e) => {
                              const value = e.target.value
                              setEditor((prev) => prev ? { ...prev, contextText: value } : prev)
                            }}
                          />
                          {parsedContextTokens ? (
                            <span className="text-[12px] text-ds-faint">
                              {t('providerModelContextParsed', { tokens: parsedContextTokens.toLocaleString() })}
                            </span>
                          ) : null}
                        </div>
                        <span className="text-[12px] leading-5 text-ds-faint">{t('providerModelContextHint')}</span>
                      </div>

                      <label className={fieldLabelClass}>
                        {t('providerModelMaxOutputLabel')}
                        <input
                          className="w-36 min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-1.5 font-mono text-[12.5px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          value={editor.maxOutputText}
                          placeholder={t('providerModelMaxOutputPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => {
                            const value = e.target.value
                            setEditor((prev) => prev ? { ...prev, maxOutputText: value } : prev)
                          }}
                        />
                        {parsedMaxOutputTokens ? (
                          <span className="text-[12px] font-normal leading-5 text-ds-faint">
                            {t('providerModelMaxOutputParsed', { tokens: parsedMaxOutputTokens.toLocaleString() })}
                          </span>
                        ) : null}
                        <span className="text-[12px] font-normal leading-5 text-ds-faint">
                          {t('providerModelMaxOutputHint')}
                        </span>
                      </label>

                      <div className="grid gap-1.5">
                        <span className="text-[12px] font-semibold text-ds-muted">
                          {t('providerModelPricingLabel')}
                        </span>
                        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
                          {([
                            ['pricingInputText', 'providerModelPricingInput'],
                            ['pricingOutputText', 'providerModelPricingOutput'],
                            ['pricingCacheReadText', 'providerModelPricingCacheRead'],
                            ['pricingCacheWriteText', 'providerModelPricingCacheWrite']
                          ] as const).map(([field, labelKey]) => (
                            <label key={field} className={fieldLabelClass}>
                              {t(labelKey)}
                              <input
                                className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-1.5 font-mono text-[12.5px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                                value={editor[field]}
                                placeholder={t('providerModelPricingPlaceholder')}
                                inputMode="decimal"
                                spellCheck={false}
                                onChange={(e) => {
                                  const value = e.target.value
                                  setEditor((prev) => prev ? { ...prev, [field]: value } : prev)
                                }}
                              />
                            </label>
                          ))}
                        </div>
                        <span className="text-[12px] leading-5 text-ds-faint">
                          {t('providerModelPricingHint')}
                        </span>
                      </div>

                      {editor.form.reasoningEnabled ? (
                        <div className="grid gap-3 rounded-xl border border-ds-border-muted bg-ds-card/60 p-3">
                          <div className="grid gap-1.5">
                            <span className="text-[12px] font-semibold text-ds-muted">
                              {t('providerModelReasoningEfforts')}
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {reasoningEffortPool.map((effort) => {
                                const selected = editor.form.reasoningEfforts.includes(effort)
                                return (
                                  <button
                                    key={effort}
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() => updateForm({
                                      reasoningEfforts: selected
                                        ? editor.form.reasoningEfforts.filter((item) => item !== effort)
                                        : sortReasoningEfforts([...editor.form.reasoningEfforts, effort])
                                    })}
                                    className={chipButtonClass(selected)}
                                  >
                                    {t(REASONING_EFFORT_LABEL_KEYS[effort])}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className={fieldLabelClass}>
                              {t('providerModelReasoningDefault')}
                              <select
                                className={selectControlClass}
                                value={editor.form.reasoningDefaultEffort}
                                onChange={(e) => updateForm({
                                  reasoningDefaultEffort: e.target.value as ModelReasoningEffort
                                })}
                              >
                                {(editor.form.reasoningEfforts.length > 0
                                  ? sortReasoningEfforts(editor.form.reasoningEfforts)
                                  : reasoningEffortPool
                                ).map((effort) => (
                                  <option key={effort} value={effort}>
                                    {t(REASONING_EFFORT_LABEL_KEYS[effort])}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className={fieldLabelClass}>
                              {t('providerModelReasoningProtocol')}
                              <select
                                className={selectControlClass}
                                value={editor.form.reasoningProtocol}
                                onChange={(e) => updateForm({
                                  reasoningProtocol: e.target.value as ModelReasoningRequestProtocol
                                })}
                              >
                                {PROVIDER_MODEL_REASONING_PROTOCOLS.map((protocol) => (
                                  <option key={protocol} value={protocol}>
                                    {t(REASONING_PROTOCOL_LABEL_KEYS[protocol])}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <span className="text-[12px] leading-5 text-ds-faint">
                            {t('providerModelReasoningProtocolHint')}
                          </span>
                        </div>
                      ) : null}

                      <label className={fieldLabelClass}>
                        {t('providerModelEndpointFormatLabel')}
                        <select
                          className={selectControlClass}
                          value={editor.form.endpointFormat ?? ''}
                          onChange={(e) => updateForm({
                            endpointFormat: e.target.value === ''
                              ? null
                              : e.target.value as ModelEndpointFormat
                          })}
                        >
                          <option value="">
                            {t('providerModelEndpointInherit', {
                              format: t(ENDPOINT_FORMAT_LABEL_KEYS[provider.endpointFormat])
                            })}
                          </option>
                          {MODEL_ENDPOINT_FORMATS.map((format) => (
                            <option key={format} value={format}>
                              {t(ENDPOINT_FORMAT_LABEL_KEYS[format])}
                            </option>
                          ))}
                        </select>
                        <span className="text-[12px] font-normal leading-5 text-ds-faint">
                          {t('providerModelEndpointFormatHint')}
                        </span>
                      </label>

                      <label className={fieldLabelClass}>
                        {t('providerModelAliasesLabel')}
                        <input
                          className={`${textInputClass} font-mono text-[13px]`}
                          value={editor.aliasesText}
                          placeholder={t('providerModelAliasesPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => {
                            const value = e.target.value
                            setEditor((prev) => prev ? { ...prev, aliasesText: value } : prev)
                          }}
                        />
                        <span className="text-[12px] font-normal leading-5 text-ds-faint">
                          {t('providerModelAliasesHint')}
                        </span>
                      </label>
                    </div>
                  </AdvancedSettingsDisclosure>
                </>
              ) : null}

              {errors.length > 0 && editor.form.modelId.trim() !== '' ? (
                <div className="grid gap-1" role="alert">
                  {errors.map((error) => (
                    <span key={error.code} className="text-[12px] text-red-600 dark:text-red-300">
                      {formErrorMessage(t, error)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-ds-border px-5 py-3">
              <button
                type="button"
                onClick={closeEditor}
                className="inline-flex h-9 items-center rounded-full border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
              >
                {t('providerModelCancel')}
              </button>
              <button
                type="button"
                disabled={errors.length > 0}
                onClick={saveEditor}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('providerModelSave')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  )
}
