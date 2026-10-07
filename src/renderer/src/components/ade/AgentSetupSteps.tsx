import { useState, type ReactElement, type ReactNode } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessDefaultsEntryV1, KunHarnessEnabledProfileV1, KunHarnessSettingsV1 } from '@shared/app-settings'
import { agentCommandPath } from '@shared/harness-provider-settings'
import { usesProviderOnlySdk } from '../../lib/harness-connection-presentation'
import { settingsButtonClass } from '../settings-button'
import { AgentCommandPathField } from './AgentCommandPathField'
import { AgentConnectionFields } from './AgentConnectionFields'
import { AgentInstallControl } from './AgentInstallControl'
import { AgentUpdateControl } from './AgentUpdateControl'
import { setupInstallCommand } from './agent-center-actions'
import type { AgentPresentation } from './agent-center-presentation'

type T = (key: string, options?: Record<string, unknown>) => string

function Step({ index, done, active, title, description, children }: {
  index: number
  done: boolean
  active: boolean
  title: string
  description?: ReactNode
  children?: ReactNode
}): ReactElement {
  return <li data-agent-step={index} data-done={done || undefined} aria-current={active ? 'step' : undefined}
    className={`grid grid-cols-[28px_minmax(0,1fr)] gap-3.5 px-5 py-4 ${active || done ? '' : 'opacity-60'}`}>
    <span className={`mt-0.5 grid h-[26px] w-[26px] place-items-center rounded-full text-[12px] font-bold ${done ? 'bg-ds-success-soft text-ds-status-success' : active ? 'bg-control text-control-foreground' : 'bg-ds-subtle text-ds-muted'}`}>
      {done ? <Check aria-hidden size={14} strokeWidth={2.8} /> : index}
    </span>
    <div className="min-w-0">
      <h4 className="text-[13.5px] font-semibold text-ds-ink">{title}</h4>
      {description ? <div className="mt-1 text-[12px] leading-[1.5] text-ds-muted">{description}</div> : null}
      {children}
    </div>
  </li>
}

/**
 * The three first-time steps (docs/ade/18 §3.4): install, choose how the Agent
 * reaches its models, then check and turn it on. The check is the same action
 * as the switch in the header.
 */
