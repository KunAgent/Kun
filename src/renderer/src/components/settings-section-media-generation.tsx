import {
  CUSTOM_MUSIC_GENERATION_PROVIDER_ID,
  CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID,
  CUSTOM_VIDEO_GENERATION_PROVIDER_ID,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  MUSIC_GENERATION_PROTOCOLS,
  TEXT_TO_SPEECH_PROTOCOLS,
  VIDEO_GENERATION_PROTOCOLS
} from '@shared/app-settings'
import { AudioLines, Image as ImageIcon, Music2, Video } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import {
  fetchSharedModelConnectionCredentialStates,
  type SharedConnectionCredentialState
} from '../lib/provider-credential-readiness'
import {
  SettingRow,
  SettingsCard,
  SettingsTabPanel,
  SettingsTabs,
  Toggle
} from './settings-controls'
import { ImageGenerationSettingsSection } from './settings-section-image-generation'
import {
  renderApiKeyRow,
  renderAudioFormatRow,
  renderBaseUrlRow,
  renderModelRow,
  renderProviderRow,
  renderTimeoutRow,
  selectedProviderState,
  textToSpeechProtocolLabel,
  videoGenerationProtocolLabel
} from './settings-section-media-generation-rows'
import { LocalSpeechProviderSettings } from './settings-section-speak'

const AUDIO_FORMATS = ['mp3', 'wav', 'flac'] as const
const VIDEO_RESOLUTIONS = ['768P', '1080P'] as const
const GROK_VIDEO_RESOLUTIONS = ['480P', '720P'] as const
const GROK_VIDEO_DURATIONS = [6, 10] as const
const VOLCENGINE_VIDEO_RESOLUTIONS = ['480P', '720P', '1080P', '4K'] as const

const DEFAULT_TEXT_TO_SPEECH = {
  enabled: false,
  providerId: '',
  protocol: DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  baseUrl: '',
  apiKey: '',
  model: '',
  voice: '',
  format: 'mp3',
  timeoutMs: 120000
}

const DEFAULT_MUSIC_GENERATION = {
  enabled: false,
  providerId: '',
  protocol: DEFAULT_MUSIC_GENERATION_PROTOCOL,
  baseUrl: '',
  apiKey: '',
  model: '',
  format: 'mp3',
  timeoutMs: 300000
}

const DEFAULT_VIDEO_GENERATION = {
  enabled: false,
  providerId: '',
  protocol: DEFAULT_VIDEO_GENERATION_PROTOCOL,
  baseUrl: '',
  apiKey: '',
  model: '',
  defaultDuration: 6,
  defaultResolution: '1080P',
  timeoutMs: 900000,
  pollIntervalMs: 10000
}

type ProviderCapability = {
  protocol: string
  models: string[]
}

type ProviderProfile = {
  id: string
  name: string
  apiKey?: string
  textToSpeech?: ProviderCapability
  music?: ProviderCapability
  video?: ProviderCapability
}

type MediaGenerationTab = 'image' | 'speech' | 'music' | 'video'

const inputClass =
  'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
const compactInputClass =
  'w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

