import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DESIGN_SYSTEM_PRESETS,
  defaultDesignSettings,
  type DesignSettingsV1,
  type DesignSystemPreset
} from '@shared/app-settings'
import {
  DESIGN_DENSITY_OPTIONS,
  DESIGN_FONT_OPTIONS,
  DESIGN_RADIUS_OPTIONS,
  DESIGN_SYSTEM_DISPLAY,
  DESIGN_TONE_OPTIONS
} from '../design/design-context'
import { SettingsCard, SettingRow, Toggle } from './settings-controls'

const textInputClass =
  'w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1 text-[13px] transition-colors ${
    active
      ? 'bg-[#3b82d8] text-white'
      : 'border border-ds-border bg-ds-card text-ds-ink hover:bg-ds-hover'
  }`
}

/**
 * Design-mode settings: the design system (shared with code), the design agent,
 * the design→code integration, canvas defaults, and the workspace.
 */
export function DesignSettingsSection({ ctx }: { ctx: Record<string, unknown> }): ReactElement {
  const { t } = useTranslation('common')
  const form = ctx.form as { design?: DesignSettingsV1 }
  const update = ctx.update as (patch: { design: Partial<DesignSettingsV1> }) => void
  const selectClass = (ctx.selectControlClass as string) ?? textInputClass
  const design = form.design ?? defaultDesignSettings()
  const tone = design.tone ?? []
  const toggleTone = (value: string): void => {
    update({
      design: { tone: tone.includes(value) ? tone.filter((item) => item !== value) : [...tone, value] }
    })
  }

  return (
    <div className="space-y-5">
      <SettingsCard title={t('designSettingsSystem')}>
        <SettingRow
          title={t('designAgentBrandColor')}
          wideControl
          control={
            <input
              type="text"
              value={design.brandColor}
              onChange={(e) => update({ design: { brandColor: e.target.value } })}
              placeholder="#3b82d8"
              className={textInputClass}
            />
          }
        />
        <SettingRow
          title={t('designAgentTone')}
          wideControl
          control={
            <div className="flex flex-wrap gap-1.5">
              {DESIGN_TONE_OPTIONS.map((value) => (
                <button key={value} type="button" onClick={() => toggleTone(value)} className={chipClass(tone.includes(value))}>
                  {value}
                </button>
              ))}
            </div>
          }
        />
        <SettingRow
          title={t('designAgentSystem')}
          wideControl
          control={
            <select
              value={design.designSystemPreset}
              onChange={(e) => update({ design: { designSystemPreset: e.target.value as DesignSystemPreset } })}
              className={selectClass}
            >
              {DESIGN_SYSTEM_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset === 'none' ? t('designSystem_none') : DESIGN_SYSTEM_DISPLAY[preset]}
                </option>
              ))}
            </select>
          }
        />
        <SettingRow
          title={t('designSettingsType')}
          wideControl
          control={
            <select
              value={design.designType}
              onChange={(e) => update({ design: { designType: e.target.value as DesignSettingsV1['designType'] } })}
              className={selectClass}
            >
              <option value="">{t('designSettingsTypeUnset')}</option>
              <option value="brand">{t('designSettingsTypeBrand')}</option>
              <option value="product">{t('designSettingsTypeProduct')}</option>
            </select>
          }
        />
        <SettingRow
          title={t('designTokenRadius')}
          control={
            <select
              value={design.radius}
              onChange={(e) => update({ design: { radius: e.target.value as DesignSettingsV1['radius'] } })}
              className={selectClass}
            >
              {DESIGN_RADIUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt === '' ? t('designSettingsTypeUnset') : opt}</option>
              ))}
            </select>
          }
        />
        <SettingRow
          title={t('designTokenDensity')}
          control={
            <select
              value={design.density}
              onChange={(e) => update({ design: { density: e.target.value as DesignSettingsV1['density'] } })}
              className={selectClass}
            >
              {DESIGN_DENSITY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt === '' ? t('designSettingsTypeUnset') : opt}</option>
              ))}
            </select>
          }
        />
        <SettingRow
          title={t('designTokenType')}
          control={
            <select
              value={design.fontStyle}
              onChange={(e) => update({ design: { fontStyle: e.target.value as DesignSettingsV1['fontStyle'] } })}
              className={selectClass}
            >
              {DESIGN_FONT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt === '' ? t('designSettingsTypeUnset') : opt}</option>
              ))}
            </select>
          }
        />
        <SettingRow
          title={t('designSettingsGuidelines')}
          description={t('designSettingsGuidelinesHint')}
          wideControl
          control={
            <textarea
              value={design.designGuidelines}
              onChange={(e) => update({ design: { designGuidelines: e.target.value } })}
              rows={3}
              placeholder={t('designSettingsGuidelinesPlaceholder')}
              className={`${textInputClass} resize-y`}
            />
          }
        />
      </SettingsCard>

      <SettingsCard title={t('designSettingsAgent')}>
        <SettingRow
          title={t('designSettingsModel')}
          description={t('designSettingsModelHint')}
          wideControl
          control={
            <input
              type="text"
              value={design.model}
              onChange={(e) => update({ design: { model: e.target.value } })}
              placeholder={t('designSettingsModelPlaceholder')}
              className={textInputClass}
            />
          }
        />
        <SettingRow
          title={t('designSettingsEffort')}
          wideControl
          control={
            <input
              type="text"
              value={design.reasoningEffort}
              onChange={(e) => update({ design: { reasoningEffort: e.target.value } })}
              placeholder="low / medium / high"
              className={textInputClass}
            />
          }
        />
        <SettingRow
          title={t('designSettingsGenPrompt')}
          description={t('designSettingsGenPromptHint')}
          wideControl
          control={
            <textarea
              value={design.generationPrompt}
              onChange={(e) => update({ design: { generationPrompt: e.target.value } })}
              rows={3}
              className={`${textInputClass} resize-y`}
            />
          }
        />
      </SettingsCard>

      <SettingsCard title={t('designSettingsCode')}>
        <SettingRow
          title={t('designSettingsStackHint')}
          description={t('designSettingsStackHintHint')}
          wideControl
          control={
            <input
              type="text"
              value={design.implementStackHint}
              onChange={(e) => update({ design: { implementStackHint: e.target.value } })}
              placeholder="React + Tailwind + shadcn/ui"
              className={textInputClass}
            />
          }
        />
        <SettingRow
          title={t('designSettingsInject')}
          description={t('designSettingsInjectHint')}
          control={<Toggle checked={design.injectIntoCode} onChange={(v) => update({ design: { injectIntoCode: v } })} />}
        />
        <SettingRow
          title={t('designSettingsPublish')}
          description={t('designSettingsPublishHint')}
          control={<Toggle checked={design.publishDesignSystem} onChange={(v) => update({ design: { publishDesignSystem: v } })} />}
        />
      </SettingsCard>

      <SettingsCard title={t('designSettingsCanvas')}>
        <SettingRow
          title={t('designSettingsViewport')}
          control={
            <select
              value={design.defaultViewport}
              onChange={(e) => update({ design: { defaultViewport: e.target.value as DesignSettingsV1['defaultViewport'] } })}
              className={selectClass}
            >
              <option value="mobile">{t('designViewportMobile')}</option>
              <option value="tablet">{t('designViewportTablet')}</option>
              <option value="desktop">{t('designViewportDesktop')}</option>
            </select>
          }
        />
        <SettingRow
          title={t('designSettingsView')}
          control={
            <select
              value={design.defaultCanvasView}
              onChange={(e) => update({ design: { defaultCanvasView: e.target.value as DesignSettingsV1['defaultCanvasView'] } })}
              className={selectClass}
            >
              <option value="preview">{t('designViewPreview')}</option>
              <option value="code">{t('designViewCode')}</option>
            </select>
          }
        />
        <SettingRow
          title={t('designSettingsBackground')}
          control={
            <select
              value={design.canvasBackground}
              onChange={(e) => update({ design: { canvasBackground: e.target.value as DesignSettingsV1['canvasBackground'] } })}
              className={selectClass}
            >
              <option value="light">{t('designBackgroundLight')}</option>
              <option value="dark">{t('designBackgroundDark')}</option>
            </select>
          }
        />
        <SettingRow
          title={t('designSettingsLiveRefresh')}
          control={<Toggle checked={design.liveRefresh} onChange={(v) => update({ design: { liveRefresh: v } })} />}
        />
        <SettingRow
          title={t('designSettingsDeviceFrame')}
          control={<Toggle checked={design.deviceFrame} onChange={(v) => update({ design: { deviceFrame: v } })} />}
        />
      </SettingsCard>

      <SettingsCard title={t('designSettingsWorkspace')}>
        <SettingRow
          title={t('designSettingsWorkspace')}
          description={t('designSettingsWorkspaceHint')}
          wideControl
          control={
            <input
              type="text"
              value={design.defaultWorkspaceRoot}
              onChange={(e) => update({ design: { defaultWorkspaceRoot: e.target.value } })}
              placeholder="~/Designs"
              className={textInputClass}
            />
          }
        />
      </SettingsCard>
    </div>
  )
}
