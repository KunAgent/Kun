import type { ReactElement } from 'react'
import type {
  KunAdeSettingsPatchV1,
  KunRuntimeSettingsPatchV1,
  KunRuntimeSettingsV1
} from '@shared/app-settings'
import { defaultKunAdeSettings } from '@shared/app-settings-kun-harness'
import { SettingRow, SettingsCard, Toggle } from './settings-controls'

type AdeLabView = {
  t: (key: string, options?: Record<string, unknown>) => string
  kun: KunRuntimeSettingsV1
  updateKun: (patch: KunRuntimeSettingsPatchV1) => void
}

/** Experimental admission and routing gates. Daily defaults live under Agents -> Collaboration. */
export function AdeLabSettingsPanel({ view }: { view: AdeLabView }): ReactElement {
  const { t, kun, updateKun } = view
  const ade = kun.ade ?? defaultKunAdeSettings()
  const patchAde = (patch: KunAdeSettingsPatchV1): void => updateKun({ ade: patch })

  return (
    <SettingsCard title={t('adeSettings.labTitle')}>
      <div className="pb-1 text-[12px] text-ds-faint">{t('adeSettings.labDesc')}</div>
      <SettingRow
        title={t('adeSettings.enabled')}
        description={t('adeSettings.enabledDesc')}
        control={
          <Toggle
            checked={ade.enabled}
            ariaLabel={t('adeSettings.enabled')}
            onChange={(enabled) => patchAde({ enabled })}
          />
        }
      />
      <div className={ade.enabled ? '' : 'pointer-events-none opacity-50'}>
        <SettingRow
          title={t('adeSettings.harnessRouter')}
          description={t('adeSettings.harnessRouterDesc')}
          control={
            <Toggle
              checked={ade.harnessRouter}
              ariaLabel={t('adeSettings.harnessRouter')}
              onChange={(harnessRouter) => patchAde({ harnessRouter })}
            />
          }
        />
        <SettingRow
          title={t('adeSettings.deterministicHandoff')}
          description={t('adeSettings.deterministicHandoffDesc')}
          control={
            <Toggle
              checked={ade.deterministicHandoff}
              ariaLabel={t('adeSettings.deterministicHandoff')}
              onChange={(deterministicHandoff) => patchAde({ deterministicHandoff })}
            />
          }
        />
      </div>
    </SettingsCard>
  )
}