export function MediaGenerationSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    provider,
    kun,
    selectControlClass,
    updateKun
  } = ctx
  const textToSpeech = {
    ...DEFAULT_TEXT_TO_SPEECH,
    ...(kun.textToSpeech ?? {})
  }
  const musicGeneration = {
    ...DEFAULT_MUSIC_GENERATION,
    ...(kun.musicGeneration ?? {})
  }
  const videoGeneration = {
    ...DEFAULT_VIDEO_GENERATION,
    ...(kun.videoGeneration ?? {})
  }
  const providers = (provider?.providers ?? []) as ProviderProfile[]
  const textToSpeechProviders = providers.filter((item) => Boolean(item.textToSpeech))
  const musicProviders = providers.filter((item) => Boolean(item.music))
  const videoProviders = providers.filter((item) => Boolean(item.video))
  const [showTtsApiKey, setShowTtsApiKey] = useState(false)
  const [showMusicApiKey, setShowMusicApiKey] = useState(false)
  const [showVideoApiKey, setShowVideoApiKey] = useState(false)
  const [activeTab, setActiveTab] = useState<MediaGenerationTab>('image')
  const [connectionCredentials, setConnectionCredentials] = useState<SharedConnectionCredentialState[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchSharedModelConnectionCredentialStates()
      .then((states) => {
        if (!cancelled) setConnectionCredentials(states)
      })
      .catch(() => {
        if (!cancelled) setConnectionCredentials([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const updateTextToSpeech = (patch: Record<string, unknown>): void => {
    updateKun({
      textToSpeech: {
        ...textToSpeech,
        ...patch
      }
    })
  }
  const updateMusicGeneration = (patch: Record<string, unknown>): void => {
    updateKun({
      musicGeneration: {
        ...musicGeneration,
        ...patch
      }
    })
  }
  const updateVideoGeneration = (patch: Record<string, unknown>): void => {
    updateKun({
      videoGeneration: {
        ...videoGeneration,
        ...patch
      }
    })
  }

  const selectedTts = selectedProviderState({
    settingProviderId: textToSpeech.providerId,
    customProviderId: CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID,
    providers: textToSpeechProviders,
    capabilityKey: 'textToSpeech'
  })
  const selectedMusic = selectedProviderState({
    settingProviderId: musicGeneration.providerId,
    customProviderId: CUSTOM_MUSIC_GENERATION_PROVIDER_ID,
    providers: musicProviders,
    capabilityKey: 'music'
  })
  const selectedVideo = selectedProviderState({
    settingProviderId: videoGeneration.providerId,
    customProviderId: CUSTOM_VIDEO_GENERATION_PROVIDER_ID,
    providers: videoProviders,
    capabilityKey: 'video'
  })
  const effectiveVideoProtocol = selectedVideo.capability?.protocol ?? videoGeneration.protocol
  const isGrokVideo = effectiveVideoProtocol === 'grok-imagine-video'
  const isVolcengineVideo = effectiveVideoProtocol === 'volcengine-ark-video'
  const videoResolutionOptions: readonly string[] = isGrokVideo
    ? GROK_VIDEO_RESOLUTIONS
    : isVolcengineVideo
      ? VOLCENGINE_VIDEO_RESOLUTIONS
      : VIDEO_RESOLUTIONS
  const effectiveVideoResolution = videoResolutionOptions.includes(videoGeneration.defaultResolution)
    ? videoGeneration.defaultResolution
    : isVolcengineVideo ? '720P' : videoResolutionOptions[0]
  const effectiveVideoDuration = isGrokVideo && !GROK_VIDEO_DURATIONS.includes(
    videoGeneration.defaultDuration as 6 | 10
  )
    ? GROK_VIDEO_DURATIONS[0]
    : isVolcengineVideo
      ? Math.min(15, Math.max(4, videoGeneration.defaultDuration))
      : videoGeneration.defaultDuration

  return (
    <div className="grid gap-6">
      <SettingsTabs
        baseId="media-generation-settings"
        ariaLabel={t('mediaGeneration')}
        items={[
          { id: 'image', label: t('imageGen'), icon: ImageIcon },
          { id: 'speech', label: t('textToSpeech'), icon: AudioLines },
          { id: 'music', label: t('musicGeneration'), icon: Music2 },
          { id: 'video', label: t('videoGeneration'), icon: Video }
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      <SettingsTabPanel
        baseId="media-generation-settings"
        tabId="image"
        active={activeTab === 'image'}
      >
        <ImageGenerationSettingsSection ctx={ctx} />
      </SettingsTabPanel>

      <SettingsTabPanel
        baseId="media-generation-settings"
        tabId="speech"
        active={activeTab === 'speech'}
      >
        <SettingsCard title={t('textToSpeech')}>
        <SettingRow
          title={t('textToSpeechEnabled')}
          description={t('textToSpeechEnabledDesc')}
          control={
            <Toggle
              checked={textToSpeech.enabled}
              onChange={(enabled) => updateTextToSpeech({ enabled })}
            />
          }
        />
        {textToSpeech.enabled ? (
          <>
            {renderProviderRow({
              t,
              selectControlClass,
              title: t('textToSpeechProvider'),
              description: t('textToSpeechProviderDesc'),
              providers: textToSpeechProviders,
              selected: selectedTts,
              capabilityKey: 'textToSpeech',
              customProviderId: CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID,
              customLabel: t('textToSpeechProviderCustom'),
              missingKeyKey: 'textToSpeechProviderMissingKey',
              setting: textToSpeech,
              defaultProtocol: DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
              connectionCredentials,
              update: updateTextToSpeech
            })}
            {selectedTts.usingCustom ? (
              <>
                <SettingRow
                  title={t('textToSpeechProtocol')}
                  description={t('textToSpeechProtocolDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={textToSpeech.protocol}
                      onChange={(e) => updateTextToSpeech({ protocol: e.target.value })}
                    >
                      {TEXT_TO_SPEECH_PROTOCOLS.map((protocol) => (
                        <option key={protocol} value={protocol}>{textToSpeechProtocolLabel(t, protocol)}</option>
                      ))}
                    </select>
                  }
                />
                {renderBaseUrlRow(t, 'textToSpeech', textToSpeech.baseUrl, updateTextToSpeech)}
                {renderApiKeyRow({
                  t,
                  prefix: 'textToSpeech',
                  value: textToSpeech.apiKey,
                  visible: showTtsApiKey,
                  setVisible: setShowTtsApiKey,
                  update: updateTextToSpeech
                })}
              </>
            ) : null}
            {renderModelRow({
              t,
              selectControlClass,
              prefix: 'textToSpeech',
              usingCustom: selectedTts.usingCustom,
              model: textToSpeech.model,
              options: selectedTts.capability?.models ?? [],
              update: updateTextToSpeech
            })}
            <SettingRow
              title={t('textToSpeechVoice')}
              description={t('textToSpeechVoiceDesc')}
              control={
                <input
                  className={inputClass}
                  value={textToSpeech.voice}
                  placeholder={t('textToSpeechVoicePlaceholder')}
                  onChange={(e) => updateTextToSpeech({ voice: e.target.value })}
                />
              }
            />
            {renderAudioFormatRow(t, 'textToSpeechFormat', textToSpeech.format, updateTextToSpeech)}
            {renderTimeoutRow(t, 'textToSpeechTimeout', textToSpeech.timeoutMs, 10000, 900000, updateTextToSpeech)}
          </>
        ) : null}
        </SettingsCard>
        {/*
          Outside the toggle above: the local provider reads answers aloud in the
          chat and works whether or not the remote generate_speech tool is on.
        */}
        <LocalSpeechProviderSettings ctx={ctx} />
      </SettingsTabPanel>

      <SettingsTabPanel
        baseId="media-generation-settings"
        tabId="music"
        active={activeTab === 'music'}
      >
        <SettingsCard title={t('musicGeneration')}>
        <SettingRow
          title={t('musicGenerationEnabled')}
          description={t('musicGenerationEnabledDesc')}
          control={
            <Toggle
              checked={musicGeneration.enabled}
              onChange={(enabled) => updateMusicGeneration({ enabled })}
            />
          }
        />
        {musicGeneration.enabled ? (
          <>
            {renderProviderRow({
              t,
              selectControlClass,
              title: t('musicGenerationProvider'),
              description: t('musicGenerationProviderDesc'),
              providers: musicProviders,
              selected: selectedMusic,
              capabilityKey: 'music',
              customProviderId: CUSTOM_MUSIC_GENERATION_PROVIDER_ID,
              customLabel: t('musicGenerationProviderCustom'),
              missingKeyKey: 'musicGenerationProviderMissingKey',
              setting: musicGeneration,
              defaultProtocol: DEFAULT_MUSIC_GENERATION_PROTOCOL,
              connectionCredentials,
              update: updateMusicGeneration
            })}
            {selectedMusic.usingCustom ? (
              <>
                <SettingRow
                  title={t('musicGenerationProtocol')}
                  description={t('musicGenerationProtocolDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={musicGeneration.protocol}
                      onChange={(e) => updateMusicGeneration({ protocol: e.target.value })}
                    >
                      {MUSIC_GENERATION_PROTOCOLS.map((protocol) => (
                        <option key={protocol} value={protocol}>{t('musicGenerationProtocolMiniMax')}</option>
                      ))}
                    </select>
                  }
                />
                {renderBaseUrlRow(t, 'musicGeneration', musicGeneration.baseUrl, updateMusicGeneration)}
                {renderApiKeyRow({
                  t,
                  prefix: 'musicGeneration',
                  value: musicGeneration.apiKey,
                  visible: showMusicApiKey,
                  setVisible: setShowMusicApiKey,
                  update: updateMusicGeneration
                })}
              </>
            ) : null}
            {renderModelRow({
              t,
              selectControlClass,
              prefix: 'musicGeneration',
              usingCustom: selectedMusic.usingCustom,
              model: musicGeneration.model,
              options: selectedMusic.capability?.models ?? [],
              update: updateMusicGeneration
            })}
            {renderAudioFormatRow(t, 'musicGenerationFormat', musicGeneration.format, updateMusicGeneration)}
            {renderTimeoutRow(t, 'musicGenerationTimeout', musicGeneration.timeoutMs, 10000, 1800000, updateMusicGeneration)}
          </>
        ) : null}
        </SettingsCard>
      </SettingsTabPanel>

      <SettingsTabPanel
        baseId="media-generation-settings"
        tabId="video"
        active={activeTab === 'video'}
      >
        <SettingsCard title={t('videoGeneration')}>
        <SettingRow
          title={t('videoGenerationEnabled')}
          description={t('videoGenerationEnabledDesc')}
          control={
            <Toggle
              checked={videoGeneration.enabled}
              onChange={(enabled) => updateVideoGeneration({ enabled })}
            />
          }
        />
        {videoGeneration.enabled ? (
          <>
            {renderProviderRow({
              t,
              selectControlClass,
              title: t('videoGenerationProvider'),
              description: t('videoGenerationProviderDesc'),
              providers: videoProviders,
              selected: selectedVideo,
              capabilityKey: 'video',
              customProviderId: CUSTOM_VIDEO_GENERATION_PROVIDER_ID,
              customLabel: t('videoGenerationProviderCustom'),
              missingKeyKey: 'videoGenerationProviderMissingKey',
              setting: videoGeneration,
              defaultProtocol: DEFAULT_VIDEO_GENERATION_PROTOCOL,
              connectionCredentials,
              update: updateVideoGeneration
            })}
            {selectedVideo.usingCustom ? (
              <>
                <SettingRow
                  title={t('videoGenerationProtocol')}
                  description={t('videoGenerationProtocolDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={videoGeneration.protocol}
                      onChange={(e) => updateVideoGeneration({ protocol: e.target.value })}
                    >
                      {VIDEO_GENERATION_PROTOCOLS.map((protocol) => (
                        <option key={protocol} value={protocol}>{videoGenerationProtocolLabel(t, protocol)}</option>
                      ))}
                    </select>
                  }
                />
                {renderBaseUrlRow(t, 'videoGeneration', videoGeneration.baseUrl, updateVideoGeneration)}
                {renderApiKeyRow({
                  t,
                  prefix: 'videoGeneration',
                  value: videoGeneration.apiKey,
                  visible: showVideoApiKey,
                  setVisible: setShowVideoApiKey,
                  update: updateVideoGeneration
                })}
              </>
            ) : null}
            {renderModelRow({
              t,
              selectControlClass,
              prefix: 'videoGeneration',
              usingCustom: selectedVideo.usingCustom,
              model: videoGeneration.model,
              options: selectedVideo.capability?.models ?? [],
              update: updateVideoGeneration
            })}
            <SettingRow
              title={t('videoGenerationDefaultDuration')}
              description={t('videoGenerationDefaultDurationDesc')}
              control={
                isGrokVideo ? (
                  <select
                    className={`${selectControlClass} md:max-w-[160px]`}
                    value={effectiveVideoDuration}
                    onChange={(e) => updateVideoGeneration({ defaultDuration: Number(e.target.value) })}
                  >
                    {GROK_VIDEO_DURATIONS.map((duration) => (
                      <option key={duration} value={duration}>{duration}s</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    min={isVolcengineVideo ? 4 : 1}
                    max={isVolcengineVideo ? 15 : 30}
                    step={1}
                    className={compactInputClass}
                    value={effectiveVideoDuration}
                    onChange={(e) => updateVideoGeneration({ defaultDuration: Number(e.target.value) })}
                  />
                )
              }
            />
            <SettingRow
              title={t('videoGenerationDefaultResolution')}
              description={t('videoGenerationDefaultResolutionDesc')}
              control={
                <select
                  className={`${selectControlClass} md:max-w-[160px]`}
                  value={effectiveVideoResolution}
                  onChange={(e) => updateVideoGeneration({ defaultResolution: e.target.value })}
                >
                  {videoResolutionOptions.map((resolution) => (
                    <option key={resolution} value={resolution}>{resolution}</option>
                  ))}
                </select>
              }
            />
            {renderTimeoutRow(t, 'videoGenerationTimeout', videoGeneration.timeoutMs, 30000, 3600000, updateVideoGeneration)}
            <SettingRow
              title={t('videoGenerationPollInterval')}
              description={t('videoGenerationPollIntervalDesc')}
              control={
                <input
                  type="number"
                  min={1000}
                  max={120000}
                  step={1000}
                  className={compactInputClass}
                  value={videoGeneration.pollIntervalMs}
                  onChange={(e) => updateVideoGeneration({ pollIntervalMs: Number(e.target.value) })}
                />
              }
            />
          </>
        ) : null}
        </SettingsCard>
      </SettingsTabPanel>
    </div>
  )
}
