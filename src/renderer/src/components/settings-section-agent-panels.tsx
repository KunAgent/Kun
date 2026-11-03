import type { ReactElement, ReactNode } from 'react'
import { Globe2, Monitor } from 'lucide-react'
import { InlineNoticeView, SettingsCard, SettingRow, SettingsReveal, Toggle } from './settings-controls'
import { SettingsFeatureCard } from './settings-feature-card'
import type { KunBrowserUseSettingsV1 } from '@shared/app-settings'

type BrowserUseRuntimeCapability = {
  status?: 'disabled' | 'available' | 'unavailable' | 'interaction-required'
  reason?: string
}

type Translate = (key: string) => string

export function ComputerUseSettingsPanel({
  t, value, selectControlClass, permissionRow, onChange
}: {
  t: Translate
  value: { enabled: boolean; mode: string }
  selectControlClass: string
  permissionRow: ReactNode
  onChange: (patch: Record<string, unknown>) => void
}): ReactElement {
  return <SettingsFeatureCard
    icon={Monitor}
    tone="blue"
    title={t('computerUseTitle')}
    description={t('computerUseHint')}
    enabled={value.enabled}
    onEnabledChange={(enabled) => onChange({ enabled })}
    toggleLabel={t('computerUseEnable')}
    enabledLabel={t('settingsIaFeatureOn')}
  >
      <div className="px-3 py-3">
        <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:text-amber-200">
          <div className="font-semibold">{t('computerUseModelQualityTitle')}</div>
          <div className="mt-1">{t('computerUseModelQualityBody')}</div>
        </div>
      </div>
      <SettingRow title={t('computerUseMode')} description={t('computerUseModeDesc')} control={
        <select className={selectControlClass} value={value.mode} onChange={(event) => onChange({ mode: event.target.value })}>
          <option value="auto">{t('computerUseModeAuto')}</option>
          <option value="always">{t('computerUseModeAlways')}</option>
          <option value="off">{t('computerUseModeOff')}</option>
        </select>} />
      {permissionRow}
  </SettingsFeatureCard>
}

export function BrowserUseSettingsPanel({
  t,
  value,
  capability,
  selectControlClass,
  onChange
}: {
  t: Translate
  value: KunBrowserUseSettingsV1
  capability?: BrowserUseRuntimeCapability
  selectControlClass: string
  onChange: (patch: Partial<KunBrowserUseSettingsV1>) => void
}): ReactElement {
  const snapshotPreset = value.maxSnapshotNodes <= 120
    ? 'compact'
    : value.maxSnapshotNodes >= 400
      ? 'detailed'
      : 'standard'
  const runtimeStatus = browserUseRuntimeStatus(t, value.enabled, capability)

  return <SettingsFeatureCard
    icon={Globe2}
    tone="teal"
    title={t('browserUseSettingsTitle')}
    description={t('browserUseSettingsHint')}
    enabled={value.enabled}
    onEnabledChange={(enabled) => onChange({ enabled })}
    toggleLabel={t('browserUseSettingsEnable')}
    enabledLabel={t('settingsIaFeatureOn')}
  >
      <div className="space-y-3 px-3 py-3">
        <InlineNoticeView notice={runtimeStatus} />
        <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-[12px] leading-5 text-emerald-800 dark:text-emerald-200">
          <div className="font-semibold">{t('browserUseZeroTrustTitle')}</div>
          <div className="mt-1">{t('browserUseZeroTrustBody')}</div>
        </div>
      </div>
      <SettingRow
        title={t('browserUseSettingsMode')}
        description={value.mode === 'public'
          ? t('browserUseSettingsPublicDesc')
          : t('browserUseSettingsLocalDesc')}
        control={
          <select
            className={selectControlClass}
            value={value.mode}
            onChange={(event) => onChange({
              mode: event.target.value === 'local-development' ? 'local-development' : 'public'
            })}
          >
            <option value="public">{t('browserUseSettingsPublic')}</option>
            <option value="local-development">{t('browserUseSettingsLocal')}</option>
          </select>
        }
      />
      <SettingRow
        title={t('browserUseSettingsApprovalMode')}
        description={value.approvalMode === 'auto-safe'
          ? t('browserUseSettingsApprovalModeDesc')
          : t('browserUseSettingsApprovalAlwaysAskDesc')}
        control={
          <select
            className={selectControlClass}
            value={value.approvalMode}
            onChange={(event) => onChange({
              approvalMode: event.target.value === 'always-ask' ? 'always-ask' : 'auto-safe'
            })}
          >
            <option value="auto-safe">{t('browserUseSettingsApprovalAutoSafe')}</option>
            <option value="always-ask">{t('browserUseSettingsApprovalAlwaysAsk')}</option>
          </select>
        }
      />
      <SettingRow
        title={t('browserUseSettingsMaxTabs')}
        description={t('browserUseSettingsMaxTabsDesc')}
        control={
          <select
            className={selectControlClass}
            value={value.maxTabs}
            onChange={(event) => onChange({ maxTabs: Number(event.target.value) })}
          >
            {numberOptions([1, 2, 3], value.maxTabs).map((count) => (
              <option key={count} value={count}>
                {numberOptionLabel(t, count, [1, 2, 3])}
              </option>
            ))}
          </select>
        }
      />
      <SettingRow
        title={t('browserUseSettingsObservationBudget')}
        description={t('browserUseSettingsObservationBudgetDesc')}
        control={
          <select
            className={selectControlClass}
            value={value.maxObservationActionsPerTurn}
            onChange={(event) => onChange({
              maxObservationActionsPerTurn: Number(event.target.value)
            })}
          >
            {numberOptions([10, 20, 30, 50], value.maxObservationActionsPerTurn)
              .map((count) => (
                <option key={count} value={count}>
                  {numberOptionLabel(t, count, [10, 20, 30, 50])}
                </option>
              ))}
          </select>
        }
      />
      <SettingRow
        title={t('browserUseSettingsInteractionBudget')}
        description={t('browserUseSettingsInteractionBudgetDesc')}
        control={
          <select
            className={selectControlClass}
            value={value.maxInteractionActionsPerTurn}
            onChange={(event) => onChange({
              maxInteractionActionsPerTurn: Number(event.target.value)
            })}
          >
            {numberOptions([4, 8, 12, 20], value.maxInteractionActionsPerTurn)
              .map((count) => (
                <option key={count} value={count}>
                  {numberOptionLabel(t, count, [4, 8, 12, 20])}
                </option>
              ))}
          </select>
        }
      />
      <SettingRow
        title={t('browserUseSettingsSnapshotDetail')}
        description={t('browserUseSettingsSnapshotDetailDesc')}
        control={
          <select
            className={selectControlClass}
            value={snapshotPreset}
            onChange={(event) => {
              const preset = event.target.value
              onChange(preset === 'compact'
                ? { maxSnapshotNodes: 120, maxSnapshotTextChars: 10_000, maxImageDimension: 960 }
                : preset === 'detailed'
                  ? { maxSnapshotNodes: 400, maxSnapshotTextChars: 40_000, maxImageDimension: 1600 }
                  : { maxSnapshotNodes: 250, maxSnapshotTextChars: 20_000, maxImageDimension: 1280 })
            }}
          >
            <option value="compact">{t('browserUseSettingsSnapshotCompact')}</option>
            <option value="standard">{t('browserUseSettingsSnapshotStandard')}</option>
            <option value="detailed">{t('browserUseSettingsSnapshotDetailed')}</option>
          </select>
        }
      />
      <SettingRow
        title={t('browserUseSettingsIdleTimeout')}
        description={t('browserUseSettingsIdleTimeoutDesc')}
        control={
          <select
            className={selectControlClass}
            value={value.idleTimeoutMs}
            onChange={(event) => onChange({ idleTimeoutMs: Number(event.target.value) })}
          >
            {numberOptions([60_000, 300_000, 900_000, 1_800_000], value.idleTimeoutMs)
              .map((duration) => (
                <option key={duration} value={duration}>
                  {idleTimeoutLabel(t, duration)}
                </option>
              ))}
          </select>
        }
      />
  </SettingsFeatureCard>
}

