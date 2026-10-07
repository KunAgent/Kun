import { useEffect, useState, type ReactElement } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { AdeHarnessRow, AdeHarnessTestResult } from '@shared/ade-harnesses'
import type { KunHarnessDefaultsEntryV1, KunHarnessSettingsV1 } from '@shared/app-settings'
import { harnessProfileKey } from '@shared/harness-enablement'
import { useHarnessStore } from '../../store/harness-store'
import { useChatStore } from '../../store/chat-store'
import { SettingsSubTabs, SettingsTabPanel } from '../settings-controls'
import { settingsButtonClass } from '../settings-button'
import { useHarnessUpdateStore, hasHarnessUpdate } from '../../store/harness-update-store'
import { AgentConnectionTab } from './AgentConnectionTab'
import { AgentDeleteConfirm } from './AgentDeleteConfirm'
import { AgentDetailHeader, type AgentMenuAction } from './AgentDetailHeader'
import { AgentDiagnosticsCard } from './AgentDiagnosticsCard'
import { AgentLaunchTab, type AgentLaunchPatch } from './AgentLaunchTab'
import { AgentModelsTab } from './AgentModelsTab'
import { AgentSetupSteps } from './AgentSetupSteps'
import { AgentVersionTab } from './AgentVersionTab'
import { agentDiagnosticsText } from './agent-diagnostics-text'
import { setAgentFlag, setAgentLastCheck, useAgentActivityStore } from './agent-center-activity-store'
import { checkFromProof, newestCheck, type LastCheck } from './agent-last-check'
import { agentPresentationFor, type AgentNextAction } from './agent-center-presentation'
import type { AgentSetupIssue } from './agent-setup-help'
import { useAgentEnablement } from './use-agent-enablement'

type T = (key: string, options?: Record<string, unknown>) => string
type TabId = 'connection' | 'models' | 'launch' | 'version'

/**
 * One Agent's page (docs/ade/18 §3.3-3.5): the header with its switch, the one
 * next step when something needs doing, and either the first-time steps or the
 * four management tabs. Enablement, drafts and checks live in one hook here, so
 * the switch, the steps and the tabs can never disagree.
 */
