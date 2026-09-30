import type { ReactElement } from 'react'
import type {
  KunAdeSettingsPatchV1,
  KunAdeSettingsV1,
  KunRuntimeSettingsPatchV1,
  KunRuntimeSettingsV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import { defaultKunAdeSettings } from '@shared/app-settings-kun-harness'
import { SettingRow, SettingsCard, Toggle } from './settings-controls'

type AdeLabView = {
  t: (key: string, options?: Record<string, unknown>) => string
  kun: KunRuntimeSettingsV1
  updateKun: (patch: KunRuntimeSettingsPatchV1) => void
  modelProviders: ModelProviderProfileV1[]
}

function numberValue(raw: string): number | undefined {
  const parsed = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Settings → Laboratory → ADE (P1-24, docs/ade/13 §3.1). Every field maps
 * one-to-one onto agents.kun.ade; patch merges keep untouched keys. The
 * notifications group is GUI-only and edited under General → Notifications.
 */
export function AdeLabSettingsPanel({ view }: { view: AdeLabView }): ReactElement {
  const { t, kun, updateKun, modelProviders } = view
  const ade: KunAdeSettingsV1 = kun.ade ?? defaultKunAdeSettings()
  const patchAde = (patch: KunAdeSettingsPatchV1): void => updateKun({ ade: patch })
  const inputClass =
    'w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none'
  const selectClass = inputClass

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
        <SettingRow
          title={t('adeSettings.managerModel')}
          description={t('adeSettings.managerModelDesc')}
          wideControl
          control={
            <div className="flex gap-2">
              <select
                className={`${selectClass} max-w-[45%]`}
                value={ade.managerModel?.providerId ?? ''}
                onChange={(event) => {
                  const providerId = event.target.value
                  if (!providerId) {
                    patchAde({ managerModel: { providerId: '', model: '' } })
                    return
                  }
                  const provider = modelProviders.find((p) => p.id === providerId)
                  patchAde({
                    managerModel: {
                      providerId,
                      model: provider?.models[0] ?? ade.managerModel?.model ?? ''
                    }
                  })
                }}
              >
                <option value="">{t('adeSettings.managerModelDefault')}</option>
                {modelProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name || provider.id}
                  </option>
                ))}
              </select>
              <input
                className={`${inputClass} flex-1 font-mono text-[12px]`}
                value={ade.managerModel?.model ?? ''}
                placeholder={t('adeSettings.managerModelPlaceholder')}
                spellCheck={false}
                disabled={!ade.managerModel?.providerId}
                onChange={(event) =>
                  patchAde({
                    managerModel: {
                      providerId: ade.managerModel?.providerId ?? '',
                      model: event.target.value.trim()
                    }
                  })
                }
              />
            </div>
          }
        />
        <SettingRow
          title={t('adeSettings.managerMayApprove')}
          description={t('adeSettings.managerMayApproveDesc')}
          control={
            <Toggle
              checked={ade.managerMayApprove}
              ariaLabel={t('adeSettings.managerMayApprove')}
              onChange={(managerMayApprove) => patchAde({ managerMayApprove })}
            />
          }
        />
        <SettingRow
          title={t('adeSettings.allowUnattendedFullAccess')}
          description={t('adeSettings.allowUnattendedFullAccessDesc')}
          control={
            <Toggle
              checked={ade.allowUnattendedFullAccess}
              ariaLabel={t('adeSettings.allowUnattendedFullAccess')}
              onChange={(allowUnattendedFullAccess) => patchAde({ allowUnattendedFullAccess })}
            />
          }
        />
        <SettingRow
          title={t('adeSettings.workerLimits')}
          description={t('adeSettings.workerLimitsDesc')}
          wideControl
          control={
            <div className="flex items-center gap-2">
              <input
                className={`${inputClass} w-24`}
                type="number"
                min={1}
                max={16}
                value={ade.limits.softWorkers}
                aria-label={t('adeSettings.softWorkers')}
                onChange={(event) => {
                  const softWorkers = numberValue(event.target.value)
                  if (softWorkers !== undefined) patchAde({ limits: { softWorkers } })
                }}
              />
              <span className="text-[12px] text-ds-faint">{t('adeSettings.softWorkers')}</span>
              <input
                className={`${inputClass} w-24`}
                type="number"
                min={ade.limits.softWorkers}
                max={32}
                value={ade.limits.hardWorkers}
                aria-label={t('adeSettings.hardWorkers')}
                onChange={(event) => {
                  const hardWorkers = numberValue(event.target.value)
                  if (hardWorkers !== undefined) patchAde({ limits: { hardWorkers } })
                }}
              />
              <span className="text-[12px] text-ds-faint">{t('adeSettings.hardWorkers')}</span>
            </div>
          }
        />
        <SettingRow
          title={t('adeSettings.budget')}
          description={t('adeSettings.budgetDesc')}
          wideControl
          control={
            <div className="flex items-center gap-2">
              <input
                className={`${inputClass} w-28`}
                type="number"
                min={1}
                value={ade.budget?.softTokens ?? ''}
                placeholder={t('adeSettings.budgetUnset')}
                aria-label={t('adeSettings.budgetSoft')}
                onChange={(event) =>
                  patchAde({ budget: { softTokens: numberValue(event.target.value) } })
                }
              />
              <span className="text-[12px] text-ds-faint">{t('adeSettings.budgetSoft')}</span>
              <input
                className={`${inputClass} w-28`}
                type="number"
                min={1}
                value={ade.budget?.hardTokens ?? ''}
                placeholder={t('adeSettings.budgetUnset')}
                aria-label={t('adeSettings.budgetHard')}
                onChange={(event) =>
                  patchAde({ budget: { hardTokens: numberValue(event.target.value) } })
                }
              />
              <span className="text-[12px] text-ds-faint">{t('adeSettings.budgetHard')}</span>
            </div>
          }
        />
        <SettingRow
          title={t('adeSettings.hibernation')}
          description={t('adeSettings.hibernationDesc')}
          wideControl
          control={
            <div className="flex items-center gap-3">
              <Toggle
                checked={ade.hibernation.enabled}
                ariaLabel={t('adeSettings.hibernation')}
                onChange={(enabled) => patchAde({ hibernation: { enabled } })}
              />
              <input
                className={`${inputClass} w-24`}
                type="number"
                min={1}
                max={1440}
                value={ade.hibernation.idleMinutes}
                disabled={!ade.hibernation.enabled}
                aria-label={t('adeSettings.hibernationMinutes')}
                onChange={(event) => {
                  const idleMinutes = numberValue(event.target.value)
                  if (idleMinutes !== undefined) patchAde({ hibernation: { idleMinutes } })
                }}
              />
              <span className="text-[12px] text-ds-faint">{t('adeSettings.hibernationMinutes')}</span>
            </div>
          }
        />
        <SettingRow
          title={t('adeSettings.stallDetection')}
          description={t('adeSettings.stallDetectionDesc')}
          wideControl
          control={
            <div className="flex items-center gap-2">
              <input
                className={`${inputClass} w-24`}
                type="number"
                min={1}
                max={240}
                value={ade.stall.structuredMinutes}
                aria-label={t('adeSettings.stallStructured')}
                onChange={(event) => {
                  const structuredMinutes = numberValue(event.target.value)
                  if (structuredMinutes !== undefined) patchAde({ stall: { structuredMinutes } })
                }}
              />
              <span className="text-[12px] text-ds-faint">{t('adeSettings.stallStructured')}</span>
              <input
                className={`${inputClass} w-24`}
                type="number"
                min={1}
                max={480}
                value={ade.stall.terminalMinutes}
                aria-label={t('adeSettings.stallTerminal')}
                onChange={(event) => {
                  const terminalMinutes = numberValue(event.target.value)
                  if (terminalMinutes !== undefined) patchAde({ stall: { terminalMinutes } })
                }}
              />
              <span className="text-[12px] text-ds-faint">{t('adeSettings.stallTerminal')}</span>
            </div>
          }
        />
      </div>
    </SettingsCard>
  )
}
