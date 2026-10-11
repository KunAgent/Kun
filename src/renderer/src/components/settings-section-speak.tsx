import { settingsButtonClass } from './settings-button'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Loader2, Play, Square, Volume2 } from 'lucide-react'
import { isAppLocale } from '@shared/app-locales'
import {
  LOCAL_SANOTTS_DEFAULT_DOWNLOAD_SOURCE_ID,
  type LocalSanottsDownloadSourceStatus
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
import { initialSpeakRuntimeStatus, initialSpeakVoiceStatus, useSpeakAssetStatuses } from './settings-section-speak-assets'
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
  const [sourceStatuses, setSourceStatuses] = useState<LocalSanottsDownloadSourceStatus[] | null>(null)
  const [sourceCheckBusy, setSourceCheckBusy] = useState(false)
  const [runtimeAction, setRuntimeAction] = useState<'download' | 'cancel' | 'delete' | null>(null)
  const runtimeActionId = useRef(0)
  const [busyVoices, setBusyVoices] = useState<LocalSanottsVoiceId[]>([])
  const [trackUsage, setTrackUsage] = useState<LocalSanottsTrackUsage | null>(null)
  const [clearingTracks, setClearingTracks] = useState(false)
  const [notice, setNotice] = useState<InlineNotice | null>(null)
  const [languageFilter, setLanguageFilter] = useState<SpeakLanguageFilter>('all')
  const resolvedVoiceId = resolveLocalSanottsVoiceId(speak.voice, locale)
  const selectedVoice = localSanottsVoiceById(resolvedVoiceId)
  const { runtime, voices, refreshStatuses, updateRuntime, updateVoice } = useSpeakAssetStatuses(resolvedVoiceId)
  const voiceStatus = voices[resolvedVoiceId] ?? initialSpeakVoiceStatus(resolvedVoiceId)
  const [sampleText, setSampleText] = useState(speakPreviewSample(selectedVoice.language))

  const updateSpeak = useCallback(
    (patch: Record<string, unknown>): void => {
      if (patch.enabled === false) stopSpeaking()
      updateKun({ speak: { ...speak, ...patch } })
    },
    [speak, updateKun]
  )

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
  const runRuntimeAction = async (action: 'download' | 'cancel' | 'delete'): Promise<void> => {
    const bridge = window.kunGui
    if (!bridge) return
    const actionId = ++runtimeActionId.current
    setNotice(null)
    setRuntimeAction(action)
    if (action === 'download') {
      updateRuntime({ ...initialSpeakRuntimeStatus(), state: 'downloading', downloadedBytes: 0 })
    }
    try {
      const result = action === 'download'
        ? await bridge.downloadLocalSanottsRuntime({ sourceId: speak.downloadSource })
        : action === 'cancel'
          ? await bridge.cancelLocalSanottsRuntime()
          : await bridge.deleteLocalSanottsRuntime()
      if (runtimeActionId.current !== actionId) return
      if (result.status) updateRuntime(result.status)
      if (!result.ok) {
        if (result.status?.state === 'ready') setNotice({ tone: 'error', message: result.message })
        else updateRuntime({ ...(result.status ?? initialSpeakRuntimeStatus()), state: 'error', message: result.message })
      }
    } catch (error) {
      if (runtimeActionId.current === actionId) {
        const message = error instanceof Error ? error.message : String(error)
        if (action === 'download') updateRuntime({ ...initialSpeakRuntimeStatus(), state: 'error', message })
        else {
          setNotice({ tone: 'error', message })
          await refreshStatuses()
        }
      }
    } finally {
      if (runtimeActionId.current === actionId) setRuntimeAction(null)
    }
  }

  const onDownloadVoice = async (): Promise<void> => {
    const bridge = window.kunGui
    if (!bridge) return
    const voiceId = resolvedVoiceId
    setNotice(null)
    setBusyVoices((ids) => [...ids, voiceId])
    updateVoice({ ...initialSpeakVoiceStatus(voiceId), state: 'downloading', downloadedBytes: 0 })
    try {
      const status = await bridge.downloadLocalSanottsVoice({
        voiceId,
        sourceId: speak.downloadSource
      })
      updateVoice(status)
    } catch (error) {
      updateVoice({ ...initialSpeakVoiceStatus(voiceId), state: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusyVoices((ids) => ids.filter((id) => id !== voiceId))
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
                 className={settingsButtonClass({ variant: 'danger', className: 'shrink-0' })}
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
                        voices[voice.id]?.state ?? 'not_downloaded'
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
                className={settingsButtonClass({ className: 'shrink-0' })}
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
              <button aria-busy={Boolean(previewing)}
                type="button"
                onClick={() => void onPreview()}
                title={previewing ? t('speakPreviewStop') : t('speakPreviewPlay')}
                aria-label={previewing ? t('speakPreviewStop') : t('speakPreviewPlay')}
                className={settingsButtonClass({ className: 'shrink-0' })}
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
        voiceStatus={voiceStatus}
        sourceStatuses={sourceStatuses}
        sourceCheckBusy={sourceCheckBusy}
        runtimeBusy={runtimeAction !== null}
        runtimeCanceling={runtimeAction === 'cancel'}
        voiceBusy={busyVoices.includes(resolvedVoiceId)}
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
