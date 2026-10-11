import { settingsButtonClass } from './settings-button'
import {
  LOCAL_WHISPER_DOWNLOAD_SOURCES,
  LOCAL_WHISPER_MODELS,
  type LocalWhisperDownloadSourceStatus
} from '@shared/local-whisper'
import { Download, Loader2, Square, Trash2 } from 'lucide-react'
import { type ReactElement } from 'react'
import {
  InlineNoticeView,
  ModelSelect,
  SettingRow,
  SettingsCard,
  SettingsTabPanel
} from './settings-controls'

import {
  SPEECH_LANGUAGE_OPTIONS,
  formatBytes,
  formatTransferRate,
  localWhisperModelStateLabel,
  localWhisperQualityLabel,
  localWhisperSourceStatusText
} from './settings-section-speech-to-text-support'

export function SpeechToTextModelPanel({ view }: { view: Record<string, any> }): ReactElement {
  const { t, speechToText, usingLocalWhisper, selectControlClass, updateSpeechToText, localWhisperSourceCheckBusy, localWhisperSourceStatuses, selectedLocalWhisperModel, selectedLocalWhisperModelId, localWhisperStatuses, refreshLocalWhisperStatus, setLocalWhisperNotice, localWhisperStatus, localWhisperNotice, localWhisperBusy, downloadLocalWhisper, cancelLocalWhisper, deleteLocalWhisper, usingCustomProvider, speechModelOptions, activeTab } = view
  return (
    <>
      <SettingsTabPanel
        baseId="speech-to-text-settings"
        tabId="model"
        active={activeTab === 'model'}
      >
        {speechToText.enabled ? (
          <SettingsCard title={t('speechToTextModel')}>
          {usingLocalWhisper ? (
            <SettingRow
              title={t('speechToTextLocalDownloadSource')}
              description={t('speechToTextLocalDownloadSourceDesc')}
              control={
                <div className="flex w-full min-w-0 flex-col gap-2 md:max-w-xl">
                  <select
                    className={selectControlClass}
                    value={speechToText.localWhisperDownloadSource}
                    onChange={(e) => updateSpeechToText({ localWhisperDownloadSource: e.target.value })}
                  >
                    {LOCAL_WHISPER_DOWNLOAD_SOURCES.map((source) => (
                      <option key={source.id} value={source.id}>
                        {t(`speechToTextLocalDownloadSource_${source.id}`)}
                      </option>
                    ))}
                  </select>
                  <div className="grid gap-1.5 text-[12px] text-ds-muted">
                    {localWhisperSourceCheckBusy && !localWhisperSourceStatuses ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                        {t('speechToTextLocalDownloadSourceChecking')}
                      </span>
                    ) : null}
                    {(localWhisperSourceStatuses ?? []).map((status: LocalWhisperDownloadSourceStatus) => {
                      const selected = status.sourceId === speechToText.localWhisperDownloadSource
                      const available = status.state === 'available'
                      return (
                        <span
                          key={status.sourceId}
                          className={[
                            'inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1',
                            selected ? 'border-accent/35 bg-accent/10' : 'border-ds-border bg-ds-card',
                            available ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
                          ].join(' ')}
                        >
                          <span
                            className={[
                              'h-2 w-2 shrink-0 rounded-full',
                              available ? 'bg-emerald-500' : 'bg-amber-500'
                            ].join(' ')}
                          />
                          <span className="min-w-0 truncate">{localWhisperSourceStatusText(t, status)}</span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              }
            />
          ) : null}
          {usingLocalWhisper ? (
            <SettingRow
              title={t('speechToTextLocalModel')}
              description={t('speechToTextLocalModelDesc', {
                source: selectedLocalWhisperModel.source,
                license: selectedLocalWhisperModel.license
              })}
              control={
                <div className="flex w-full min-w-0 flex-col gap-3 md:max-w-xl">
                  <div className="grid gap-2">
                    {LOCAL_WHISPER_MODELS.map((model) => {
                      const selected = model.id === selectedLocalWhisperModelId
                      const modelStatus = localWhisperStatuses[model.id]
                      const modelState = modelStatus?.state ?? 'not_downloaded'
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => {
                            if (selected) {
                              void refreshLocalWhisperStatus(model.id).catch(() => undefined)
                              return
                            }
                            setLocalWhisperNotice(null)
                            updateSpeechToText({ model: model.id })
                          }}
                          className={[
                            'flex min-w-0 flex-col rounded-xl border px-3 py-2.5 text-left transition',
                            selected
                              ? 'border-accent/60 bg-accent/10 text-ds-ink shadow-sm'
                              : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                          ].join(' ')}
                        >
                          <span className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="text-[13.5px] font-semibold">{model.label}</span>
                            <span
                              className={[
                                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                                modelState === 'ready'
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : modelState === 'downloading'
                                    ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                                    : 'bg-slate-500/15 text-slate-600 dark:text-slate-300'
                              ].join(' ')}
                            >
                              {localWhisperModelStateLabel(t, modelState)}
                            </span>
                            {model.recommended ? (
                              <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:text-orange-300">
                                {t('speechToTextLocalRecommended')}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[12px]">
                            <span>{t('speechToTextLocalModelFileSize', { size: formatBytes(model.sizeBytes) })}</span>
                            <span>{t('speechToTextLocalModelMemory', { memory: model.resourceEstimate.memory })}</span>
                            <span>{t('speechToTextLocalModelCpu', { threads: model.resourceEstimate.cpuThreads })}</span>
                            <span>{t('speechToTextLocalModelQuality', {
                              quality: localWhisperQualityLabel(t, model.qualityTier)
                            })}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="text-[12.5px] text-ds-muted">
                    {localWhisperStatus?.state === 'ready'
                      ? t('speechToTextLocalModelReady', {
                          model: selectedLocalWhisperModel.shortName,
                          size: formatBytes(localWhisperStatus.downloadedBytes)
                        })
                      : localWhisperStatus?.state === 'downloading'
                        ? t('speechToTextLocalModelDownloading', {
                            model: selectedLocalWhisperModel.shortName,
                            percent: Math.round(
                              localWhisperStatus.totalBytes
                                ? ((localWhisperStatus.downloadedBytes ?? 0) / localWhisperStatus.totalBytes) * 100
                                : 0
                            ),
                            size: formatBytes(localWhisperStatus.downloadedBytes),
                            speed: formatTransferRate(
                              localWhisperStatus.speedBytesPerSecond,
                              t('speechToTextLocalDownloadSpeedPending')
                            )
                          })
                        : t('speechToTextLocalModelMissing', {
                            model: selectedLocalWhisperModel.shortName,
                            size: formatBytes(selectedLocalWhisperModel.sizeBytes)
                          })}
                  </div>
                  {localWhisperNotice ? <InlineNoticeView notice={localWhisperNotice} /> : null}
                  <div className="flex flex-wrap gap-2">
                    <button aria-busy={Boolean(localWhisperBusy === 'download')} className={settingsButtonClass()}
                      type="button"
                      disabled={localWhisperBusy !== 'idle' || localWhisperStatus?.state === 'ready' || localWhisperStatus?.state === 'downloading'}
                      onClick={() => void downloadLocalWhisper()}
                    >
                      {localWhisperBusy === 'download'
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                        : <Download className="h-3.5 w-3.5" strokeWidth={1.9} />}
                      {t('speechToTextLocalModelDownload', { model: selectedLocalWhisperModel.shortName })}
                    </button>
                    {localWhisperStatus?.state === 'downloading' || localWhisperBusy === 'cancel' ? (
                      <button aria-busy={Boolean(localWhisperBusy === 'cancel')} className={settingsButtonClass()}
                        type="button"
                        disabled={localWhisperBusy === 'cancel' || localWhisperBusy === 'delete'}
                        onClick={() => void cancelLocalWhisper()}
                      >
                        {localWhisperBusy === 'cancel'
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                          : <Square className="h-3.5 w-3.5" strokeWidth={1.9} />}
                        {t('speechToTextLocalModelCancel')}
                      </button>
                    ) : null}
                    <button aria-busy={Boolean(localWhisperBusy === 'delete')}
                      type="button"
                      disabled={localWhisperBusy !== 'idle' || localWhisperStatus?.state !== 'ready'}
                      onClick={() => void deleteLocalWhisper()}
                      className={settingsButtonClass({ variant: 'danger' })}
                    >
                      {localWhisperBusy === 'delete'
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                        : <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />}
                      {t('speechToTextLocalModelDelete')}
                    </button>
                  </div>
                </div>
              }
            />
          ) : null}
          {!usingLocalWhisper ? (
            <SettingRow
              title={t('speechToTextModel')}
              description={t('speechToTextModelDesc')}
              control={
                <div className="w-full min-w-0 md:max-w-md">
                  {usingCustomProvider ? (
                    <input
                      className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      value={speechToText.model}
                      placeholder={t('speechToTextModelPlaceholder')}
                      onChange={(e) => updateSpeechToText({ model: e.target.value })}
                    />
                  ) : (
                    <ModelSelect
                      value={speechModelOptions.includes(speechToText.model) ? speechToText.model : ''}
                      options={speechModelOptions}
                      defaultLabel={t('modelSelectDefaultOption', {
                        model: speechModelOptions[0] ?? ''
                      })}
                      selectClassName={selectControlClass}
                      onChange={(model) => updateSpeechToText({ model })}
                    />
                  )}
                </div>
              }
            />
          ) : null}
          <SettingRow
            title={t('speechToTextLanguage')}
            description={t('speechToTextLanguageDesc')}
            control={
              <select
                className={selectControlClass}
                value={speechToText.language}
                onChange={(e) => updateSpeechToText({ language: e.target.value })}
              >
                {SPEECH_LANGUAGE_OPTIONS.map((language) => (
                  <option key={language || 'auto'} value={language}>
                    {t(`speechLanguage_${language || 'auto'}`)}
                  </option>
                ))}
                {!SPEECH_LANGUAGE_OPTIONS.includes(speechToText.language) ? (
                  <option value={speechToText.language}>{speechToText.language}</option>
                ) : null}
              </select>
            }
          />
          </SettingsCard>
        ) : null}
      </SettingsTabPanel>
    </>
  )
}
