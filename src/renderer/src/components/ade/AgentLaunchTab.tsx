import { useEffect, useState, type ReactElement } from 'react'
import { Check, Copy } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSecretEnvEntryV1, KunHarnessSettingsV1 } from '@shared/app-settings'
import { agentCommandPath, agentExtraArgs } from '@shared/harness-provider-settings'
import { SettingRow, SettingsCard } from '../settings-controls'
import { settingsButtonClass } from '../settings-button'
import { useChatStore } from '../../store/chat-store'
import { AgentCommandPathField } from './AgentCommandPathField'
import { AgentEnvTable } from './AgentEnvTable'
import { launchPreview } from './agent-launch-preview'

type T = (key: string, options?: Record<string, unknown>) => string
export type AgentLaunchPatch = { args?: string[]; env?: Record<string, string>; secretEnv?: KunHarnessSecretEnvEntryV1[] }

const inputClass = 'h-9 w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 font-mono text-[12px] text-ds-ink shadow-sm placeholder:text-ds-faint focus:border-accent focus:outline-none'

/** Tab 3: how Kun starts the Agent. Launch edits save when a field loses focus and ask for a re-check. */
export function AgentLaunchTab({ row, settings, probing, onProbe, onSetBinaryPath, onSetLaunchPatch, t, tSettings }: {
  row: AdeHarnessRow
  settings: KunHarnessSettingsV1
  probing: boolean
  onProbe: () => void
  onSetBinaryPath: (path: string) => void
  onSetLaunchPatch?: (patch: AgentLaunchPatch) => void
  t: T
  tSettings: T
}): ReactElement {
  const { definition, status } = row
  const override = settings.providers[definition.id]
  const storedArgs = agentExtraArgs(settings.providers, definition.id).join(' ')
  const [args, setArgs] = useState(storedArgs)
  const [copied, setCopied] = useState(false)
  useEffect(() => setArgs(storedArgs), [storedArgs])
  const command = status.resolvedCommand ?? override?.command ?? definition.launch?.command
  // Arguments and environment reach only Agents Kun spawns from a launch spec;
  // SDK-hosted ones (Claude Code, Cursor, Antigravity) would silently ignore them.
  const launchable = Boolean(definition.launch)
  const preview = launchPreview({ command, args: definition.launch?.args ?? [], env: launchable ? override?.env ?? {} : {},
    secretNames: launchable ? (override?.secretEnv ?? []).map((entry) => entry.name) : [] })

  const copy = (): void => {
    void navigator.clipboard?.writeText(preview).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2_000) }).catch(() => undefined)
  }
  if (definition.extension) {
    return <SettingsCard title={t('agentCenter.launch.title')}>
      <div className="space-y-2 px-3 py-3.5 text-[12.5px] text-ds-muted" data-agent-launch-readonly>
        <p>{t('agentCenter.launch.managedByExtension', { name: definition.extension.name ?? definition.extension.id })}</p>
        <button type="button" onClick={() => useChatStore.getState().openSettings('extensions')} className="font-medium text-accent hover:underline">{t('agentCenter.launch.openExtensions')}</button>
        {preview ? <p className="break-all font-mono text-[12px]">{preview}</p> : null}
      </div>
    </SettingsCard>
  }
  const commitArgs = (): void => {
    const values = args.trim() ? args.trim().split(/\s+/) : []
    if (values.join(' ') !== storedArgs) onSetLaunchPatch?.({ args: values })
  }
  return <div className="space-y-4" data-agent-launch={definition.id}>
    <SettingsCard title={t('agentCenter.launch.title')} description={t('agentCenter.launch.desc', { name: definition.displayName })}>
      <SettingRow wideControl title={tSettings('adeSettings.harnessCommandPath')} description={status.resolvedCommand
        ? t('agentCenter.launch.detected', { path: status.resolvedCommand }) : tSettings('adeSettings.harnessCommandPathDesc')}
      control={<AgentCommandPathField value={agentCommandPath(settings.providers, definition.id) ?? ''}
        placeholder={status.resolvedCommand ?? definition.id} onCommit={onSetBinaryPath} t={t} label={tSettings('adeSettings.harnessCommandPath')} />} />
      {definition.builtin && onSetLaunchPatch && launchable ? <SettingRow wideControl title={tSettings('adeSettings.harnessExtraArgs')} description={tSettings('adeSettings.harnessExtraArgsDesc')}
        control={<input data-agent-extra-args className={inputClass} value={args} spellCheck={false}
          onChange={(event) => setArgs(event.target.value)} onBlur={commitArgs}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitArgs() } }} />} /> : null}
      {onSetLaunchPatch && launchable ? <SettingRow wideControl title={tSettings('adeSettings.harnessLaunchEnv')} description={t('agentCenter.launch.envDesc')}
        control={<AgentEnvTable env={override?.env ?? {}} secretEnv={override?.secretEnv ?? []} onChange={onSetLaunchPatch} t={t} tSettings={tSettings} />} /> : null}
      {!launchable ? <p className="px-3 py-3 text-[12px] leading-[1.5] text-ds-muted" data-agent-launch-sdk>{t('agentCenter.launch.noOverrides', { name: definition.displayName })}</p> : null}
      {status.networkSource ? <SettingRow title={t('adeAgentNetwork.title')}
        description={t(status.networkSource === 'explicit-required' ? 'adeAgentNetwork.explicitHint' : 'adeAgentNetwork.hint')}
        control={<div className="flex flex-wrap items-center justify-end gap-2 text-[12px]">
          <span data-agent-network-source={status.networkSource} className="text-ds-muted">{t(`adeAgentNetwork.${status.networkSource}`)}</span>
          <button type="button" disabled={probing} aria-busy={probing} onClick={onProbe} className={settingsButtonClass({ size: 'compact' })}>{t('adeAgentAction.retry')}</button>
        </div>} /> : null}
    </SettingsCard>
    {preview ? <SettingsCard title={t('agentCenter.launch.previewTitle')} description={t('agentCenter.launch.previewDesc', { name: definition.displayName })}
      action={<button type="button" onClick={copy} data-agent-launch-copy className={settingsButtonClass({ size: 'compact' })}>
        {copied ? <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={2} /> : <Copy aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />}
        {copied ? t('adeAgentCopied') : t('agentCenter.launch.copy')}
      </button>}>
      <pre data-agent-launch-preview className="mx-3 my-3 whitespace-pre-wrap break-all rounded-xl bg-ds-subtle px-3.5 py-3 font-mono text-[12px] leading-[1.7] text-ds-ink">{preview}</pre>
    </SettingsCard> : null}
  </div>
}
