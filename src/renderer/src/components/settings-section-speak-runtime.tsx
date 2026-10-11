import { settingsButtonClass } from './settings-button'
import { Download, Loader2, Square, Trash2 } from 'lucide-react'
import type { ReactElement } from 'react'
import {
  LOCAL_SANOTTS_DOWNLOAD_SOURCES,
  LOCAL_SANOTTS_LICENSE,
  LOCAL_SANOTTS_RUNTIME_LABEL,
  LOCAL_SANOTTS_RUNTIME_SIZE_BYTES,
  type LocalSanottsAssetState,
  type LocalSanottsDownloadSourceStatus,
  type LocalSanottsVoiceStatus,
  type LocalSanottsRuntimeStatus
} from '@shared/local-sanotts'
import { localSanottsVoiceById, type LocalSanottsVoiceId } from '@shared/local-sanotts-voices'
import { InlineNoticeView, SettingRow, SettingsCard, Toggle } from './settings-controls'
import { formatBytes, formatTransferRate } from './settings-section-speech-to-text-support'
import {
  speakModelStateLabel,
  speakSourceStatusText
} from './settings-section-speak-support'
import type { InlineNotice } from './settings-controls'

export type SpeakRuntimePanelProps = {
  t: (key: string, options?: Record<string, unknown>) => string
  selectControlClass: string
  downloadSource: string
  autoDownload: boolean
  runtime: LocalSanottsRuntimeStatus | null
  voiceId: LocalSanottsVoiceId
  voiceStatus: LocalSanottsVoiceStatus
  sourceStatuses: LocalSanottsDownloadSourceStatus[] | null
  sourceCheckBusy: boolean
  runtimeBusy: boolean
  runtimeCanceling: boolean
  voiceBusy: boolean
  notice: InlineNotice | null
  onSelectDownloadSource: (sourceId: string) => void
  onToggleAutoDownload: (enabled: boolean) => void
  onDownloadRuntime: () => void
  onCancelRuntime: () => void
  onDeleteRuntime: () => void
  onDownloadVoice: () => void
}

/**
 * Runtime WASM and current-voice download controls. sanoTTS shares one G2P
 * runtime across voices, so the settings page downloads that once and then the
 * selected voice weights.
 */
