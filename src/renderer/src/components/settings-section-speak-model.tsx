import { Download, Loader2, Square, Trash2 } from 'lucide-react'
import type { ReactElement } from 'react'
import {
  LOCAL_KOKORO_DOWNLOAD_SOURCES,
  LOCAL_KOKORO_MODELS,
  type LocalKokoroDownloadSourceStatus,
  type LocalKokoroModelId,
  type LocalKokoroModelStatus
} from '@shared/local-kokoro'
import { InlineNoticeView, SettingRow, SettingsCard, Toggle } from './settings-controls'
import { formatBytes, formatTransferRate } from './settings-section-speech-to-text-support'
import {
  speakModelStateLabel,
  speakQualityLabel,
  speakSourceStatusText
} from './settings-section-speak-support'
import type { InlineNotice } from './settings-controls'

export type SpeakModelPanelProps = {
  t: (key: string, options?: Record<string, unknown>) => string
  selectControlClass: string
  downloadSource: string
  autoDownload: boolean
  selectedModelId: LocalKokoroModelId
  statuses: Partial<Record<LocalKokoroModelId, LocalKokoroModelStatus>>
  sourceStatuses: LocalKokoroDownloadSourceStatus[] | null
  sourceCheckBusy: boolean
  busyModelId: LocalKokoroModelId | null
  notice: InlineNotice | null
  onSelectModel: (modelId: LocalKokoroModelId) => void
  onSelectDownloadSource: (sourceId: string) => void
  onToggleAutoDownload: (enabled: boolean) => void
  onDownload: (modelId: LocalKokoroModelId) => void
  onCancel: (modelId: LocalKokoroModelId) => void
  onDelete: (modelId: LocalKokoroModelId) => void
}

/**
 * Model tier list with per-tier download controls, mirroring the local Whisper
 * panel so both local speech engines are managed the same way.
 */
export function SpeakModelPanel(props: SpeakModelPanelProps): ReactElement {
  const { t, statuses, selectedModelId, busyModelId } = props
  return (
    <SettingsCard title={t('speakModelCard')} description={t('speakModelCardDesc')}>
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
              {LOCAL_KOKORO_DOWNLOAD_SOURCES.map((source) => (
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
      <SettingRow
        title={t('speakModelTier')}
        description={t('speakModelTierDesc')}
        wideControl
        control={
          <div className="flex w-full min-w-0 flex-col gap-2">
            {LOCAL_KOKORO_MODELS.map((model) => {
              const status = statuses[model.id]
              const state = status?.state ?? 'not_downloaded'
              const selected = model.id === selectedModelId
              const busy = busyModelId === model.id
              return (
                <div
                  key={model.id}
                  data-speak-model={model.id}
                  data-speak-model-recommended={status?.recommended ? 'true' : 'false'}
                  className={[
                    'flex min-w-0 flex-col gap-2 rounded-xl border px-3 py-2.5 transition',
                    selected
                      ? 'border-accent/60 bg-accent/10 text-ds-ink shadow-sm'
                      : 'border-ds-border bg-ds-card text-ds-muted'
                  ].join(' ')}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => props.onSelectModel(model.id)}
                      aria-pressed={selected}
                      className="min-w-0 truncate text-left text-[13px] font-medium text-ds-ink hover:underline"
                    >
                      {model.label}
                    </button>
                    {status?.recommended ? (
                      <span className="rounded-full border border-accent/40 px-1.5 py-0.5 text-[10.5px] text-accent">
                        {t('speakModelRecommended')}
                      </span>
                    ) : null}
                    <span className="rounded-full border border-ds-border px-1.5 py-0.5 text-[10.5px]">
                      {speakQualityLabel(t, model.qualityTier)}
                    </span>
                    <span className="text-[11.5px] tabular-nums">{formatBytes(model.sizeBytes)}</span>
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
                  <p className="text-[11.5px] leading-4 text-ds-faint">
                    {t('speakModelResourceHint', {
                      memory: model.resourceEstimate.memory,
                      threads: model.resourceEstimate.cpuThreads,
                      license: model.license
                    })}
                  </p>
                  {state === 'downloading' ? (
                    <div className="flex items-center gap-2 text-[11.5px] tabular-nums text-ds-muted">
                      <span>
                        {formatBytes(status?.downloadedBytes)}
                        {status?.totalBytes ? ` / ${formatBytes(status.totalBytes)}` : ''}
                      </span>
                      <span>{formatTransferRate(status?.speedBytesPerSecond, t('speakDownloadStarting'))}</span>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {state === 'downloading' ? (
                      <button
                        type="button"
                        onClick={() => props.onCancel(model.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-1 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      >
                        <Square className="h-3.5 w-3.5" strokeWidth={1.9} />
                        {t('speakModelCancel')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy || state === 'ready'}
                        onClick={() => props.onDownload(model.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-1 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                        ) : (
                          <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
                        )}
                        {state === 'ready' ? t('speakModelDownloaded') : t('speakModelDownload')}
                      </button>
                    )}
                    {state === 'ready' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => props.onDelete(model.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-1 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                        {t('speakModelDelete')}
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        }
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
