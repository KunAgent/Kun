import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react'
import { Languages, Loader2, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WritePaperModeTranslateSettingsV1 } from '@shared/app-settings-types-paper-mode'
import { useChatStore } from '../../../store/chat-store'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { rendererRuntimeClient } from '../../../agent/runtime-client'
import { Toggle } from '../../settings-controls'

const fieldClass =
  'w-full min-w-0 rounded-lg border border-ds-border-muted bg-ds-main px-2.5 py-1.5 text-[13px] text-ds-ink outline-none focus:border-accent/50'
const linkButtonClass =
  'inline-flex items-center gap-1 rounded-full border border-ds-border-muted px-2.5 py-1 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink'

/**
 * In-reader translation settings dialog (§6.5): opened from a translate
 * card/notice when the request fails with a `config` error. Mirrors the
 * Write→Paper settings row (target language, inherit toggle, provider/model)
 * and persists via `setSettings` so the failed request can retry at once.
 * API keys still live under Providers settings — a link stays in the footer.
 */
export function PaperTranslateSettingsDialog({
  onClose,
  onSaved
}: {
  onClose: () => void
  /** Called after settings are saved so the reader can retry the request. */
  onSaved: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const initial = useMemo(() => useWriteWorkspaceStore.getState().paperMode.translate, [])
  const [targetLanguage, setTargetLanguage] = useState<
    WritePaperModeTranslateSettingsV1['targetLanguage']
  >(initial.targetLanguage)
  const [inheritModel, setInheritModel] = useState(initial.inheritModel !== false)
  const [providerId, setProviderId] = useState(initial.providerId)
  const [model, setModel] = useState(initial.model)
  const [busy, setBusy] = useState(false)

  const composerModel = useChatStore((s) => s.composerModel)
  const composerProviderId = useChatStore((s) => s.composerProviderId)
  const groups = useChatStore((s) => s.composerModelGroups)

  // Model groups load lazily for the composer — make sure they exist here.
  useEffect(() => {
    void useChatStore.getState().loadComposerModels()
  }, [])

  const providerOptions = useMemo(() => {
    const list = groups
      .filter((group) => !group.extensionProvider)
      .map((group) => ({ providerId: group.providerId, label: group.label }))
    const current = providerId.trim()
    if (current && !list.some((item) => item.providerId === current)) {
      list.unshift({ providerId: current, label: current })
    }
    return list
  }, [groups, providerId])

  const selectedGroup = groups.find((group) => group.providerId === providerId.trim())
  const modelOptions = useMemo(() => {
    const list = [...(selectedGroup?.modelIds ?? [])]
    const current = model.trim()
    if (current && !list.includes(current)) list.unshift(current)
    return list
  }, [selectedGroup, model])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    const next = {
      targetLanguage,
      inheritModel,
      providerId: providerId.trim(),
      model: model.trim()
    }
    try {
      useWriteWorkspaceStore.setState((state) => ({
        paperMode: { ...state.paperMode, translate: { ...state.paperMode.translate, ...next } }
      }))
      await rendererRuntimeClient
        .setSettings({ write: { paperMode: { translate: next } } })
        .catch(() => undefined)
      onSaved()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={() => {
        if (!busy) onClose()
      }}
    >
      <form
        role="dialog"
        aria-label={t('writePaperTranslateSettingsTitle')}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-sm rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)]"
      >
        <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-ds-ink">
          <Languages className="h-4 w-4 text-accent" strokeWidth={1.9} />
          {t('writePaperTranslateSettingsTitle')}
        </h2>

        <label className="mb-1 block text-[12px] font-medium text-ds-muted">
          {t('writePaperTranslateTarget')}
        </label>
        <select
          className={fieldClass}
          value={targetLanguage}
          onChange={(event) =>
            setTargetLanguage(
              event.target.value as WritePaperModeTranslateSettingsV1['targetLanguage']
            )
          }
        >
          <option value="zh">{t('writePaperLanguageZh')}</option>
          <option value="en">{t('writePaperLanguageEn')}</option>
        </select>

        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-ds-muted">
              {t('writePaperTranslateInherit')}
            </div>
            <p className="mt-0.5 text-[11.5px] leading-4 text-ds-faint">
              {t('writePaperTranslateInheritDesc')}
            </p>
            {inheritModel ? (
              <p className="mt-1 text-[11.5px] leading-4 text-ds-faint">
                {composerModel.trim()
                  ? t('writePaperTranslateInheritCurrent', {
                      model: composerProviderId.trim()
                        ? `${composerProviderId.trim()} / ${composerModel.trim()}`
                        : composerModel.trim()
                    })
                  : t('writePaperTranslateInheritUnknown')}
              </p>
            ) : null}
          </div>
          <Toggle
            checked={inheritModel}
            onChange={setInheritModel}
            ariaLabel={t('writePaperTranslateInherit')}
          />
        </div>

        {!inheritModel ? (
          <div className="mt-3">
            <label className="mb-1 block text-[12px] font-medium text-ds-muted">
              {t('writePaperTranslateModel')}
            </label>
            <div className="flex gap-2">
              {providerOptions.length ? (
                <select
                  className={`${fieldClass} w-36 shrink-0`}
                  value={providerId}
                  onChange={(event) => {
                    setProviderId(event.target.value)
                    setModel('')
                  }}
                >
                  <option value="">{t('writePaperOptional')}</option>
                  {providerOptions.map((item) => (
                    <option key={item.providerId} value={item.providerId}>
                      {item.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={`${fieldClass} w-36 shrink-0`}
                  value={providerId}
                  placeholder="provider"
                  spellCheck={false}
                  onChange={(event) => setProviderId(event.target.value)}
                />
              )}
              <input
                className={fieldClass}
                list="paper-translate-model-options"
                value={model}
                placeholder="model"
                spellCheck={false}
                onChange={(event) => setModel(event.target.value)}
              />
              <datalist id="paper-translate-model-options">
                {modelOptions.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>
            <p className="mt-1 text-[11.5px] leading-4 text-ds-faint">
              {t('writePaperTranslateModelDesc')}
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            className={`${linkButtonClass} mr-auto`}
            onClick={() => useChatStore.getState().openSettings('providers')}
          >
            <Settings2 className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t('writePaperTranslateProviderSettings')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-full px-4 text-[12.5px] text-ds-muted hover:bg-ds-hover"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : null}
            {t('writePaperTranslateSaveRetry')}
          </button>
        </div>
      </form>
    </div>
  )
}
