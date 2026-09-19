import { Download, Loader2, Square, Trash2 } from 'lucide-react'
import type { ReactElement } from 'react'
import {
  LOCAL_SANOTTS_DOWNLOAD_SOURCES,
  LOCAL_SANOTTS_LICENSE,
  LOCAL_SANOTTS_RUNTIME_LABEL,
  LOCAL_SANOTTS_RUNTIME_SIZE_BYTES,
  type LocalSanottsAssetState,
  type LocalSanottsDownloadSourceStatus,
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
  voiceState: LocalSanottsAssetState
  voiceSizeBytes: number
  sourceStatuses: LocalSanottsDownloadSourceStatus[] | null
  sourceCheckBusy: boolean
  busyAsset: 'runtime' | 'voice' | null
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
  const { t, runtime, busyAsset } = props
  const runtimeState = runtime?.state ?? 'not_downloaded'
  const voice = localSanottsVoiceById(props.voiceId)
  const runtimeBusy = busyAsset === 'runtime'
  const voiceBusy = busyAsset === 'voice'
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
        busy={runtimeBusy}
        t={t}
        onDownload={props.onDownloadRuntime}
        onCancel={props.onCancelRuntime}
        onDelete={runtimeState === 'ready' ? props.onDeleteRuntime : undefined}
      />
      <AssetCard
        testId="speak-voice"
        title={voice.label}
        hint={t('speakVoiceHint')}
        sizeBytes={props.voiceSizeBytes}
        state={props.voiceState}
        busy={voiceBusy}
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
  t: (key: string, options?: Record<string, unknown>) => string
  onDownload: () => void
  onCancel?: () => void
  onDelete?: () => void
}): ReactElement {
  const { t, state } = props
  return (
    <div
      data-speak-asset={props.testId}
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
      {state === 'downloading' ? (
        <div className="flex items-center gap-2 text-[11.5px] tabular-nums text-ds-muted">
          <span>
            {formatBytes(props.downloadedBytes)}
            {props.totalBytes ? ` / ${formatBytes(props.totalBytes)}` : ''}
          </span>
          <span>{formatTransferRate(props.speedBytesPerSecond, t('speakDownloadStarting'))}</span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {state === 'downloading' && props.onCancel ? (
          <button
            type="button"
            onClick={props.onCancel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-1 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <Square className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t('speakModelCancel')}
          </button>
        ) : (
          <button
            type="button"
            disabled={props.busy || state === 'ready'}
            onClick={props.onDownload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-1 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
          >
            {props.busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
            ) : (
              <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
            )}
            {state === 'ready' ? t('speakModelDownloaded') : t('speakModelDownload')}
          </button>
        )}
        {state === 'ready' && props.onDelete ? (
          <button
            type="button"
            disabled={props.busy}
            onClick={props.onDelete}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-1 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t('speakModelDelete')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
