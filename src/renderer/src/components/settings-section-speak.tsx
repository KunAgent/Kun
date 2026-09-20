import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Loader2, Play, Square, Volume2 } from 'lucide-react'
import { isAppLocale } from '@shared/app-locales'
import {
  LOCAL_SANOTTS_DEFAULT_DOWNLOAD_SOURCE_ID,
  type LocalSanottsAssetState,
  type LocalSanottsDownloadSourceStatus,
  type LocalSanottsRuntimeStatus
} from '@shared/local-sanotts'
import {
  LOCAL_SANOTTS_VOICE_AUTO_ID,
  localSanottsVoiceById,
  resolveLocalSanottsVoiceId,
  type LocalSanottsVoiceId,
  type LocalSanottsVoiceSetting
} from '@shared/local-sanotts-voices'
import type { LocalSanottsTrackUsage } from '@shared/local-sanotts-tracks'
import {
  InlineNoticeView,
  SettingRow,
  SettingsCard,
  Toggle,
  type InlineNotice
} from './settings-controls'
import { SpeakRuntimePanel } from './settings-section-speak-runtime'
import {
  SPEAK_LANGUAGE_FILTERS,
  SPEAK_SPEED_MAX,
  SPEAK_SPEED_MIN,
  SPEAK_SPEED_STEP,
  clampSpeakSpeed,
  formatSpeakSpeed,
  speakLanguageLabel,
  speakPreviewSample,
  speakVoiceGroups,
  speakVoiceOptionLabel,
  type SpeakLanguageFilter
} from './settings-section-speak-support'
import { useSpeakStore } from '../stores/speak-store'
import { refreshSpeakTrackKeys, useSpeakTrackStore } from '../stores/speak-track-store'
import { formatBytes } from './settings-section-speech-to-text-support'
import { previewSpeakVoice, stopSpeaking } from './chat/speak-controller'
import { speakErrorLabel } from './chat/AssistantSpeakButton'

const DEFAULT_SPEAK = {
  enabled: true,
  voice: LOCAL_SANOTTS_VOICE_AUTO_ID as LocalSanottsVoiceSetting,
  speed: 1,
  downloadSource: LOCAL_SANOTTS_DEFAULT_DOWNLOAD_SOURCE_ID,
  autoDownload: true,
  keepTracks: false
}

/**
 * Local speech provider: the on-device sanoTTS voice behind the Speak action.
 *
 * Rendered inside Media -> Speech generation beside the remote speech provider,
 * so both ways of producing speech are configured in one place.
 */
