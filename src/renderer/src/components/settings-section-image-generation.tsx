import { useState, useEffect, type ReactElement } from 'react'
import {
  CUSTOM_IMAGE_GENERATION_PROVIDER_ID,
  DEFAULT_IMAGE_GENERATION_RESOLUTION,
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_PROTOCOLS,
  IMAGE_GENERATION_RESOLUTIONS,
  resolveKunImageGenerationSettings
} from '@shared/app-settings'
import {
  fetchSharedModelConnectionCredentialStates,
  shouldWarnMissingProviderCredential,
  type SharedConnectionCredentialState
} from '../lib/provider-credential-readiness'
import { InlineNoticeView, ModelSelect, SecretInput, SettingsCard, SettingRow, Toggle } from './settings-controls'

const DEFAULT_IMAGE_GENERATION = {
  enabled: false,
  providerId: '',
  protocol: DEFAULT_IMAGE_GENERATION_PROTOCOL,
  baseUrl: '',
  apiKey: '',
  model: '',
  defaultResolution: DEFAULT_IMAGE_GENERATION_RESOLUTION,
  defaultSize: '',
  quality: 'auto',
  timeoutMs: 180000
}

function imageGenerationProtocolLabelKey(protocol: string): string {
  if (protocol === 'minimax-image') return 'imageGenProtocolMiniMax'
  if (protocol === 'codex-responses-image') return 'imageGenProtocolCodex'
  if (protocol === 'grok-imagine-image') return 'imageGenProtocolGrok'
  if (protocol === 'volcengine-ark-image') return 'imageGenProtocolVolcengineArk'
  return 'imageGenProtocolOpenAi'
}

function preferredImageGenerationModel(image: { protocol?: string; models?: string[] } | undefined): string {
  if (image?.protocol === 'codex-responses-image' && image.models?.includes('gpt-image-2')) return 'gpt-image-2'
  return image?.models?.[0] ?? ''
}

