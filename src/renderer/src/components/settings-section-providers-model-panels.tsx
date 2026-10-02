import { settingsButtonClass } from './settings-button'
import type {
  ImageGenerationProtocol,
  MusicGenerationProtocol,
  SpeechToTextProtocol,
  TextToSpeechProtocol,
  VideoGenerationProtocol
} from '@shared/app-settings'
import {
  AudioLines,
  Clapperboard,
  Download,
  Image as ImageIcon,
  Loader2,
  Mic,
  Music2
} from 'lucide-react'
import {
  type ReactElement
} from 'react'
import {
  SettingsTabPanel
} from './settings-controls'
import { ProviderModelsManager } from './settings-section-provider-models'
import {
  CapabilitySection, DetailSection, ModelChipsInput,
  fieldLabelClass,
  textInputClass
} from './settings-section-providers-controls'
import {
  IMAGE_GENERATION_PROTOCOL_LABEL_KEYS,
  MUSIC_GENERATION_PROTOCOL_LABEL_KEYS,
  SPEECH_TO_TEXT_PROTOCOL_LABEL_KEYS,
  TEXT_TO_SPEECH_PROTOCOL_LABEL_KEYS,
  VIDEO_GENERATION_PROTOCOL_LABEL_KEYS,
  defaultImageCapability, defaultMusicCapability,
  defaultSpeechCapability, defaultTextToSpeechCapability, defaultVideoCapability,
  presetImageCapability, presetMusicCapability,
  presetSpeechCapability, presetTextToSpeechCapability, presetVideoCapability,
  providerModelCount,
  type ProviderTaskTab
} from './settings-section-providers-profile'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'







