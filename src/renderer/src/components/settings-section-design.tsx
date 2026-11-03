import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultDesignSettings, type DesignSettingsV1 } from '@shared/app-settings'
import {
  SettingsCard,
  SettingRow,
  Toggle
} from './settings-controls'

const textInputClass =
  'w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

/**
 * Design-mode settings: the design→code integration, canvas defaults, and the workspace.
 */
export function DesignSettingsSection({ ctx }: { ctx: Record<string, unknown> }): ReactElement {
  const { t } = useTranslation('common')
  const form = ctx.form as { design?: DesignSettingsV1 }
  const update = ctx.update as (patch: { design: Partial<DesignSettingsV1> }) => void
  const selectClass = (ctx.selectControlClass as string) ?? textInputClass
  const design = form.design ?? defaultDesignSettings()

  return (
    <>
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
    </>
  )
}