export function ImageGenerationSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    form,
    provider,
    kun,
    selectControlClass,
    updateKun
  } = ctx
  const imageGeneration = {
    ...DEFAULT_IMAGE_GENERATION,
    ...(kun.imageGeneration ?? {})
  }
  const effectiveImageGeneration = form
    ? resolveKunImageGenerationSettings(form)
    : imageGeneration
  const imageProviders = (provider?.providers ?? []).filter((item: {
    image?: unknown
  }) => Boolean(item.image))
  const selectedProviderId = imageGeneration.providerId || CUSTOM_IMAGE_GENERATION_PROVIDER_ID
  const selectedImageProvider = imageProviders.find((item: { id: string }) => item.id === selectedProviderId)
  const usingCustomProvider = selectedProviderId === CUSTOM_IMAGE_GENERATION_PROVIDER_ID || !selectedImageProvider
  const selectedProviderImage = selectedImageProvider?.image
  const effectiveImageProtocol = selectedProviderImage?.protocol ?? imageGeneration.protocol
  const isVolcengineArkImage = effectiveImageProtocol === 'volcengine-ark-image'
  const imageResolutionOptions = isVolcengineArkImage
    ? IMAGE_GENERATION_RESOLUTIONS.filter((resolution) => (
        resolution === '2K' || resolution === '3K' || resolution === '4K'
      ))
    : IMAGE_GENERATION_RESOLUTIONS.filter((resolution) => (
        resolution === 'auto' || resolution === '1K' || resolution === '2K'
      ))
  const effectiveImageResolution = imageResolutionOptions.includes(imageGeneration.defaultResolution)
    ? imageGeneration.defaultResolution
    : imageResolutionOptions[0]
  const imageModelOptions = usingCustomProvider
    ? []
    : selectedProviderImage?.models ?? []
  const [showImageGenApiKey, setShowImageGenApiKey] = useState(false)
  const [defaultSizeInput, setDefaultSizeInput] = useState(imageGeneration.defaultSize)
  const [connectionCredentials, setConnectionCredentials] = useState<SharedConnectionCredentialState[] | null>(null)
  const warnMissingImageProviderKey = shouldWarnMissingProviderCredential({
    usingCustomProvider,
    provider: selectedImageProvider,
    connectionCredentials
  })
  useEffect(() => {
    setDefaultSizeInput(imageGeneration.defaultSize)
  }, [imageGeneration.defaultSize])
  useEffect(() => {
    let cancelled = false
    void fetchSharedModelConnectionCredentialStates({ fresh: true })
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
  const updateImageGeneration = (patch: Record<string, unknown>): void => {
    updateKun({
      imageGeneration: {
        ...imageGeneration,
        ...patch
      }
    })
  }

  return (
    <SettingsCard title={t('imageGen')}>
      <SettingRow
        title={t('imageGenEnabled')}
        description={t('imageGenEnabledDesc')}
        control={
          <Toggle
            checked={imageGeneration.enabled}
            onChange={(enabled) => updateImageGeneration({ enabled })}
          />
        }
      />
      {imageGeneration.enabled ? (
        <>
          <SettingRow
            title={t('imageGenProvider')}
            description={t('imageGenProviderDesc')}
            control={
              <div className="w-full min-w-0 md:max-w-md">
                <select
                  className={selectControlClass}
                  value={usingCustomProvider ? CUSTOM_IMAGE_GENERATION_PROVIDER_ID : selectedProviderId}
                  onChange={(e) => {
                    const providerId = e.target.value
                    const nextProvider = imageProviders.find((item: { id: string }) => item.id === providerId)
                    updateImageGeneration({
                      providerId,
                      // 不要清空自定义 baseUrl/apiKey:选中供应商时运行时由
                      // resolveKunImageGenerationSettings 用供应商凭据覆盖,切回“自定义图片 API”
                      // 时需原样保留这里的自定义值。此前这里把它们清成空串,一旦选过供应商,
                      // 自定义密钥就被永久写空丢失。
                      protocol: providerId === CUSTOM_IMAGE_GENERATION_PROVIDER_ID
                        ? imageGeneration.protocol
                        : nextProvider?.image?.protocol ?? DEFAULT_IMAGE_GENERATION_PROTOCOL,
                      model: providerId === CUSTOM_IMAGE_GENERATION_PROVIDER_ID
                        ? imageGeneration.model
                        : preferredImageGenerationModel(nextProvider?.image)
                    })
                  }}
                >
                  {imageProviders.map((item: { id: string; name: string }) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                  <option value={CUSTOM_IMAGE_GENERATION_PROVIDER_ID}>{t('imageGenProviderCustom')}</option>
                </select>
                {warnMissingImageProviderKey ? (
                  <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">
                    {t('imageGenProviderMissingKey', { provider: selectedImageProvider?.name ?? selectedProviderId })}
                  </p>
                ) : null}
              </div>
            }
          />
          {usingCustomProvider ? (
            <>
              <SettingRow
                title={t('imageGenProtocol')}
                description={t('imageGenProtocolDesc')}
                control={
                  <select
                    className={selectControlClass}
                    value={imageGeneration.protocol}
                    onChange={(e) => updateImageGeneration({ protocol: e.target.value })}
                  >
                    {IMAGE_GENERATION_PROTOCOLS.map((protocol) => (
                      <option key={protocol} value={protocol}>
                        {t(imageGenerationProtocolLabelKey(protocol))}
                      </option>
                    ))}
                  </select>
                }
              />
              <SettingRow
                title={t('imageGenBaseUrl')}
                description={t('imageGenBaseUrlDesc')}
                control={
                  <input
                    className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                    value={imageGeneration.baseUrl}
                    placeholder={t('imageGenBaseUrlPlaceholder')}
                    onChange={(e) => updateImageGeneration({ baseUrl: e.target.value })}
                  />
                }
              />
              <SettingRow
                title={t('imageGenApiKey')}
                description={t('imageGenApiKeyDesc')}
                control={
                  <SecretInput
                    value={imageGeneration.apiKey}
                    onChange={(value) => updateImageGeneration({ apiKey: value })}
                    visible={showImageGenApiKey}
                    onToggleVisibility={() => setShowImageGenApiKey((value) => !value)}
                    autoComplete="off"
                    showLabel={t('showSecret')}
                    hideLabel={t('hideSecret')}
                    className="md:max-w-md"
                  />
                }
              />
            </>
          ) : null}
          <SettingRow
            title={t('imageGenModel')}
            description={t('imageGenModelDesc')}
            control={
              <div className="w-full min-w-0 md:max-w-md">
                {usingCustomProvider ? (
                  <input
                    className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                    value={imageGeneration.model}
                    placeholder={t('imageGenModelPlaceholder')}
                    onChange={(e) => updateImageGeneration({ model: e.target.value })}
                  />
                ) : (
                  <ModelSelect
                    value={imageModelOptions.includes(imageGeneration.model) ? imageGeneration.model : ''}
                    options={imageModelOptions}
                    defaultLabel={t('modelSelectDefaultOption', {
                      model: preferredImageGenerationModel(selectedProviderImage)
                    })}
                    selectClassName={selectControlClass}
                    onChange={(model) => updateImageGeneration({ model })}
                  />
                )}
              </div>
            }
          />
          <div className="px-3 py-3">
            <InlineNoticeView notice={{ tone: 'info', message: t('imageGenModelQualityHint') }} />
          </div>
          <SettingRow
            title={t('imageGenQuality')}
            description={t('imageGenQualityDesc')}
            control={
              <select
                className={selectControlClass}
                value={imageGeneration.quality}
                onChange={(e) => updateImageGeneration({ quality: e.target.value })}
              >
                {IMAGE_GENERATION_QUALITIES.map((quality) => (
                  <option key={quality} value={quality}>
                    {t(`imageGenQuality_${quality}`)}
                  </option>
                ))}
              </select>
            }
          />
          <SettingRow
            title={t('imageGenDefaultResolution')}
            description={t('imageGenDefaultResolutionDesc')}
            control={
              <select
                className={selectControlClass}
                value={effectiveImageResolution}
                onChange={(e) => updateImageGeneration({ defaultResolution: e.target.value })}
              >
                {imageResolutionOptions.map((resolution) => (
                  <option key={resolution} value={resolution}>
                    {t(`imageGenDefaultResolution_${resolution}`)}
                  </option>
                ))}
              </select>
            }
          />
          <SettingRow
            title={t('imageGenDefaultSize')}
            description={t('imageGenDefaultSizeDesc')}
            control={
              <input
                className="w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                value={defaultSizeInput}
                placeholder="1024x1024"
                onChange={(e) => setDefaultSizeInput(e.target.value)}
                onBlur={() => updateImageGeneration({ defaultSize: defaultSizeInput })}
              />
            }
          />
          <SettingRow
            title={t('imageGenTimeout')}
            description={t('imageGenTimeoutDesc')}
            control={
              <input
                type="number"
                min={10000}
                max={600000}
                step={10000}
                className="w-32 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                value={imageGeneration.timeoutMs}
                onChange={(e) => updateImageGeneration({ timeoutMs: Number(e.target.value) })}
              />
            }
          />
        </>
      ) : null}
    </SettingsCard>
  )
}