export function LocalSpeechProviderSettings({ ctx }: { ctx: Record<string, any> }): ReactElement {
  // Speak playback errors are authored in the common namespace shared with
  // the answer action, so they are translated with tCommon.
  const { t, tCommon, kun, updateKun, selectControlClass } = ctx
  const locale = isAppLocale(ctx.locale) ? ctx.locale : 'en'
  const speak = useMemo(() => ({ ...DEFAULT_SPEAK, ...(kun.speak ?? {}) }), [kun.speak])
  const speakPhase = useSpeakStore((state) => state.phase)
  const speakError = useSpeakStore((state) => state.error)
  const trackKeys = useSpeakTrackStore((state) => state.keys)
  const [runtime, setRuntime] = useState<LocalSanottsRuntimeStatus | null>(null)
  const [readyVoices, setReadyVoices] = useState<LocalSanottsVoiceId[]>([])
  const [sourceStatuses, setSourceStatuses] = useState<LocalSanottsDownloadSourceStatus[] | null>(null)
  const [sourceCheckBusy, setSourceCheckBusy] = useState(false)
  const [busyAsset, setBusyAsset] = useState<'runtime' | 'voice' | null>(null)
  const [trackUsage, setTrackUsage] = useState<LocalSanottsTrackUsage | null>(null)
  const [clearingTracks, setClearingTracks] = useState(false)
  const [notice, setNotice] = useState<InlineNotice | null>(null)
  const [languageFilter, setLanguageFilter] = useState<SpeakLanguageFilter>('all')
  const resolvedVoiceId = resolveLocalSanottsVoiceId(speak.voice, locale)
  const selectedVoice = localSanottsVoiceById(resolvedVoiceId)
  const [sampleText, setSampleText] = useState(speakPreviewSample(selectedVoice.language))

  const updateSpeak = useCallback(
    (patch: Record<string, unknown>): void => {
      if (patch.enabled === false) stopSpeaking()
      updateKun({ speak: { ...speak, ...patch } })
    },
    [speak, updateKun]
  )

  const refreshStatuses = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.getLocalSanottsRuntimeStatus !== 'function') return
    const [nextRuntime, voices] = await Promise.all([
      window.kunGui.getLocalSanottsRuntimeStatus(),
      window.kunGui.listDownloadedLocalSanottsVoices()
    ])
    setRuntime(nextRuntime)
    setReadyVoices(voices)
  }, [])

  useEffect(() => {
    void refreshStatuses().catch(() => undefined)
  }, [refreshStatuses])

  useEffect(() => {
    if (typeof window.kunGui?.onLocalSanottsAssetProgress !== 'function') return
    return window.kunGui.onLocalSanottsAssetProgress(() => {
      void refreshStatuses().catch(() => undefined)
    })
  }, [refreshStatuses])

  useEffect(() => {
    if (typeof window.kunGui?.checkLocalSanottsDownloadSources !== 'function') return
    let canceled = false
    setSourceCheckBusy(true)
    void window.kunGui
      .checkLocalSanottsDownloadSources()
      .then((result) => {
        if (!canceled) setSourceStatuses(result.sources)
      })
      .catch(() => {
        if (!canceled) setSourceStatuses(null)
      })
      .finally(() => {
        if (!canceled) setSourceCheckBusy(false)
      })
    return () => {
      canceled = true
    }
  }, [])

  const voiceGroups = useMemo(() => {
    const groups = speakVoiceGroups(languageFilter)
    if (!groups.some((group) => group.voices.some((voice) => voice.id === selectedVoice.id))) {
      groups.push({ language: selectedVoice.language, voices: [selectedVoice] })
    }
    return groups
  }, [languageFilter, selectedVoice])
  const previewing = speakPhase !== 'idle'
  const voiceState: LocalSanottsAssetState = readyVoices.includes(resolvedVoiceId)
    ? 'ready'
    : 'not_downloaded'

  const runRuntimeAction = async (action: 'download' | 'cancel' | 'delete'): Promise<void> => {
    const bridge = window.kunGui
    if (!bridge) return
    setNotice(null)
    setBusyAsset('runtime')
    try {
      if (action === 'download') {
        const result = await bridge.downloadLocalSanottsRuntime({ sourceId: speak.downloadSource })
        if (!result.ok) setNotice({ tone: 'error', message: result.message })
      } else if (action === 'cancel') {
        await bridge.cancelLocalSanottsRuntime()
      } else {
        const result = await bridge.deleteLocalSanottsRuntime()
        if (!result.ok) setNotice({ tone: 'error', message: result.message })
      }
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusyAsset(null)
      await refreshStatuses().catch(() => undefined)
    }
  }

  const onDownloadVoice = async (): Promise<void> => {
    const bridge = window.kunGui
    if (!bridge) return
    setNotice(null)
    setBusyAsset('voice')
    try {
      const status = await bridge.downloadLocalSanottsVoice({
        voiceId: resolvedVoiceId,
        sourceId: speak.downloadSource
      })
      if (status.state !== 'ready') {
        setNotice({ tone: 'error', message: status.message || t('speakVoiceMissing') })
      }
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusyAsset(null)
      await refreshStatuses().catch(() => undefined)
    }
  }

  const onPreview = async (): Promise<void> => {
    if (previewing) {
      stopSpeaking()
      return
    }
    setNotice(null)
    const result = await previewSpeakVoice(
      {
        enabled: speak.enabled,
        voice: resolvedVoiceId,
        speed: clampSpeakSpeed(speak.speed),
        downloadSource: speak.downloadSource,
        autoDownload: speak.autoDownload,
        keepTracks: false
      },
      sampleText.trim() || speakPreviewSample(selectedVoice.language)
    )
    if (!result.ok && result.message) {
      setNotice({ tone: 'error', message: speakErrorLabel(tCommon, result.message) })
    }
    await refreshStatuses().catch(() => undefined)
  }

  const refreshTrackUsage = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.getLocalSanottsTrackUsage !== 'function') return
    setTrackUsage(await window.kunGui.getLocalSanottsTrackUsage().catch(() => null))
  }, [])

  useEffect(() => {
    void refreshTrackUsage()
  }, [refreshTrackUsage, speak.keepTracks, trackKeys])

  const onClearTracks = async (): Promise<void> => {
    if (typeof window.kunGui?.clearLocalSanottsTracks !== 'function') return
    setClearingTracks(true)
    try {
      setTrackUsage(await window.kunGui.clearLocalSanottsTracks())
      useSpeakTrackStore.getState().clearKeys()
      refreshSpeakTrackKeys()
    } finally {
      setClearingTracks(false)
    }
  }

  return (
    <div className="space-y-4">
      <SettingsCard title={t('speakLocalProviderCard')} description={t('speakLocalProviderCardDesc')}>
        <SettingRow
          title={t('speakEnabled')}
          description={t('speakEnabledDesc')}
          control={
            <Toggle
              checked={speak.enabled}
              onChange={(enabled) => updateSpeak({ enabled })}
              ariaLabel={t('speakEnabled')}
            />
          }
        />
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2.5 text-[12px] text-ds-muted">
          <Volume2 className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span>{t('speakSummary', {
            voice: speak.voice === LOCAL_SANOTTS_VOICE_AUTO_ID
              ? t('speakVoiceAuto')
              : selectedVoice.label,
            speed: formatSpeakSpeed(speak.speed)
          })}</span>
        </div>
        <p className="text-[11.5px] leading-4 text-ds-faint">{t('speakLicenseNote')}</p>
        <SettingRow
          title={t('speakKeepTracks')}
          description={t('speakKeepTracksDesc')}
          control={
            <Toggle
              checked={speak.keepTracks}
              onChange={(keepTracks) => updateSpeak({ keepTracks })}
              ariaLabel={t('speakKeepTracks')}
            />
          }
        />
        <SettingRow
          title={t('speakStoredTracks')}
          description={t('speakStoredTracksDesc')}
          control={
            <div className="flex w-full min-w-0 items-center justify-end gap-3">
              <span className="text-[12px] tabular-nums text-ds-muted">
                {t('speakStoredTracksUsage', {
                  count: trackUsage?.count ?? 0,
                  size: formatBytes(trackUsage?.totalBytes ?? 0) || '0 MB'
                })}
              </span>
              <button
                type="button"
                onClick={() => void onClearTracks()}
                disabled={clearingTracks || ((trackUsage?.count ?? 0) === 0 && speakPhase === 'idle')}
                className="shrink-0 rounded-lg border border-ds-border px-2 py-1 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
              >
                {t('speakStoredTracksClear')}
              </button>
            </div>
          }
        />
        <SettingRow
          title={t('speakLanguage')}
          description={t('speakLanguageDesc')}
          control={
            <select
              className={selectControlClass}
              aria-label={t('speakLanguage')}
              value={languageFilter}
              onChange={(event) => setLanguageFilter(event.target.value as SpeakLanguageFilter)}
            >
              {SPEAK_LANGUAGE_FILTERS.map((filter) => (
                <option key={filter} value={filter}>
                  {speakLanguageLabel(t, filter)}
                </option>
              ))}
            </select>
          }
        />
        <SettingRow
          title={t('speakVoice')}
          description={t('speakVoiceDesc')}
          control={
            <select
              className={selectControlClass}
              aria-label={t('speakVoice')}
              value={speak.voice}
              onChange={(event) => {
                const next = event.target.value as LocalSanottsVoiceSetting
                updateSpeak({ voice: next })
                const voice = localSanottsVoiceById(resolveLocalSanottsVoiceId(next, locale))
                setSampleText(speakPreviewSample(voice.language))
              }}
            >
              <option value={LOCAL_SANOTTS_VOICE_AUTO_ID}>{t('speakVoiceAuto')}</option>
              {voiceGroups.map((group) => (
                <optgroup key={group.language} label={speakLanguageLabel(t, group.language)}>
                  {group.voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {speakVoiceOptionLabel(
                        t,
                        voice,
                        readyVoices.includes(voice.id) ? 'ready' : 'not_downloaded'
                      )}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          }
        />
        <SettingRow
          title={t('speakSpeed')}
          description={t('speakSpeedDesc')}
          control={
            <div className="flex w-full min-w-0 items-center gap-3">
              <input
                type="range"
                min={SPEAK_SPEED_MIN}
                max={SPEAK_SPEED_MAX}
                step={SPEAK_SPEED_STEP}
                value={clampSpeakSpeed(speak.speed)}
                aria-label={t('speakSpeed')}
                onChange={(event) => updateSpeak({ speed: clampSpeakSpeed(Number(event.target.value)) })}
                className="min-w-0 flex-1 accent-accent"
              />
              <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-ds-muted">
                {formatSpeakSpeed(speak.speed)}
              </span>
              <button
                type="button"
                onClick={() => updateSpeak({ speed: 1 })}
                disabled={clampSpeakSpeed(speak.speed) === 1}
                className="shrink-0 rounded-lg border border-ds-border px-2 py-1 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
              >
                {t('speakSpeedReset')}
              </button>
            </div>
          }
        />
        <SettingRow
          title={t('speakPreview')}
          description={t('speakPreviewDesc')}
          wideControl
          control={
            <div className="flex w-full min-w-0 items-center gap-2">
              <input
                type="text"
                value={sampleText}
                maxLength={240}
                onChange={(event) => setSampleText(event.target.value)}
                aria-label={t('speakPreview')}
                className="min-w-0 flex-1 rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12.5px] text-ds-ink outline-none focus-visible:border-accent/60"
              />
              <button
                type="button"
                onClick={() => void onPreview()}
                title={previewing ? t('speakPreviewStop') : t('speakPreviewPlay')}
                aria-label={previewing ? t('speakPreviewStop') : t('speakPreviewPlay')}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-1.5 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                {previewing && speakPhase === 'speaking' ? (
                  <Square className="h-3.5 w-3.5" strokeWidth={1.9} />
                ) : previewing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                ) : (
                  <Play className="h-3.5 w-3.5" strokeWidth={1.9} />
                )}
                {previewing ? t('speakPreviewStop') : t('speakPreviewPlay')}
              </button>
            </div>
          }
        />
        {notice ? <InlineNoticeView notice={notice} /> : null}
        {!notice && speakError ? (
          <InlineNoticeView notice={{ tone: 'error', message: speakErrorLabel(tCommon, speakError) }} />
        ) : null}
      </SettingsCard>

      <SpeakRuntimePanel
        t={t}
        selectControlClass={selectControlClass}
        downloadSource={speak.downloadSource}
        autoDownload={speak.autoDownload}
        runtime={runtime}
        voiceId={resolvedVoiceId}
        voiceState={voiceState}
        voiceSizeBytes={selectedVoice.sizeBytes}
        sourceStatuses={sourceStatuses}
        sourceCheckBusy={sourceCheckBusy}
        busyAsset={busyAsset}
        notice={null}
        onSelectDownloadSource={(sourceId) => updateSpeak({ downloadSource: sourceId })}
        onToggleAutoDownload={(autoDownload) => updateSpeak({ autoDownload })}
        onDownloadRuntime={() => void runRuntimeAction('download')}
        onCancelRuntime={() => void runRuntimeAction('cancel')}
        onDeleteRuntime={() => void runRuntimeAction('delete')}
        onDownloadVoice={() => void onDownloadVoice()}
      />
    </div>
  )
}
