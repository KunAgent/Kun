import type { ReactElement } from 'react'
import type { KunLabSettingsPatchV1, KunLabSettingsV1 } from '@shared/app-settings'
import { Presentation } from 'lucide-react'
import { SettingRow, Toggle } from './settings-controls'
import { SettingsFeatureCard } from './settings-feature-card'

type Translate = (key: string) => string

/* The slides skill runs in the main conversation. Only its image asset preference is configurable here. */
export function PptSkillSettingsPanel({
  t,
  value,
  imageGen,
  onChange
}: {
  t: Translate
  value: KunLabSettingsV1
  imageGen?: { available: boolean; reason?: string; supportsReferenceEdit?: boolean }
  onChange: (patch: KunLabSettingsPatchV1) => void
}): ReactElement {
  const ppt = value.pptAgent
  const imageAssets = ppt.imageAssets !== false

  return (
    <SettingsFeatureCard
      icon={Presentation}
      tone="orange"
      title={t('labPptTitle')}
      description={t('labPptDescription')}
      enabled
      enabledLabel={t('settingsIaFeatureOn')}
    >
      <SettingRow
        title={t('labPptImageAssets')}
        description={t('labPptImageAssetsDesc')}
        control={
          <Toggle
            checked={imageAssets}
            onChange={(next) => onChange({ pptAgent: { imageAssets: next } })}
          />
        }
      />
      <div className="px-3 pb-3">
        <p className={`text-[12px] leading-5 ${imageAssets && imageGen?.available ? 'text-emerald-700 dark:text-emerald-200' : 'text-ds-faint'}`}>
          {!imageAssets
            ? t('labPptImageAssetsOffHint')
            : imageGen?.available
              ? t('labPptImageAssetsReadyHint')
              : `${t('labPptImageAssetsUnavailableHint')}${imageGen?.reason ? ` ${imageGen.reason}` : ''}`}
        </p>
      </div>
      <SettingRow
        title={t('labPptPreviewRenderer')}
        description={t('labPptPreviewRendererDesc')}
        control={
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
            {t('labPptPreviewRendererBuiltIn')}
          </span>
        }
      />
    </SettingsFeatureCard>
  )
}