export function AgentDetail({ row, settings, probing, platform, t, tSettings, onPatchHarness, beforeEnableCheck, onProbe, onRemoveUser, onExportUser, onSetBinaryPath, onSetLaunchPatch, onSetPermissionMode, onSetupCommand, onTest, baseName }: {
  row: AdeHarnessRow
  settings: KunHarnessSettingsV1
  probing: boolean
  platform: string
  /** common-ns translator. */
  t: T
  /** settings-ns translator. */
  tSettings: T
  beforeEnableCheck?: () => Promise<boolean>
  onPatchHarness: (patch: Partial<KunHarnessSettingsV1>) => void
  onProbe: () => void
  onRemoveUser?: () => void
  onExportUser?: () => void
  onSetBinaryPath: (path: string) => void
  onSetLaunchPatch?: (patch: AgentLaunchPatch) => void
  onSetPermissionMode: (modeId: string) => void
  onSetupCommand?: (harnessId: string, command: string, title: string) => void
  onTest?: (level: 'handshake' | 'trial') => Promise<AdeHarnessTestResult>
  baseName?: string
}): ReactElement {
  const { definition, status } = row
  const id = definition.id
  const [draft, setDraft] = useState<Partial<KunHarnessDefaultsEntryV1>>({})
  const [tab, setTab] = useState<TabId>('connection')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copied, setCopied] = useState(false)
  const gate = useAgentEnablement({ row, settings, patch: onPatchHarness, beforeCheck: beforeEnableCheck, draft,
    onCommitted: () => setDraft({}) })
  const install = useAgentActivityStore((state) => state.install[id])
  const modelCount = useHarnessStore((state) => state.models[id]?.models.length)
  const updateAvailable = useHarnessUpdateStore(() => hasHarnessUpdate(id))
  useEffect(() => {
    setAgentFlag('checking', id, gate.checking)
    return () => setAgentFlag('checking', id, false)
  }, [id, gate.checking])
  useEffect(() => {
    setAgentFlag('changed', id, gate.dirty)
    return () => setAgentFlag('changed', id, false)
  }, [id, gate.dirty])

  const profileKey = harnessProfileKey(gate.profile)
  const storedCheck = useAgentActivityStore((state) => state.lastCheck[id])
  useEffect(() => {
    if (gate.checking || (!gate.result && !gate.error)) return
    setAgentLastCheck(id, { ...(gate.result?.readiness ? { readiness: gate.result.readiness } : {}), error: gate.error,
      errorDetail: gate.errorDetail, at: Date.now(), profileKey })
  }, [id, gate.checking, gate.result, gate.error, gate.errorDetail, profileKey])
  const proof = row.readyProfiles?.find((candidate) => harnessProfileKey(candidate) === profileKey)?.readiness
  const live: LastCheck | undefined = gate.result || gate.error
    ? { ...(gate.result?.readiness ? { readiness: gate.result.readiness } : {}), error: gate.error, errorDetail: gate.errorDetail, at: Date.now(), profileKey }
    : undefined
  // A check running now hides the old result; otherwise the newest one for this connection shows.
  const shown = gate.checking ? undefined : live ?? newestCheck(profileKey, storedCheck, proof ? checkFromProof(proof, profileKey) : undefined)
  const presentation = agentPresentationFor(row, settings, { platform, modelCount, checking: gate.checking, changed: gate.dirty, install })
  const entry: KunHarnessDefaultsEntryV1 = { ...settings.defaults[id], ...draft }
  const readiness = shown?.readiness
  const shownError = shown?.error ?? ''
  const shownDetail = shown?.errorDetail ?? ''
  const busy = gate.checking || probing

  /** Before the Agent is on, edits save at once; afterwards they wait for a re-check. */
  const change = (patch: Partial<KunHarnessDefaultsEntryV1>): void => {
    if (gate.savedEnabled) { setDraft((current) => ({ ...current, ...patch })); return }
    gate.cancel()
    onPatchHarness({ defaults: { ...settings.defaults, [id]: { ...settings.defaults[id], ...patch } } })
  }
  const discard = (): void => { gate.cancel(); setDraft({}) }
  const toggle = (): void => {
    if (presentation.switch === 'on') gate.disable()
    else void gate.enable()
  }
  const reportText = (): string => agentDiagnosticsText({
    name: definition.displayName, id, ...(status.version ? { version: status.version } : {}), transport: definition.transport,
    connection: gate.profile.credentialMode, platform,
    ...(readiness?.checkedAt ? { checkedAt: readiness.checkedAt } : {}),
    ...(status.resolvedCommand ? { command: status.resolvedCommand } : {}),
    args: settings.providers[id]?.args?.values ?? [], envNames: Object.keys(settings.providers[id]?.env ?? {}),
    ...(readiness?.diagnostics?.length ? { rows: readiness.diagnostics } : { checks: readiness?.checks ?? [] }),
    ...(shownError ? { error: shownError.startsWith('agentEnablement.') ? t(shownError) : shownError } : {}),
    ...(shownDetail ? { detail: shownDetail } : {})
  })
  const copyReport = (): void => {
    void navigator.clipboard?.writeText(reportText()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2_000) }).catch(() => undefined)
  }
  const issue = (failure: string): AgentSetupIssue => ({ harnessId: id, operation: 'readiness', error: failure, output: reportText(),
    ...(status.version ? { currentVersion: status.version } : {}), ...(status.resolvedCommand ? { currentPath: status.resolvedCommand } : {}) })
  const trial = onTest ? () => onTest('trial') : undefined

  const runNext = (action: AgentNextAction): void => {
    switch (action.kind) {
      case 'enable': case 'recheck': void gate.enable(); break
      case 'cancelCheck': gate.cancel(); break
      case 'configureProvider': useChatStore.getState().openSettings('providers'); break
      case 'docs': void window.kunGui.openExternal(action.url).catch(() => undefined); break
      case 'update': setTab('version'); break
      case 'login':
        if (onSetupCommand) onSetupCommand(id, action.command, definition.displayName)
        else void navigator.clipboard?.writeText(action.command)
        break
      default: break
    }
  }

  const menu: AgentMenuAction[] = [
    { id: 'probe', label: t('agentCenter.menu.redetect'), onSelect: onProbe },
    { id: 'copy', label: copied ? t('adeAgentCopied') : t('agentCenter.diagnostics.copy'), onSelect: copyReport },
    ...(definition.setup?.docsUrl ? [{ id: 'docs', label: t('agentCenter.menu.docs'), hint: t('agentCenter.menu.browser'),
      onSelect: () => void window.kunGui.openExternal(definition.setup!.docsUrl!).catch(() => undefined) }] : []),
    ...(onExportUser ? [{ id: 'export', label: t('agentCenter.menu.export'), onSelect: onExportUser }] : []),
    ...(onRemoveUser ? [{ id: 'delete', label: t('agentCenter.menu.delete'), danger: true, onSelect: () => setConfirmDelete(true) }] : [])
  ]

  const nextShown = presentation.mode === 'manage' && presentation.next && presentation.state !== 'checking'
    ? presentation.next : null
  const noticeState = presentation.state
  // An unsaved edit has its own bar with the same re-check action.
  const showNotice = nextShown !== null && !gate.dirty && (noticeState === 'signedOut' || noticeState === 'needsRecheck' ||
    noticeState === 'connectFailed' || noticeState === 'versionLow')
  const providerFallback = noticeState === 'signedOut' && definition.credentialModes.includes('provider') && gate.profile.credentialMode === 'native-login'

  const stateAttribute = gate.checking ? 'checking' : gate.error ? 'failed'
    : presentation.state === 'ready' ? 'ready' : gate.savedEnabled ? 'needs-check' : 'disabled'
  const tabs: Array<{ id: TabId; label: string; dot?: boolean; dotLabel?: string }> = [
    { id: 'connection', label: t('agentCenter.tabs.connection') },
    { id: 'models', label: modelCount ? t('agentCenter.tabs.modelsCount', { count: modelCount }) : t('agentCenter.tabs.models') },
    { id: 'launch', label: t('agentCenter.tabs.launch') },
    { id: 'version', label: t('agentCenter.tabs.version'), dot: updateAvailable, dotLabel: t('agentCenter.tabs.updateAvailable') }
  ]

  return <div className="space-y-4" data-agent-card={id} data-agent-enablement={id} data-agent-enablement-state={stateAttribute}>
    <AgentDetailHeader row={row} presentation={presentation} isDefault={settings.defaultHarnessId === id}
      version={status.version} baseName={baseName} onSwitch={toggle} menu={menu} t={t} />

    {gate.checking ? <div role="status" aria-live="polite" data-agent-check-progress
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ds-border-muted bg-ds-subtle px-4 py-2.5 text-[12.5px] text-ds-muted">
      <span className="flex items-center gap-2"><LoaderCircle aria-hidden size={14} className="animate-spin" />{t(`agentEnablement.phases.${gate.phase}`)}</span>
      <button type="button" onClick={gate.cancel} data-agent-enable-cancel className={settingsButtonClass({ size: 'compact' })}>{t('agentEnablement.cancel')}</button>
    </div> : null}

    {showNotice && nextShown ? <div role="status" data-agent-notice={noticeState}
      className="flex flex-wrap items-center gap-3.5 rounded-xl border border-[color-mix(in_srgb,var(--ds-warning)_30%,transparent)] bg-[var(--ds-warning-soft)] px-4 py-3">
      <div className="min-w-0 flex-1 basis-60">
        <div className="text-[13px] font-semibold text-ds-ink">{t(`agentCenter.notice.${noticeState}.title`, { name: definition.displayName })}</div>
        <div className="mt-0.5 text-[12px] leading-[1.5] text-ds-muted">{t(`agentCenter.notice.${noticeState}.body`, {
          name: definition.displayName, command: nextShown.kind === 'login' ? nextShown.command : '' })}</div>
      </div>
      {providerFallback ? <button type="button" onClick={() => { setTab('connection'); change({ credentialMode: 'provider', providerId: undefined, gatewayBinding: undefined, model: undefined }) }}
        className={settingsButtonClass()}>{t('agentCenter.notice.useProvider')}</button> : null}
      <button type="button" disabled={busy} onClick={() => runNext(nextShown)} data-agent-next={nextShown.kind}
        className={settingsButtonClass({ variant: 'primary' })}>{t(`agentCenter.next.${nextShown.kind}`)}</button>
    </div> : null}

    {presentation.mode === 'setup' ? <>
      <AgentSetupSteps row={row} presentation={presentation} settings={settings} entry={entry} profile={gate.profile}
        modelsEnabled={gate.savedEnabled} checking={gate.checking} platform={platform} onSetupCommand={onSetupCommand} onConnectionChange={change} onEnable={() => void gate.enable()}
        onPatchHarness={onPatchHarness} onSetBinaryPath={onSetBinaryPath} beforeEnableCheck={beforeEnableCheck} t={t} tSettings={tSettings} />
      {shown ? <AgentDiagnosticsCard harnessId={id} readiness={readiness} error={shownError} errorDetail={shownDetail}
        checking={gate.checking} busy={busy} onRecheck={() => void gate.enable()} reportText={reportText} issue={issue} t={t} /> : null}
    </> : <>
      <SettingsSubTabs<TabId> baseId={`agent-${id}`} ariaLabel={t('agentCenter.tabs.label', { name: definition.displayName })}
        items={tabs} value={tab} onChange={setTab} />
      <SettingsTabPanel baseId={`agent-${id}`} tabId="connection" active={tab === 'connection'}>
        <AgentConnectionTab row={row} settings={settings} entry={entry} profile={gate.profile} dirty={gate.dirty} checking={gate.checking} busy={busy}
          readiness={readiness} error={shownError} errorDetail={shownDetail} platform={platform} onChange={change} onDiscard={discard}
          onRecheck={() => void gate.enable()} onSetPermissionMode={onSetPermissionMode} onSetupCommand={onSetupCommand}
          onTrial={gate.dirty ? undefined : trial} reportText={reportText}
          issue={issue} t={t} tSettings={tSettings} />
      </SettingsTabPanel>
      <SettingsTabPanel baseId={`agent-${id}`} tabId="models" active={tab === 'models'}>
        {tab === 'models' ? <AgentModelsTab row={row} entry={entry} profile={gate.profile} dirty={gate.dirty} busy={busy} onChange={change}
          onDiscard={discard} onRecheck={() => void gate.enable()} t={t} /> : null}
      </SettingsTabPanel>
      <SettingsTabPanel baseId={`agent-${id}`} tabId="launch" active={tab === 'launch'}>
        {tab === 'launch' ? <AgentLaunchTab row={row} settings={settings} probing={probing} onProbe={onProbe}
          onSetBinaryPath={onSetBinaryPath} onSetLaunchPatch={onSetLaunchPatch} t={t} tSettings={tSettings} /> : null}
      </SettingsTabPanel>
      <SettingsTabPanel baseId={`agent-${id}`} tabId="version" active={tab === 'version'}>
        {tab === 'version' ? <AgentVersionTab row={row} settings={settings} onPatchHarness={onPatchHarness}
          beforeEnableCheck={beforeEnableCheck} t={t} /> : null}
      </SettingsTabPanel>
    </>}
    {confirmDelete && onRemoveUser ? <AgentDeleteConfirm name={definition.displayName} t={t}
      onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); onRemoveUser() }} /> : null}
  </div>
}