export function SpeakRuntimePanel(props: SpeakRuntimePanelProps): ReactElement {
  const { t, runtime } = props
  const runtimeState = runtime?.state ?? 'not_downloaded'
  const voice = localSanottsVoiceById(props.voiceId)
  return (
    <SettingsCard title={t('speakRuntimeCard')} description={t('speakRuntimeCardDesc')}>
      <SettingRow
        title={t('speakDownloadSource')}
        description={t('speakDownloadSourceDesc')}
        control={
          <div className="flex w-full min-w-0 flex-col gap-2 md:max-w-xl">
            <select
              className={props.selectControlClass}
              aria-label={t('speakDownloadSource')}
              value={props.downloadSource}
              onChange={(event) => props.onSelectDownloadSource(event.target.value)}
            >
              {LOCAL_SANOTTS_DOWNLOAD_SOURCES.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </select>
            <p className="text-[11.5px] leading-4 text-ds-faint">{t('speakDownloadSourceRuntimeHint')}</p>
            <div className="grid gap-1.5 text-[12px] text-ds-muted">
              {props.sourceCheckBusy && !props.sourceStatuses ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                  {t('speakDownloadSourceChecking')}
                </span>
              ) : null}
              {(props.sourceStatuses ?? []).map((status) => {
                const selected = status.sourceId === props.downloadSource
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
                      className={`h-2 w-2 shrink-0 rounded-full ${available ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    />
                    <span className="min-w-0 truncate">{speakSourceStatusText(t, status)}</span>
                  </span>
                )
              })}
            </div>
          </div>
        }
      />
      <AssetCard
        testId="speak-runtime"
        title={LOCAL_SANOTTS_RUNTIME_LABEL}
        hint={t('speakRuntimeHint', { license: LOCAL_SANOTTS_LICENSE })}
        sizeBytes={LOCAL_SANOTTS_RUNTIME_SIZE_BYTES}
        state={runtimeState}
        downloadedBytes={runtime?.downloadedBytes}
        totalBytes={runtime?.totalBytes}
        speedBytesPerSecond={runtime?.speedBytesPerSecond}
        busy={props.runtimeBusy}
        canceling={props.runtimeCanceling}
        message={runtime?.message}
        t={t}
        onDownload={props.onDownloadRuntime}
        onCancel={props.onCancelRuntime}
        onDelete={runtimeState === 'ready' ? props.onDeleteRuntime : undefined}
      />
      <AssetCard
        testId="speak-voice"
        title={voice.label}
        hint={t('speakVoiceHint')}
        sizeBytes={props.voiceStatus.sizeBytes}
        state={props.voiceStatus.state}
        downloadedBytes={props.voiceStatus.downloadedBytes}
        totalBytes={props.voiceStatus.totalBytes}
        speedBytesPerSecond={props.voiceStatus.speedBytesPerSecond}
        message={props.voiceStatus.message}
        busy={props.voiceBusy}
        t={t}
        onDownload={props.onDownloadVoice}
      />
      <SettingRow
        title={t('speakAutoDownload')}
        description={t('speakAutoDownloadDesc')}
        control={
          <Toggle
            checked={props.autoDownload}
            onChange={props.onToggleAutoDownload}
            ariaLabel={t('speakAutoDownload')}
          />
        }
      />
      {props.notice ? <InlineNoticeView notice={props.notice} /> : null}
    </SettingsCard>
  )
}

function AssetCard(props: {
  testId: string
  title: string
  hint: string
  sizeBytes: number
  state: LocalSanottsAssetState
  downloadedBytes?: number
  totalBytes?: number
  speedBytesPerSecond?: number
  busy: boolean
  canceling?: boolean
  message?: string
  t: (key: string, options?: Record<string, unknown>) => string
  onDownload: () => void
  onCancel?: () => void
  onDelete?: () => void
}): ReactElement {
  const { t, state } = props
  return (
    <div
      data-speak-asset={props.testId}
      data-state={state}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2.5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-[13px] font-medium text-ds-ink">{props.title}</span>
        <span className="text-[11.5px] tabular-nums text-ds-muted">{formatBytes(props.sizeBytes)}</span>
        <span
          className={[
            'text-[11.5px]',
            state === 'ready'
              ? 'text-emerald-600 dark:text-emerald-300'
              : state === 'error'
                ? 'text-rose-500'
                : 'text-ds-faint'
          ].join(' ')}
        >
          {speakModelStateLabel(t, state)}
        </span>
      </div>
      <p className="text-[11.5px] leading-4 text-ds-faint">{props.hint}</p>
      {state === 'error' && props.message ? (
        <p role="alert" className="break-words text-[11.5px] text-rose-500">{props.message}</p>
      ) : null}
      {state === 'downloading' ? (
        <div className="space-y-1.5">
          <progress
            aria-label={props.title}
            value={Math.min(props.downloadedBytes ?? 0, props.totalBytes ?? props.sizeBytes)}
            max={props.totalBytes || props.sizeBytes}
            className="h-1.5 w-full accent-accent"
          />
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] tabular-nums text-ds-muted">
            <span>
              {formatBytes(props.downloadedBytes) || '0 MB'} / {formatBytes(props.totalBytes ?? props.sizeBytes)}
            </span>
            <span>{formatTransferRate(props.speedBytesPerSecond, t('speakDownloadStarting'))}</span>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {state === 'downloading' && props.onCancel ? (
          <button className={settingsButtonClass()}
            type="button"
            disabled={props.canceling}
            aria-busy={Boolean(props.canceling)}
            onClick={props.onCancel}
          >
            <Square className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t('speakModelCancel')}
          </button>
        ) : (
          <button aria-busy={props.busy || state === 'downloading'} className={settingsButtonClass()}
            type="button"
            disabled={props.busy || state === 'ready' || state === 'downloading'}
            onClick={props.onDownload}
          >
            {props.busy || state === 'downloading' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
            ) : (
              <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
            )}
            {state === 'ready' ? t('speakModelDownloaded') : state === 'downloading' ? t('speakModelStateDownloading') : t('speakModelDownload')}
          </button>
        )}
        {state === 'ready' && props.onDelete ? (
          <button
            type="button"
            disabled={props.busy}
            onClick={props.onDelete}
            className={settingsButtonClass({ variant: 'danger' })}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t('speakModelDelete')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
