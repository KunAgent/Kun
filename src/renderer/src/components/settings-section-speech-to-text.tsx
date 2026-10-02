import { settingsButtonClass } from './settings-button'
import {
  CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID,
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  resolveKunSpeechToTextSettings
} from '@shared/app-settings'
import {
  LOCAL_WHISPER_DEFAULT_DOWNLOAD_SOURCE_ID,
  LOCAL_WHISPER_DEFAULT_MODEL_ID,
  LOCAL_WHISPER_MODELS,
  LOCAL_WHISPER_PROVIDER_ID,
  localWhisperModelById,
  type LocalWhisperDownloadSourceStatus,
  type LocalWhisperModelId,
  type LocalWhisperModelStatus
} from '@shared/local-whisper'
import { Loader2, Mic, PlugZap, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import {
  fetchSharedModelConnectionCredentialStates,
  shouldWarnMissingProviderCredential,
  type SharedConnectionCredentialState
} from '../lib/provider-credential-readiness'
import {
  AdvancedSettingsDisclosure,
  InlineNoticeView,
  SecretInput,
  SettingRow,
  SettingsCard,
  SettingsTabPanel,
  SettingsTabs,
  Toggle,
  type InlineNotice
} from './settings-controls'
import { SpeechToTextModelPanel } from './settings-section-speech-to-text-model'
import {
  CUSTOM_SPEECH_PROTOCOLS, DEFAULT_SPEECH_TO_TEXT,
  buildTestToneWavBase64,
  speechProtocolLabel, supportsSpeechProvider
} from './settings-section-speech-to-text-support'

type SpeechToTextSettingsTab = 'provider' | 'model' | 'advanced'


export function SpeechToTextSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    form,
    provider,
    kun,
    selectControlClass,
    updateKun
  } = ctx
  const speechToText = {
    ...DEFAULT_SPEECH_TO_TEXT,
    ...(kun.speechToText ?? {})
  }
  const effectiveSpeechToText = form
    ? resolveKunSpeechToTextSettings(form)
    : speechToText
  const speechProviders = (provider?.providers ?? []).filter(supportsSpeechProvider)
  const selectedProviderId = speechToText.protocol === 'local-whisper'
    ? LOCAL_WHISPER_PROVIDER_ID
    : speechToText.providerId || CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID
  const usingLocalWhisper = selectedProviderId === LOCAL_WHISPER_PROVIDER_ID || speechToText.protocol === 'local-whisper'
  const selectedSpeechProvider = speechProviders.find((item: { id: string }) => item.id === selectedProviderId)
  const usingCustomProvider =
    !usingLocalWhisper && (selectedProviderId === CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID || !selectedSpeechProvider)
  const selectedProviderSpeech = selectedSpeechProvider?.speech
  const selectedLocalWhisperModel = localWhisperModelById(
    usingLocalWhisper ? speechToText.model : LOCAL_WHISPER_DEFAULT_MODEL_ID
  )
  const selectedLocalWhisperModelId = selectedLocalWhisperModel.id
  const speechModelOptions = usingLocalWhisper
    ? LOCAL_WHISPER_MODELS.map((model) => model.id)
    : usingCustomProvider
    ? []
    : selectedProviderSpeech?.models ?? []
  const [activeTab, setActiveTab] = useState<SpeechToTextSettingsTab>('provider')
  const [showSpeechApiKey, setShowSpeechApiKey] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'busy' | InlineNotice>('idle')
  const [localWhisperStatuses, setLocalWhisperStatuses] = useState<Partial<Record<LocalWhisperModelId, LocalWhisperModelStatus>>>({})
  const [localWhisperBusy, setLocalWhisperBusy] = useState<'idle' | 'download' | 'cancel' | 'delete'>('idle')
  const [localWhisperNotice, setLocalWhisperNotice] = useState<InlineNotice | null>(null)
  const [localWhisperSourceStatuses, setLocalWhisperSourceStatuses] = useState<LocalWhisperDownloadSourceStatus[] | null>(null)
  const [localWhisperSourceCheckBusy, setLocalWhisperSourceCheckBusy] = useState(false)
  const [connectionCredentials, setConnectionCredentials] = useState<SharedConnectionCredentialState[] | null>(null)
  const localWhisperStatus = localWhisperStatuses[selectedLocalWhisperModelId] ?? null
  const warnMissingSpeechProviderKey = shouldWarnMissingProviderCredential({
    usingCustomProvider: usingLocalWhisper || usingCustomProvider,
    protocolExempt: selectedProviderSpeech?.protocol === 'gemini-cli-audio',
    provider: selectedSpeechProvider,
    connectionCredentials
  })

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
  const updateSpeechToText = (patch: Record<string, unknown>): void => {
    updateKun({
      speechToText: {
        ...speechToText,
        ...patch
      }
    })
  }

  const setLocalWhisperModelStatus = useCallback((status: LocalWhisperModelStatus): void => {
    setLocalWhisperStatuses((current) => ({
      ...current,
      [status.modelId]: status
    }))
  }, [])

  const refreshLocalWhisperStatus = useCallback(async (
    modelId: LocalWhisperModelId = selectedLocalWhisperModelId
  ): Promise<void> => {
    if (typeof window.kunGui?.getLocalWhisperModelStatus !== 'function') return
    const status = await window.kunGui.getLocalWhisperModelStatus(modelId)
    setLocalWhisperModelStatus(status)
  }, [selectedLocalWhisperModelId, setLocalWhisperModelStatus])

  const refreshLocalWhisperModelStatuses = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.getLocalWhisperModelStatus !== 'function') return
    const statuses = await Promise.all(
      LOCAL_WHISPER_MODELS.map((model) => window.kunGui.getLocalWhisperModelStatus(model.id))
    )
    setLocalWhisperStatuses((current) => {
      const next = { ...current }
      for (const status of statuses) next[status.modelId] = status
      return next
    })
  }, [])

  const refreshLocalWhisperSourceStatuses = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.checkLocalWhisperDownloadSources !== 'function') return
    setLocalWhisperSourceStatuses(null)
    setLocalWhisperSourceCheckBusy(true)
    try {
      const result = await window.kunGui.checkLocalWhisperDownloadSources({ modelId: selectedLocalWhisperModelId })
      setLocalWhisperSourceStatuses(result.sources)
    } finally {
      setLocalWhisperSourceCheckBusy(false)
    }
  }, [selectedLocalWhisperModelId])

  useEffect(() => {
    if (!usingLocalWhisper) return
    void refreshLocalWhisperModelStatuses().catch(() => undefined)
    void refreshLocalWhisperSourceStatuses().catch(() => undefined)
    if (typeof window.kunGui?.onLocalWhisperModelProgress !== 'function') return
    return window.kunGui.onLocalWhisperModelProgress((progress) => {
      const model = localWhisperModelById(progress.modelId)
      setLocalWhisperStatuses((current) => {
        const existing = current[progress.modelId]
        return {
          ...current,
          [progress.modelId]: {
            modelId: progress.modelId,
            label: existing?.label ?? model.label,
            fileName: existing?.fileName ?? model.fileName,
            source: existing?.source ?? model.source,
            license: existing?.license ?? model.license,
            sha256: existing?.sha256 ?? model.sha256,
            sizeBytes: existing?.sizeBytes ?? model.sizeBytes,
            maxBytes: existing?.maxBytes ?? model.maxBytes,
            resourceTier: existing?.resourceTier ?? model.resourceTier,
            resourceEstimate: existing?.resourceEstimate ?? model.resourceEstimate,
            qualityTier: existing?.qualityTier ?? model.qualityTier,
            recommended: existing?.recommended ?? model.recommended,
            state: 'downloading',
            downloadedBytes: progress.downloadedBytes,
            totalBytes: progress.totalBytes,
            speedBytesPerSecond: progress.speedBytesPerSecond,
            path: existing?.path
          }
        }
      })
    })
  }, [refreshLocalWhisperModelStatuses, refreshLocalWhisperSourceStatuses, usingLocalWhisper])

  useEffect(() => {
    if (!usingLocalWhisper) return
    void refreshLocalWhisperStatus(selectedLocalWhisperModelId).catch(() => undefined)
  }, [refreshLocalWhisperStatus, selectedLocalWhisperModelId, usingLocalWhisper])

  const downloadLocalWhisper = async (): Promise<void> => {
    if (typeof window.kunGui?.downloadLocalWhisperModel !== 'function') return
    setLocalWhisperNotice(null)
    setLocalWhisperBusy('download')
    try {
      const result = await window.kunGui.downloadLocalWhisperModel({
        modelId: selectedLocalWhisperModelId,
        sourceId: speechToText.localWhisperDownloadSource
      })
      if (result.status) setLocalWhisperModelStatus(result.status)
      if (!result.ok) {
        setLocalWhisperNotice({ tone: 'error', message: t('speechToTextLocalDownloadFailed', { message: result.message }) })
      }
    } finally {
      setLocalWhisperBusy('idle')
    }
  }

  const cancelLocalWhisper = async (): Promise<void> => {
    if (typeof window.kunGui?.cancelLocalWhisperModel !== 'function') return
    setLocalWhisperNotice(null)
    setLocalWhisperBusy('cancel')
    try {
      const result = await window.kunGui.cancelLocalWhisperModel(selectedLocalWhisperModelId)
      if (result.status) setLocalWhisperModelStatus(result.status)
      if (!result.ok) {
        setLocalWhisperNotice({ tone: 'error', message: t('speechToTextLocalCancelFailed', { message: result.message }) })
      }
    } finally {
      setLocalWhisperBusy('idle')
    }
  }

  const deleteLocalWhisper = async (): Promise<void> => {
    if (typeof window.kunGui?.deleteLocalWhisperModel !== 'function') return
    if (!window.confirm(t('speechToTextLocalDeleteConfirm', { model: selectedLocalWhisperModel.shortName }))) return
    setLocalWhisperNotice(null)
    setLocalWhisperBusy('delete')
    try {
      const result = await window.kunGui.deleteLocalWhisperModel(selectedLocalWhisperModelId)
      if (result.status) setLocalWhisperModelStatus(result.status)
      if (!result.ok) {
        setLocalWhisperNotice({ tone: 'error', message: t('speechToTextLocalDeleteFailed', { message: result.message }) })
      }
    } finally {
      setLocalWhisperBusy('idle')
    }
  }

  const runSpeechTest = async (): Promise<void> => {
    if (typeof window.kunGui?.transcribeSpeech !== 'function') return
    setTestState('busy')
    try {
      const result = await window.kunGui.transcribeSpeech({
        audioBase64: buildTestToneWavBase64(),
        mimeType: 'audio/wav',
        durationMs: 500,
        speechToText: effectiveSpeechToText
      })
      if (result.ok) {
        setTestState({ tone: 'success', message: t('speechToTextTestSuccess', { text: result.text }) })
      } else if (result.message === 'transcription result is empty') {
        // 测试音是一段正弦音,模型可能返回空转写——鉴权和链路本身是通的。
        setTestState({ tone: 'success', message: t('speechToTextTestEmptyOk') })
      } else {
        setTestState({ tone: 'error', message: t('speechToTextTestFailed', { message: result.message }) })
      }
    } catch (error) {
      setTestState({
        tone: 'error',
        message: t('speechToTextTestFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }
  }

  return (
    <div className="space-y-5">
      <SettingsTabs<SpeechToTextSettingsTab>
        baseId="speech-to-text-settings"
        ariaLabel={t('speechToText')}
        items={[
          { id: 'provider', label: t('speechToTextProvider'), icon: PlugZap },
          { id: 'model', label: t('speechToTextModel'), icon: Mic },
          { id: 'advanced', label: t('speechToTextAdvanced'), icon: SlidersHorizontal }
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      <SettingsTabPanel
        baseId="speech-to-text-settings"
        tabId="provider"
        active={activeTab === 'provider'}
      >
        <SettingsCard title={t('speechToTextProvider')}>
          <SettingRow
            title={t('speechToTextEnabled')}
            description={t('speechToTextEnabledDesc')}
            control={
              <Toggle
                checked={speechToText.enabled}
                onChange={(enabled) => {
                  // 首次开启时直接选中本地 Whisper,
                  // 避免落进字段全空的「自定义」模式。providerId 为空但已填过
                  // baseUrl/key/model 说明用户在用隐式自定义配置,不能覆盖。
                  const customUntouched =
                    !speechToText.baseUrl.trim() && !speechToText.apiKey.trim() && !speechToText.model.trim()
                  if (enabled && !speechToText.providerId.trim() && customUntouched) {
                    updateSpeechToText({
                      enabled,
                      providerId: LOCAL_WHISPER_PROVIDER_ID,
                      baseUrl: '',
                      apiKey: '',
                      protocol: 'local-whisper',
                      model: LOCAL_WHISPER_DEFAULT_MODEL_ID,
                      localWhisperDownloadSource: LOCAL_WHISPER_DEFAULT_DOWNLOAD_SOURCE_ID
                    })
                    return
                  }
                  updateSpeechToText({ enabled })
                }}
              />
            }
          />
          {speechToText.enabled ? (
            <>
          <SettingRow
            title={t('speechToTextProvider')}
            description={t('speechToTextProviderDesc')}
            control={
              <div className="w-full min-w-0 md:max-w-md">
                <select
                  className={selectControlClass}
                  value={usingCustomProvider ? CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID : selectedProviderId}
                  onChange={(e) => {
                    const providerId = e.target.value
                    if (providerId === LOCAL_WHISPER_PROVIDER_ID) {
                      updateSpeechToText({
                        providerId,
                        baseUrl: '',
                        apiKey: '',
                        protocol: 'local-whisper',
                        model: LOCAL_WHISPER_DEFAULT_MODEL_ID,
                        localWhisperDownloadSource: speechToText.localWhisperDownloadSource || LOCAL_WHISPER_DEFAULT_DOWNLOAD_SOURCE_ID
                      })
                      return
                    }
                    const nextProvider = speechProviders.find((item: { id: string }) => item.id === providerId)
                    updateSpeechToText({
                      providerId,
                      baseUrl: providerId === CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID ? speechToText.baseUrl : '',
                      apiKey: providerId === CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID ? speechToText.apiKey : '',
                      protocol: providerId === CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID
                        ? speechToText.protocol
                        : nextProvider?.speech?.protocol ?? DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
                      model: providerId === CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID
                        ? speechToText.model
                        : nextProvider?.speech?.models?.[0] ?? ''
                    })
                  }}
                >
                  <option value={LOCAL_WHISPER_PROVIDER_ID}>{t('speechToTextProviderLocalWhisper')}</option>
                  {speechProviders.map((item: { id: string; name: string }) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                  <option value={CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID}>{t('speechToTextProviderCustom')}</option>
                </select>
                {warnMissingSpeechProviderKey ? (
                  <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">
                    {t('speechToTextProviderMissingKey', { provider: selectedSpeechProvider?.name ?? selectedProviderId })}
                  </p>
                ) : null}
              </div>
            }
          />
          {usingCustomProvider ? (
            <>
              <SettingRow
                title={t('speechToTextProtocol')}
                description={t('speechToTextProtocolDesc')}
                control={
                  <select
                    className={selectControlClass}
                    value={speechToText.protocol}
                    onChange={(e) => updateSpeechToText({ protocol: e.target.value })}
                  >
                    {CUSTOM_SPEECH_PROTOCOLS.map((protocol) => (
                      <option key={protocol} value={protocol}>
                        {speechProtocolLabel(t, protocol)}
                      </option>
                    ))}
                  </select>
                }
              />
              <SettingRow
                title={t('speechToTextBaseUrl')}
                description={t('speechToTextBaseUrlDesc')}
                control={
                  <input
                    className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                    value={speechToText.baseUrl}
                    placeholder={t('speechToTextBaseUrlPlaceholder')}
                    onChange={(e) => updateSpeechToText({ baseUrl: e.target.value })}
                  />
                }
              />
              <SettingRow
                title={t('speechToTextApiKey')}
                description={t('speechToTextApiKeyDesc')}
                control={
                  <SecretInput
                    value={speechToText.apiKey}
                    onChange={(value) => updateSpeechToText({ apiKey: value })}
                    visible={showSpeechApiKey}
                    onToggleVisibility={() => setShowSpeechApiKey((value) => !value)}
                    autoComplete="off"
                    showLabel={t('showSecret')}
                    hideLabel={t('hideSecret')}
                    className="md:max-w-md"
                  />
                }
              />
            </>
          ) : null}
            </>
          ) : null}
        </SettingsCard>
      </SettingsTabPanel>

      <SpeechToTextModelPanel view={{
        t, speechToText, usingLocalWhisper, selectControlClass, updateSpeechToText,
        localWhisperSourceCheckBusy, localWhisperSourceStatuses, selectedLocalWhisperModel,
        selectedLocalWhisperModelId, localWhisperStatuses, refreshLocalWhisperStatus,
        setLocalWhisperNotice, localWhisperStatus, localWhisperNotice, localWhisperBusy,
        downloadLocalWhisper, cancelLocalWhisper, deleteLocalWhisper, usingCustomProvider,
        speechModelOptions, activeTab
      }} />

      <SettingsTabPanel
        baseId="speech-to-text-settings"
        tabId="advanced"
        active={activeTab === 'advanced'}
      >
        {speechToText.enabled ? (
          <SettingsCard title={t('speechToTextAdvanced')}>
          <div className="px-3 py-4">
            <AdvancedSettingsDisclosure
              title={t('speechToTextAdvanced')}
              description={t('speechToTextAdvancedDesc')}
            >
              <div className="divide-y divide-ds-border-muted">
                <SettingRow
                  title={t('speechToTextTimeout')}
                  description={t('speechToTextTimeoutDesc')}
                  control={
                    <input
                      type="number"
                      min={5000}
                      max={600000}
                      step={5000}
                      className="w-32 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      value={speechToText.timeoutMs}
                      onChange={(e) => updateSpeechToText({ timeoutMs: Number(e.target.value) })}
                    />
                  }
                />
              </div>
            </AdvancedSettingsDisclosure>
          </div>
          <SettingRow
            title={t('speechToTextTest')}
            description={t('speechToTextTestDesc')}
            control={
              <div className="flex w-full min-w-0 flex-col gap-2 md:max-w-md">
                <button aria-busy={Boolean(testState === 'busy')}
                  type="button"
                  disabled={testState === 'busy'}
                  onClick={() => void runSpeechTest()}
                  className={settingsButtonClass({ className: 'w-fit' })}
                >
                  {testState === 'busy'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                    : <PlugZap className="h-3.5 w-3.5" strokeWidth={1.9} />}
                  {testState === 'busy' ? t('speechToTextTesting') : t('speechToTextTestAction')}
                </button>
                {typeof testState === 'object' ? <InlineNoticeView notice={testState} /> : null}
              </div>
            }
          />
          </SettingsCard>
        ) : null}
      </SettingsTabPanel>
    </div>
  )
}
