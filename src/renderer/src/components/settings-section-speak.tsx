import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Loader2, Play, Square, Volume2 } from 'lucide-react'
import {
  LOCAL_KOKORO_DEFAULT_MODEL_ID,
  localKokoroModelById,
  type LocalKokoroDownloadSourceStatus,
  type LocalKokoroModelId,
  type LocalKokoroModelStatus
} from '@shared/local-kokoro'
import {
  LOCAL_KOKORO_DEFAULT_VOICE_ID,
  localKokoroVoiceById,
  type LocalKokoroVoiceId
} from '@shared/local-kokoro-voices'
import {
  InlineNoticeView,
  SettingRow,
  SettingsCard,
  Toggle,
  type InlineNotice
} from './settings-controls'
import { SpeakModelPanel } from './settings-section-speak-model'
import {
  SPEAK_ACCENT_FILTERS,
  SPEAK_PREVIEW_SAMPLE_TEXT,
  SPEAK_SPEED_MAX,
  SPEAK_SPEED_MIN,
  SPEAK_SPEED_STEP,
  clampSpeakSpeed,
  formatSpeakSpeed,
  speakAccentLabel,
  speakVoiceGroups,
  speakVoiceOptionLabel,
  type SpeakAccentFilter
} from './settings-section-speak-support'
import { useSpeakStore } from '../stores/speak-store'
import { refreshSpeakTrackKeys, useSpeakTrackStore } from '../stores/speak-track-store'
import { formatBytes } from './settings-section-speech-to-text-support'
import type { LocalKokoroTrackUsage } from '@shared/local-kokoro-tracks'
import { previewKokoroVoice, stopSpeaking } from './chat/speak-controller'
import { speakErrorLabel } from './chat/AssistantSpeakButton'

const DEFAULT_SPEAK = {
  enabled: true,
  model: LOCAL_KOKORO_DEFAULT_MODEL_ID as LocalKokoroModelId,
  voice: LOCAL_KOKORO_DEFAULT_VOICE_ID as LocalKokoroVoiceId,
  speed: 1,
  downloadSource: 'huggingface',
  autoDownload: true,
  keepTracks: false
}

/**
 * Local speech provider: the on-device Kokoro voice behind the Speak action.
 *
 * Rendered inside Media -> Speech generation beside the remote speech provider,
 * so both ways of producing speech are configured in one place.
 */