function browserUseRuntimeStatus(
  t: Translate,
  enabled: boolean,
  capability: BrowserUseRuntimeCapability | undefined
): { tone: 'success' | 'error' | 'info'; message: string } {
  const status = !enabled ? 'disabled' : capability?.status ?? 'unavailable'
  const key = status === 'available'
    ? 'browserUseRuntimeStatusAvailable'
    : status === 'interaction-required'
      ? 'browserUseRuntimeStatusInteractionRequired'
      : status === 'disabled'
        ? 'browserUseRuntimeStatusDisabled'
        : 'browserUseRuntimeStatusUnavailable'
  const reason = capability?.reason?.trim().slice(0, 240)
  return {
    tone: status === 'available' ? 'success' : status === 'unavailable' ? 'error' : 'info',
    message: reason && status !== 'available' && status !== 'disabled'
      ? `${t(key)}: ${reason}`
      : t(key)
  }
}

function numberOptions(presets: readonly number[], current: number): number[] {
  return Array.from(new Set([...presets, current])).sort((left, right) => left - right)
}

function numberOptionLabel(t: Translate, value: number, presets: readonly number[]): string {
  return presets.includes(value) ? String(value) : `${value} · ${t('browserUseSettingsCustom')}`
}

function idleTimeoutLabel(t: Translate, value: number): string {
  const labels = new Map<number, string>([
    [60_000, t('browserUseSettingsOneMinute')],
    [300_000, t('browserUseSettingsFiveMinutes')],
    [900_000, t('browserUseSettingsFifteenMinutes')],
    [1_800_000, t('browserUseSettingsThirtyMinutes')]
  ])
  return labels.get(value) ?? `${value} ms · ${t('browserUseSettingsCustom')}`
}

export function DesignQualitySettingsPanel({
  t, value, selectControlClass, onChange
}: {
  t: Translate
  value: { enabled: boolean; strictness: string }
  selectControlClass: string
  onChange: (patch: Record<string, unknown>) => void
}): ReactElement {
  return <SettingsCard title={t('designQualityTitle')}>
    <div className="px-3 py-4"><InlineNoticeView notice={{ tone: 'info', message: t('designQualityHint') }} /></div>
    <SettingRow title={t('designQualityEnable')} description={t('designQualityEnableDesc')}
      control={<Toggle checked={value.enabled} onChange={(enabled) => onChange({ enabled })} />} />
    <SettingsReveal open={value.enabled}>
      <SettingRow title={t('designQualityStrictness')} description={t('designQualityStrictnessDesc')} control={
        <select className={selectControlClass} value={value.strictness} onChange={(event) => onChange({ strictness: event.target.value })}>
          <option value="relaxed">{t('designQualityStrictnessRelaxed')}</option>
          <option value="standard">{t('designQualityStrictnessStandard')}</option>
          <option value="strict">{t('designQualityStrictnessStrict')}</option>
        </select>} />
    </SettingsReveal>
  </SettingsCard>
}