export function ProviderModelsCapabilitiesPanels({ view }: { view: Record<string, any> }): ReactElement {
  const { t, selectControlClass, activeTab, expandedCapabilities, activeProvider, saveIssue, isDraftActive, setCapabilityExpanded, updateModelProvider, updateModelProviderImage, removeModelProviderImage, updateModelProviderSpeech, removeModelProviderSpeech, updateModelProviderTextToSpeech, removeModelProviderTextToSpeech, updateModelProviderMusic, removeModelProviderMusic, updateModelProviderVideo, removeModelProviderVideo, activeImageBaseUrlInvalid, activeSpeechBaseUrlInvalid, activeSpeechToggleDisabled, activeTextToSpeechBaseUrlInvalid, activeMusicBaseUrlInvalid, activeVideoBaseUrlInvalid, openModelImport, probeBusy, activeProbeBlocked, runProbe, activeProbe, patchProviderProfile } = view
  return (
    <>
                <SettingsTabPanel<ProviderTaskTab>
                  baseId="provider-settings"
                  tabId="models"
                  active={activeTab === 'models'}
                  className="grid gap-4"
                >
                <DetailSection
                  title={`${t('modelProviderModels')} · ${providerModelCount(activeProvider)}`}
                  action={
                    <button aria-busy={Boolean(probeBusy && activeProbe?.mode === 'fetch')} className={settingsButtonClass()}
                      type="button"
                      disabled={probeBusy || activeProbeBlocked}
                      onClick={() => void runProbe(activeProvider, 'fetch')}
                    >
                      {probeBusy && activeProbe?.mode === 'fetch'
                        ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.9} />
                        : <Download className="h-3 w-3" strokeWidth={1.9} />}
                      {t('modelProviderFetchModels')}
                    </button>
                  }
                >
                  <ProviderModelsManager
                    key={activeProvider.id}
                    provider={activeProvider}
                    t={t}
                    selectControlClass={selectControlClass}
                    focusModelId={saveIssue?.providerId === activeProvider.id ? saveIssue.modelId : undefined}
                    onChange={(next) => patchProviderProfile(activeProvider, () => next)}
                  />
                </DetailSection>
                </SettingsTabPanel>
                <SettingsTabPanel<ProviderTaskTab>
                  baseId="provider-settings"
                  tabId="capabilities"
                  active={activeTab === 'capabilities'}
                  className="grid gap-3"
                >
                <CapabilitySection
                  capabilityId="image"
                  icon={<ImageIcon className="h-4 w-4" strokeWidth={1.9} />}
                  title={t('modelProviderImageCapability')}
                  description={t('modelProviderImageCapabilityDesc')}
                  enabled={Boolean(activeProvider.image)}
                  invalid={activeImageBaseUrlInvalid}
                  expanded={expandedCapabilities.has('image')}
                  modelCountLabel={activeProvider.image?.models.length
                    ? t('modelProviderModelCount', { total: activeProvider.image.models.length })
                    : undefined}
                  configureLabel={t('modelProviderCapabilityConfigure')}
                  collapseLabel={t('modelProviderCapabilityCollapse')}
                  enabledLabel={t('modelProviderCapabilityEnabled')}
                  disabledLabel={t('modelProviderCapabilityDisabled')}
                  needsConfigurationLabel={t('modelProviderNeedsConfiguration')}
                  onExpandedChange={(expanded) => setCapabilityExpanded('image', expanded)}
                  onToggle={(value) => {
                    if (value) {
                      updateModelProvider(activeProvider.id, {
                        image: presetImageCapability(activeProvider) ?? defaultImageCapability(activeProvider.baseUrl)
                      })
                      setCapabilityExpanded('image', true)
                    } else {
                      removeModelProviderImage(activeProvider.id)
                      setCapabilityExpanded('image', false)
                    }
                  }}
                >
                  {activeProvider.image ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('imageGenProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.image.protocol}
                          onChange={(e) => updateModelProviderImage(activeProvider.id, {
                            protocol: e.target.value as ImageGenerationProtocol
                          })}
                        >
                          {Object.entries(IMAGE_GENERATION_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('imageGenBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.image.baseUrl}
                          placeholder={t('imageGenBaseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderImage(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeImageBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('imageGenModel')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-image`}
                          values={activeProvider.image.models}
                          onChange={(models) => updateModelProviderImage(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('imageGenModel')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </CapabilitySection>
                <CapabilitySection
                  capabilityId="speech"
                  icon={<Mic className="h-4 w-4" strokeWidth={1.9} />}
                  title={t('modelProviderSpeechCapability')}
                  description={t('modelProviderSpeechCapabilityDesc')}
                  enabled={Boolean(activeProvider.speech)}
                  invalid={activeSpeechBaseUrlInvalid}
                  expanded={expandedCapabilities.has('speech')}
                  modelCountLabel={activeProvider.speech?.models.length
                    ? t('modelProviderModelCount', { total: activeProvider.speech.models.length })
                    : undefined}
                  configureLabel={t('modelProviderCapabilityConfigure')}
                  collapseLabel={t('modelProviderCapabilityCollapse')}
                  enabledLabel={t('modelProviderCapabilityEnabled')}
                  disabledLabel={t('modelProviderCapabilityDisabled')}
                  needsConfigurationLabel={t('modelProviderNeedsConfiguration')}
                  toggleDisabled={activeSpeechToggleDisabled}
                  onExpandedChange={(expanded) => setCapabilityExpanded('speech', expanded)}
                  onToggle={(value) => {
                    if (value) {
                      updateModelProvider(activeProvider.id, {
                        speech: presetSpeechCapability(activeProvider) ?? defaultSpeechCapability(activeProvider.baseUrl)
                      })
                      setCapabilityExpanded('speech', true)
                    } else {
                      removeModelProviderSpeech(activeProvider.id)
                      setCapabilityExpanded('speech', false)
                    }
                  }}
                >
                  {activeProvider.speech ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('speechToTextProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.speech.protocol}
                          onChange={(e) => updateModelProviderSpeech(activeProvider.id, {
                            protocol: e.target.value as SpeechToTextProtocol
                          })}
                        >
                          {Object.entries(SPEECH_TO_TEXT_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('speechToTextBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.speech.baseUrl}
                          placeholder={t('baseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderSpeech(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeSpeechBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('speechToTextModels')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-speech`}
                          values={activeProvider.speech.models}
                          onChange={(models) => updateModelProviderSpeech(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('speechToTextModels')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </CapabilitySection>
                <CapabilitySection
                  capabilityId="tts"
                  icon={<AudioLines className="h-4 w-4" strokeWidth={1.9} />}
                  title={t('modelProviderTextToSpeechCapability')}
                  description={t('modelProviderTextToSpeechCapabilityDesc')}
                  enabled={Boolean(activeProvider.textToSpeech)}
                  invalid={activeTextToSpeechBaseUrlInvalid}
                  expanded={expandedCapabilities.has('tts')}
                  modelCountLabel={activeProvider.textToSpeech?.models.length
                    ? t('modelProviderModelCount', { total: activeProvider.textToSpeech.models.length })
                    : undefined}
                  configureLabel={t('modelProviderCapabilityConfigure')}
                  collapseLabel={t('modelProviderCapabilityCollapse')}
                  enabledLabel={t('modelProviderCapabilityEnabled')}
                  disabledLabel={t('modelProviderCapabilityDisabled')}
                  needsConfigurationLabel={t('modelProviderNeedsConfiguration')}
                  onExpandedChange={(expanded) => setCapabilityExpanded('tts', expanded)}
                  onToggle={(value) => {
                    if (value) {
                      updateModelProvider(activeProvider.id, {
                        textToSpeech: presetTextToSpeechCapability(activeProvider) ??
                          defaultTextToSpeechCapability(activeProvider.baseUrl)
                      })
                      setCapabilityExpanded('tts', true)
                    } else {
                      removeModelProviderTextToSpeech(activeProvider.id)
                      setCapabilityExpanded('tts', false)
                    }
                  }}
                >
                  {activeProvider.textToSpeech ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('textToSpeechProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.textToSpeech.protocol}
                          onChange={(e) => updateModelProviderTextToSpeech(activeProvider.id, {
                            protocol: e.target.value as TextToSpeechProtocol
                          })}
                        >
                          {Object.entries(TEXT_TO_SPEECH_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('textToSpeechBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.textToSpeech.baseUrl}
                          placeholder={t('textToSpeechBaseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderTextToSpeech(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeTextToSpeechBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('textToSpeechModel')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-tts`}
                          values={activeProvider.textToSpeech.models}
                          onChange={(models) => updateModelProviderTextToSpeech(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('textToSpeechModel')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </CapabilitySection>
                <CapabilitySection
                  capabilityId="music"
                  icon={<Music2 className="h-4 w-4" strokeWidth={1.9} />}
                  title={t('modelProviderMusicCapability')}
                  description={t('modelProviderMusicCapabilityDesc')}
                  enabled={Boolean(activeProvider.music)}
                  invalid={activeMusicBaseUrlInvalid}
                  expanded={expandedCapabilities.has('music')}
                  modelCountLabel={activeProvider.music?.models.length
                    ? t('modelProviderModelCount', { total: activeProvider.music.models.length })
                    : undefined}
                  configureLabel={t('modelProviderCapabilityConfigure')}
                  collapseLabel={t('modelProviderCapabilityCollapse')}
                  enabledLabel={t('modelProviderCapabilityEnabled')}
                  disabledLabel={t('modelProviderCapabilityDisabled')}
                  needsConfigurationLabel={t('modelProviderNeedsConfiguration')}
                  onExpandedChange={(expanded) => setCapabilityExpanded('music', expanded)}
                  onToggle={(value) => {
                    if (value) {
                      updateModelProvider(activeProvider.id, {
                        music: presetMusicCapability(activeProvider) ?? defaultMusicCapability(activeProvider.baseUrl)
                      })
                      setCapabilityExpanded('music', true)
                    } else {
                      removeModelProviderMusic(activeProvider.id)
                      setCapabilityExpanded('music', false)
                    }
                  }}
                >
                  {activeProvider.music ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('musicGenerationProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.music.protocol}
                          onChange={(e) => updateModelProviderMusic(activeProvider.id, {
                            protocol: e.target.value as MusicGenerationProtocol
                          })}
                        >
                          {Object.entries(MUSIC_GENERATION_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('musicGenerationBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.music.baseUrl}
                          placeholder={t('musicGenerationBaseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderMusic(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeMusicBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('musicGenerationModel')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-music`}
                          values={activeProvider.music.models}
                          onChange={(models) => updateModelProviderMusic(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('musicGenerationModel')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </CapabilitySection>
                <CapabilitySection
                  capabilityId="video"
                  icon={<Clapperboard className="h-4 w-4" strokeWidth={1.9} />}
                  title={t('modelProviderVideoCapability')}
                  description={t('modelProviderVideoCapabilityDesc')}
                  enabled={Boolean(activeProvider.video)}
                  invalid={activeVideoBaseUrlInvalid}
                  expanded={expandedCapabilities.has('video')}
                  modelCountLabel={activeProvider.video?.models.length
                    ? t('modelProviderModelCount', { total: activeProvider.video.models.length })
                    : undefined}
                  configureLabel={t('modelProviderCapabilityConfigure')}
                  collapseLabel={t('modelProviderCapabilityCollapse')}
                  enabledLabel={t('modelProviderCapabilityEnabled')}
                  disabledLabel={t('modelProviderCapabilityDisabled')}
                  needsConfigurationLabel={t('modelProviderNeedsConfiguration')}
                  onExpandedChange={(expanded) => setCapabilityExpanded('video', expanded)}
                  onToggle={(value) => {
                    if (value) {
                      updateModelProvider(activeProvider.id, {
                        video: presetVideoCapability(activeProvider) ?? defaultVideoCapability(activeProvider.baseUrl)
                      })
                      setCapabilityExpanded('video', true)
                    } else {
                      removeModelProviderVideo(activeProvider.id)
                      setCapabilityExpanded('video', false)
                    }
                  }}
                >
                  {activeProvider.video ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={fieldLabelClass}>
                        {t('videoGenerationProtocol')}
                        <select
                          className={selectControlClass}
                          value={activeProvider.video.protocol}
                          onChange={(e) => updateModelProviderVideo(activeProvider.id, {
                            protocol: e.target.value as VideoGenerationProtocol
                          })}
                        >
                          {Object.entries(VIDEO_GENERATION_PROTOCOL_LABEL_KEYS).map(([protocol, key]) => (
                            <option key={protocol} value={protocol}>{t(key)}</option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabelClass}>
                        {t('videoGenerationBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.video.baseUrl}
                          placeholder={t('videoGenerationBaseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProviderVideo(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeVideoBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                      <label className={`${fieldLabelClass} md:col-span-2`}>
                        {t('videoGenerationModel')}
                        <ModelChipsInput
                          key={`${activeProvider.id}-video`}
                          values={activeProvider.video.models}
                          onChange={(models) => updateModelProviderVideo(activeProvider.id, { models })}
                          placeholder={t('modelProviderModelsPlaceholder')}
                          inputAriaLabel={t('videoGenerationModel')}
                          removeLabel={(model) => t('modelProviderModelRemove', { model })}
                        />
                      </label>
                    </div>
                  ) : null}
                </CapabilitySection>
                </SettingsTabPanel>
    </>
  )
}