export function LocalSpeechProviderSettings({ ctx }: { ctx: Record<string, any> }): ReactElement {
  // Speak playback errors are authored in the common namespace shared with
  // the answer action, so they are translated with tCommon.
  const { t, tCommon, kun, updateKun, selectControlClass } = ctx
  const speak = useMemo(() => ({ ...DEFAULT_SPEAK, ...(kun.speak ?? {}) }), [kun.speak])
  const speakPhase = useSpeakStore((state) => state.phase)
  const speakError = useSpeakStore((state) => state.error)
  const trackKeys = useSpeakTrackStore((state) => state.keys)
  const [statuses, setStatuses] = useState<Partial<Record<LocalKokoroModelId, LocalKokoroModelStatus>>>({})
  const [readyVoices, setReadyVoices] = useState<LocalKokoroVoiceId[]>([])
  const [sourceStatuses, setSourceStatuses] = useState<LocalKokoroDownloadSourceStatus[] | null>(null)
  const [sourceCheckBusy, setSourceCheckBusy] = useState(false)
  const [busyModelId, setBusyModelId] = useState<LocalKokoroModelId | null>(null)
  const [trackUsage, setTrackUsage] = useState<LocalKokoroTrackUsage | null>(null)
  const [clearingTracks, setClearingTracks] = useState(false)
  const [notice, setNotice] = useState<InlineNotice | null>(null)
  const [accentFilter, setAccentFilter] = useState<SpeakAccentFilter>('all')
  const [sampleText, setSampleText] = useState(SPEAK_PREVIEW_SAMPLE_TEXT)

  const updateSpeak = useCallback(
    (patch: Record<string, unknown>): void => {
      if (patch.enabled === false) stopSpeaking()
      updateKun({ speak: { ...speak, ...patch } })
    },
    [speak, updateKun]
  )

  const refreshStatuses = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.listLocalKokoroModelStatuses !== 'function') return
    const [models, voices] = await Promise.all([
      window.kunGui.listLocalKokoroModelStatuses(),
      window.kunGui.listDownloadedLocalKokoroVoices()
    ])
    setStatuses(Object.fromEntries(models.map((status) => [status.modelId, status])))
    setReadyVoices(voices)
  }, [])

  useEffect(() => {
    void refreshStatuses().catch(() => undefined)
  }, [refreshStatuses])

  // Poll only while something is downloading; progress events also arrive but
  // the settings panel can be opened mid-download.
  useEffect(() => {
    if (typeof window.kunGui?.onLocalKokoroModelProgress !== 'function') return
    return window.kunGui.onLocalKokoroModelProgress(() => {
      void refreshStatuses().catch(() => undefined)
    })
  }, [refreshStatuses])

  useEffect(() => {
    if (typeof window.kunGui?.checkLocalKokoroDownloadSources !== 'function') return
    let canceled = false
    setSourceCheckBusy(true)
    void window.kunGui
      .checkLocalKokoroDownloadSources({ modelId: speak.model })
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
  }, [speak.model])

  const voiceGroups = useMemo(() => {
    const groups = speakVoiceGroups(accentFilter)
    const selected = localKokoroVoiceById(speak.voice)
    if (!groups.some(group => group.voices.some(voice => voice.id === selected.id))) {
      groups.push({ accent: selected.accent, voices: [selected] })
    }
    return groups
  }, [accentFilter, speak.voice])
  const previewing = speakPhase !== 'idle'

  const runModelAction = async (
    modelId: LocalKokoroModelId,
    action: 'download' | 'cancel' | 'delete'
  ): Promise<void> => {
    const bridge = window.kunGui
    if (!bridge) return
    setNotice(null)
    setBusyModelId(modelId)
    try {
      if (action === 'download') {
        const result = await bridge.downloadLocalKokoroModel({
          modelId,
          sourceId: speak.downloadSource
        })
        if (!result.ok) setNotice({ tone: 'error', message: result.message })
      } else if (action === 'cancel') {
        await bridge.cancelLocalKokoroModel(modelId)
      } else {
        const result = await bridge.deleteLocalKokoroModel(modelId)
        if (!result.ok) setNotice({ tone: 'error', message: result.message })
      }
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusyModelId(null)
      await refreshStatuses().catch(() => undefined)
    }
  }

  const onPreview = async (): Promise<void> => {
    if (previewing) {
      stopSpeaking()
      return
    }
    setNotice(null)
    const result = await previewKokoroVoice(
      {
        enabled: speak.enabled,
        model: speak.model,
        voice: speak.voice,
        speed: clampSpeakSpeed(speak.speed),
        downloadSource: speak.downloadSource,
        autoDownload: speak.autoDownload,
        // The preview is a throwaway sample, never worth storing.
        keepTracks: false
      },
      sampleText.trim() || SPEAK_PREVIEW_SAMPLE_TEXT
    )
    if (!result.ok && result.message) {
      setNotice({ tone: 'error', message: speakErrorLabel(tCommon, result.message) })
    }
    await refreshStatuses().catch(() => undefined)
  }

  const refreshTrackUsage = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.getLocalKokoroTrackUsage !== 'function') return
    setTrackUsage(await window.kunGui.getLocalKokoroTrackUsage().catch(() => null))
  }, [])

  useEffect(() => {
    void refreshTrackUsage()
  }, [refreshTrackUsage, speak.keepTracks, trackKeys])

  const onClearTracks = async (): Promise<void> => {
    if (typeof window.kunGui?.clearLocalKokoroTracks !== 'function') return
    setClearingTracks(true)
    try {
      setTrackUsage(await window.kunGui.clearLocalKokoroTracks())
      useSpeakTrackStore.getState().clearKeys()
      refreshSpeakTrackKeys()
    } finally {
      setClearingTracks(false)
    }
  }

  const selectedModel = localKokoroModelById(speak.model)
  const selectedVoice = localKokoroVoiceById(speak.voice)

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
            model: selectedModel.label,
            voice: selectedVoice.label,
            speed: formatSpeakSpeed(speak.speed)
          })}</span>
        </div>
        <p className="text-[11.5px] leading-4 text-ds-faint">{t('speakEnglishOnlyNote')}</p>
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
          title={t('speakAccent')}
          description={t('speakAccentDesc')}
          control={
            <select
              className={selectControlClass}
              aria-label={t('speakAccent')}
              value={accentFilter}
              onChange={(event) => setAccentFilter(event.target.value as SpeakAccentFilter)}
            >
              {SPEAK_ACCENT_FILTERS.map((filter) => (
                <option key={filter} value={filter}>
                  {speakAccentLabel(t, filter)}
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
              onChange={(event) => updateSpeak({ voice: event.target.value })}
            >
              {voiceGroups.map((group) => (
                <optgroup key={group.accent} label={speakAccentLabel(t, group.accent)}>
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

      <SpeakModelPanel
        t={t}
        selectControlClass={selectControlClass}
        downloadSource={speak.downloadSource}
        autoDownload={speak.autoDownload}
        selectedModelId={speak.model}
        statuses={statuses}
        sourceStatuses={sourceStatuses}
        sourceCheckBusy={sourceCheckBusy}
        busyModelId={busyModelId}
        notice={null}
        onSelectModel={(modelId) => updateSpeak({ model: modelId })}
        onSelectDownloadSource={(sourceId) => updateSpeak({ downloadSource: sourceId })}
        onToggleAutoDownload={(autoDownload) => updateSpeak({ autoDownload })}
        onDownload={(modelId) => void runModelAction(modelId, 'download')}
        onCancel={(modelId) => void runModelAction(modelId, 'cancel')}
        onDelete={(modelId) => void runModelAction(modelId, 'delete')}
      />
    </div>
  )
}
