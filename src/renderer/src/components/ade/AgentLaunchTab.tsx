import type { ReactElement } from 'react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { agentCommandPath } from '@shared/harness-provider-settings'
import { SettingRow, SettingsCard } from '../settings-controls'
import { settingsButtonClass } from '../settings-button'
import { useChatStore } from '../../store/chat-store'
import { AgentCommandPathField } from './AgentCommandPathField'
import { AgentLaunchOverrideFields } from './AgentLaunchOverrideFields'

type T = (key: string, options?: Record<string, unknown>) => string

/** Tab 3: how Kun starts the Agent. Launch edits save on blur and ask for a re-check. */
export function AgentLaunchTab({ row, settings, probing, onProbe, onSetBinaryPath, onSetLaunchPatch, t, tSettings }: {
  row: AdeHarnessRow
  settings: KunHarnessSettingsV1
  probing: boolean
  onProbe: () => void
  onSetBinaryPath: (path: string) => void
  onSetLaunchPatch?: (patch: { args?: string[]; env?: Record<string, string> }) => void
  t: T
  tSettings: T
}): ReactElement {
  const { definition, status } = row
  if (definition.extension) {
    return <SettingsCard title={t('agentCenter.launch.title')}>
      <div className="space-y-2 px-3 py-3.5 text-[12.5px] text-ds-muted" data-agent-launch-readonly>
        <p>{t('agentCenter.launch.managedByExtension', { name: definition.extension.name ?? definition.extension.id })}</p>
        <button type="button" onClick={() => useChatStore.getState().openSettings('extensions')} className="font-medium text-accent hover:underline">{t('agentCenter.launch.openExtensions')}</button>
        {status.resolvedCommand ? <p className="break-all font-mono text-[12px]">{status.resolvedCommand}</p> : null}
      </div>
    </SettingsCard>
  }
  return <SettingsCard title={t('agentCenter.launch.title')} description={t('agentCenter.launch.desc', { name: definition.displayName })}>
    <SettingRow wideControl title={tSettings('adeSettings.harnessCommandPath')} description={status.resolvedCommand
      ? t('agentCenter.launch.detected', { path: status.resolvedCommand }) : tSettings('adeSettings.harnessCommandPathDesc')}
    control={<AgentCommandPathField value={agentCommandPath(settings.providers, definition.id) ?? ''}
      placeholder={status.resolvedCommand ?? definition.id} onCommit={onSetBinaryPath} t={tSettings} />} />
    {definition.builtin && onSetLaunchPatch ? <AgentLaunchOverrideFields id={definition.id} providers={settings.providers}
      tSettings={tSettings} onChange={onSetLaunchPatch} /> : null}
    {status.networkSource ? <SettingRow title={t('adeAgentNetwork.title')}
      description={t(status.networkSource === 'explicit-required' ? 'adeAgentNetwork.explicitHint' : 'adeAgentNetwork.hint')}
      control={<div className="flex flex-wrap items-center justify-end gap-2 text-[12px]">
        <span data-agent-network-source={status.networkSource} className="text-ds-muted">{t(`adeAgentNetwork.${status.networkSource}`)}</span>
        <button type="button" disabled={probing} aria-busy={probing} onClick={onProbe} className={settingsButtonClass({ size: 'compact' })}>{t('adeAgentAction.retry')}</button>
      </div>} /> : null}
  </SettingsCard>
}