export function AgentSetupSteps({ row, presentation, settings, entry, profile, modelsEnabled, checking, platform, onConnectionChange, onEnable, onPatchHarness, onSetBinaryPath, onSetupCommand, beforeEnableCheck, t, tSettings }: {
  row: AdeHarnessRow
  presentation: AgentPresentation
  settings: KunHarnessSettingsV1
  entry: KunHarnessDefaultsEntryV1
  profile: KunHarnessEnabledProfileV1
  modelsEnabled: boolean
  checking: boolean
  platform: string
  onConnectionChange: (patch: Partial<KunHarnessDefaultsEntryV1>) => void
  onEnable: () => void
  onPatchHarness: (patch: Partial<KunHarnessSettingsV1>) => void
  onSetBinaryPath: (path: string) => void
  /** Hands a reviewed command to a Kun terminal tab; the user runs it. */
  onSetupCommand?: (harnessId: string, command: string, title: string) => void
  beforeEnableCheck?: () => Promise<boolean>
  t: T
  tSettings: T
}): ReactElement {
  const { definition, status } = row
  const [pathOpen, setPathOpen] = useState(false)
  const installed = presentation.state !== 'notInstalled' && presentation.state !== 'installing' &&
    presentation.state !== 'installFailed' && presentation.state !== 'adapterMissing' && presentation.state !== 'detecting'
  const installable = definition.builtin && Boolean(definition.setup?.install?.length || definition.setup?.adapter)
  const docsUrl = definition.setup?.docsUrl
  const terminalInstall = definition.builtin ? setupInstallCommand(definition.setup, platform) : null
  const locked = !installed && presentation.state !== 'versionLow'
  const name = definition.displayName
  const bundled = usesProviderOnlySdk(row)
  const pathField = <div className="mt-3 max-w-xl">
    <AgentCommandPathField value={agentCommandPath(settings.providers, definition.id) ?? ''} placeholder={status.resolvedCommand ?? definition.id}
      autoFocus onCommit={onSetBinaryPath} t={t} label={tSettings('adeSettings.harnessCommandPath')} />
    <p className="mt-1.5 text-[11px] text-ds-faint">{tSettings('adeSettings.harnessCommandPathDesc')}</p>
  </div>

  return <section className="ds-settings-card rounded-[var(--ds-radius-card)] border border-ds-border bg-ds-card" data-agent-setup={definition.id}>
    <div className="px-5 pb-1 pt-4">
      <h3 className="text-[15px] font-semibold text-ds-ink">{t('agentCenter.setup.title', { name })}</h3>
      <p className="mt-1 text-[12px] text-ds-muted">{t('agentCenter.setup.subtitle', { name })}</p>
    </div>
    <ol className="divide-y divide-ds-border-muted">
      <Step index={1} done={installed} active={!installed} title={t('agentCenter.setup.install')}
        description={installed && bundled ? t('agentCenter.setup.bundled', { name })
          : installed
          ? t(status.version ? 'agentCenter.setup.installedVersion' : 'agentCenter.setup.installed', { name, version: status.version ?? '', path: status.resolvedCommand ?? '' })
          : presentation.state === 'versionLow' ? t('agentCenter.state.versionLow.status')
            : t(installable ? 'agentCenter.setup.missingInstall' : 'agentCenter.setup.missing')}>
        {presentation.state === 'versionLow' ? <div className="mt-3"><AgentUpdateControl row={row} settings={settings} patch={onPatchHarness} beforeCheck={beforeEnableCheck} t={t} /></div> : null}
        {!installed && installable ? <AgentInstallControl harnessId={definition.id} action={presentation.state === 'adapterMissing' ? 'adapter' : 'install'}
          needed={status.installed !== 'yes' || status.versionSupported === false || presentation.state === 'adapterMissing'} t={t} /> : null}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {!installed && docsUrl ? <button type="button" onClick={() => void window.kunGui.openExternal(docsUrl).catch(() => undefined)}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
            {t('agentCenter.setup.docs')}<ExternalLink aria-hidden size={11} />
          </button> : null}
          {!installed && terminalInstall && onSetupCommand ? <button type="button" data-agent-setup-terminal
            onClick={() => onSetupCommand(definition.id, terminalInstall.command, name)}
            className="text-[12px] font-medium text-accent hover:underline">{t('agentCenter.setup.terminalInstall')}</button> : null}
          {definition.extension || bundled ? null : <button type="button" aria-expanded={pathOpen} onClick={() => setPathOpen((open) => !open)}
            className="text-[12px] font-medium text-accent hover:underline">
            {t(installed ? 'agentCenter.setup.pathLink' : 'agentCenter.setup.pathLinkMissing')}
          </button>}
        </div>
        {pathOpen ? pathField : null}
      </Step>
      <Step index={2} done={false} active={installed} title={t('agentCenter.setup.connection')}
        description={t('agentCenter.setup.connectionDesc', { name })}>
        <div className="-mx-3 mt-2" data-agent-enablement-fields={definition.id}>
          <AgentConnectionFields row={row} value={entry} profile={profile} modelsEnabled={modelsEnabled} onChange={onConnectionChange} />
        </div>
      </Step>
      <Step index={3} done={false} active={installed} title={t('agentCenter.setup.check')} description={t(definition.transport === 'terminal' ? 'agentIntegrations.terminalExplanation' : 'agentCenter.setup.checkDesc')}>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" data-agent-enable-step disabled={locked || checking} aria-busy={checking} onClick={onEnable}
            className={settingsButtonClass({ variant: 'primary' })}>{t('agentEnablement.enable')}</button>
          <span className="text-[12px] text-ds-faint">{t(locked ? 'agentCenter.setup.checkLocked' : 'agentCenter.setup.checkHint')}</span>
        </div>
      </Step>
    </ol>
  </section>
}
