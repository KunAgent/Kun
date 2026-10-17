import { useEffect, useState, type ReactElement } from 'react'
import type { AdeHarnessRow, AdeHarnessTestResult } from '@shared/ade-harnesses'
import type { KunHarnessDefaultsEntryV1, KunHarnessSettingsV1 } from '@shared/app-settings'
import { harnessProfileKey } from '@shared/harness-enablement'
import { useHarnessStore } from '../../store/harness-store'
import { useChatStore } from '../../store/chat-store'
import { SettingsTabPanel } from '../settings-controls'
import { settingsButtonClass } from '../settings-button'
import { useHarnessUpdateStore, hasHarnessUpdate } from '../../store/harness-update-store'
import { useAgentUpdateRunner } from '../../store/harness-update-runner'
import { AgentActivityBanner } from './AgentActivityBanner'
import { AgentTabs, type AgentTabItem } from './AgentCenterParts'
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
export type AgentTabId = 'connection' | 'models' | 'launch' | 'version'
type TabId = AgentTabId

/**
 * One Agent's page: the header with its switch, the one
 * next step when something needs doing, and either the first-time steps or the
 * four management tabs. Enablement, drafts and checks live in one hook here, so
 * the switch, the steps and the tabs can never disagree.
 */
export function AgentDetail({ row, settings, probing, platform, t, tSettings, requestedTab, onPatchHarness, beforeEnableCheck, onProbe, onRemoveUser, onExportUser, onSetBinaryPath, onSetLaunchPatch, onSetPermissionMode, onSetupCommand, onTest, baseName }: {
  row: AdeHarnessRow
  /** A deep link (e.g. from an update notice) asking for one tab; `at` makes repeats distinct. */
  requestedTab?: { tab: TabId; at: number }
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
  const updateInfo = useHarnessUpdateStore((state) => state.entries[id]?.info)
  const updateVersion = useHarnessUpdateStore(() => hasHarnessUpdate(id)) ? updateInfo?.latestVersion ?? updateInfo?.candidate?.version : undefined
  const update = useAgentUpdateRunner((state) => state.items[id])
  useEffect(() => { if (requestedTab) setTab(requestedTab.tab) }, [requestedTab])
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
  const presentation = agentPresentationFor(row, settings, { platform, modelCount, checking: gate.checking, changed: gate.dirty, install, update, updateVersion })
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
  const versionDot = presentation.activity?.kind === 'update' ? presentation.activity.tone === 'warning' ? 'warning' as const
    : presentation.activity.tone === 'running' ? 'accent' as const : undefined : updateVersion ? 'accent' as const : undefined
  const tabs: Array<AgentTabItem<TabId>> = [
    { id: 'connection', label: t('agentCenter.tabs.connection') },
    { id: 'models', label: t('agentCenter.tabs.models'), ...(modelCount ? { count: modelCount } : {}) },
    { id: 'launch', label: t('agentCenter.tabs.launch') },
    { id: 'version', label: t('agentCenter.tabs.version'), ...(versionDot ? { dot: versionDot, dotLabel: t('agentCenter.tabs.updateAvailable') } : {}) }
  ]

  return <div className="space-y-5" data-agent-card={id} data-agent-enablement={id} data-agent-enablement-state={stateAttribute}>
    <AgentDetailHeader row={row} presentation={presentation} isDefault={settings.defaultHarnessId === id}
      version={status.version} baseName={baseName} onSwitch={toggle} menu={menu} t={t}
      onOpenVersion={presentation.mode === 'manage' ? () => setTab('version') : undefined} />

    <AgentActivityBanner row={row} tab={presentation.mode === 'manage' ? tab : 'version'} checking={gate.checking} checkPhase={gate.phase}
      onCancelCheck={gate.cancel} onViewVersion={() => setTab('version')} t={t} />

    {showNotice && nextShown ? <div role="status" data-agent-notice={noticeState}
      className="flex flex-wrap items-center gap-3.5 rounded-xl border border-[color-mix(in_srgb,var(--ds-warning)_28%,transparent)] bg-[var(--ds-warning-soft)] px-4 py-3">
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
        onSetBinaryPath={onSetBinaryPath} t={t} tSettings={tSettings} />
      {shown ? <AgentDiagnosticsCard harnessId={id} readiness={readiness} error={shownError} errorDetail={shownDetail}
        checking={gate.checking} busy={busy} onRecheck={() => void gate.enable()} reportText={reportText} issue={issue} t={t} /> : null}
    </> : <>
      <AgentTabs<TabId> baseId={`agent-${id}`} ariaLabel={t('agentCenter.tabs.label', { name: definition.displayName })}
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
        {tab === 'version' ? <AgentVersionTab row={row} t={t} platform={platform} /> : null}
      </SettingsTabPanel>
    </>}
    {confirmDelete && onRemoveUser ? <AgentDeleteConfirm name={definition.displayName} t={t}
      onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); onRemoveUser() }} /> : null}
  </div>
}
