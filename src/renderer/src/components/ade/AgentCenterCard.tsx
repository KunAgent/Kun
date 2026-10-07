import { AgentUpdateControl } from './AgentUpdateControl'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { ChevronDown, ExternalLink, RefreshCw, Terminal } from 'lucide-react'
import type { AdeHarnessRow, AdeHarnessTestResult } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import {
  harnessUnavailableLabelKey,
  harnessUnavailableNextStepKey
} from '../../store/harness-store'
import { useChatStore } from '../../store/chat-store'
import { usesProviderOnlySdk } from '../../lib/harness-connection-presentation'
import { SettingRow } from '../settings-controls'
import { harnessProfileEnabled, selectedHarnessProfile } from '@shared/harness-enablement'
import { AgentEnablementPanel } from './AgentEnablementPanel'
import { AgentSettingsSelect } from './AgentSettingsSelect'
import { permissionFollowsKunLevel } from '../../lib/harness-native-permission'
import { AgentInstallControl } from './AgentInstallControl'
import { AgentBadge, AgentDetailHeader, agentStatusTone } from './AgentCenterParts'
import {
  agentCardModel,
  type AgentCardAction,
  type AgentCardModel
} from './agent-center-actions'

const TRANSPORT_LABEL_KEY: Record<string, string> = {
  'native-loop': 'adeAgentTransport.nativeLoop',
  'agent-sdk': 'adeAgentTransport.agentSdk',
  'cursor-sdk': 'adeAgentTransport.cursorSdk',
  'antigravity-cli': 'adeAgentTransport.antigravityCli',
  acp: 'adeAgentTransport.acp',
  'codex-app-server': 'adeAgentTransport.codexAppServer',
  'pi-rpc': 'adeAgentTransport.piRpc',
}

type T = (key: string, options?: Record<string, unknown>) => string

function statusLine(
  model: AgentCardModel,
  status: AdeHarnessRow['status'],
  t: T,
  tSettings: T
): string {
  if (model.state === 'detecting') return t('adeHarnessUnavailable.detecting')
  const code = model.reasonCode
  if (code) {
    const nextKey = harnessUnavailableNextStepKey(code)
    return `${t(harnessUnavailableLabelKey(code))}${nextKey ? ` — ${t(nextKey)}` : ''}`
  }
  switch (status.login) {
    case 'signed-in':
      return tSettings('adeSettings.harnessLoginSignedIn')
    case 'signed-out':
      return tSettings('adeSettings.harnessLoginSignedOut')
    case 'not-required':
      return tSettings('adeSettings.harnessLoginNotRequired')
    default:
      return tSettings('adeSettings.harnessLoginUnknown')
  }
}

/**
 * One Agent Center card (docs/ade/impl/p4 §3.2, P4-08): status, credential
 * modes, the state-driven primary action, and secondary actions. Command
 * login actions hand their command to `onSetupCommand` (terminal prefill).
 * Installation stays in the card and uses the host-owned installation API.
 */
export function AgentCenterCard({
  row,
  settings,
  probing,
  platform,
  t,
  tSettings,
  onPatchHarness,
  beforeEnableCheck,
  onProbe,
  onSetDefault,
  onRemoveCustom,
  onExportCustom,
  onSetBinaryPath,
  onSetPermissionMode,
  onSetupCommand,
  onTest
}: {
  row: AdeHarnessRow
  settings: KunHarnessSettingsV1
  probing: boolean
  platform: string
  /** common-ns translator: adeAgent/adeHarness/adeCredential keys. */
  t: T
  /** settings-ns translator: the legacy adeSettings.* keys. */
  tSettings: T
  beforeEnableCheck?: () => Promise<boolean>
  onPatchHarness: (patch: Partial<KunHarnessSettingsV1>) => void
  onProbe: () => void
  onSetDefault: () => void
  onRemoveCustom?: () => void
  /** P4-12: exports this custom definition as a single JSON file. */
  onExportCustom?: () => void
  onSetBinaryPath: (path: string) => void
  onSetPermissionMode: (modeId: string) => void
  onSetupCommand?: (harnessId: string, command: string, title: string) => void
  /**
   * P4-10: runs `POST /v1/harnesses/:id/test` at the requested depth.
   * 'handshake' covers detect+handshake; 'trial' additionally runs one
   * prompt through a real delegated turn (consumes the harness's quota).
   */
  onTest?: (level: 'handshake' | 'trial') => Promise<AdeHarnessTestResult>
}): ReactElement {
  const { definition, status } = row
  const isKun = definition.id === 'kun'
  const providerOnly = usesProviderOnlySdk(row)
  const enabled = isKun || harnessProfileEnabled(settings, selectedHarnessProfile(row, settings))
  const custom = !definition.builtin
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const advancedRef = useRef<HTMLDivElement>(null)
  // The "set command path" action sits above the fold; reveal the section it opens.
  useEffect(() => {
    if (advancedOpen) advancedRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [advancedOpen])
  const [reasonOpen, setReasonOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [testing, setTesting] = useState<false | 'handshake' | 'trial'>(false)
  const [testResult, setTestResult] = useState<AdeHarnessTestResult | null>(null)

  const model = agentCardModel(row, {
    enabled,
    platform,
    isDefault: settings.defaultHarnessId === definition.id
  })
  const busy = probing || testing !== false || model.state === 'detecting'

  const runTest = async (level: 'handshake' | 'trial'): Promise<void> => {
    if (!onTest) return
    setTesting(level)
    try {
      setTestResult(await onTest(level))
    } catch (error) {
      setTestResult({
        harnessId: definition.id,
        transport: definition.transport,
        level,
        ok: false,
        durationMs: 0,
        detect: {
          durationMs: 0,
          ok: false,
          status: {
            ...status,
            message: error instanceof Error ? error.message : String(error)
          }
        }
      })
    } finally {
      setTesting(false)
    }
  }

  const runAction = (action: AgentCardAction): void => {
    switch (action.kind) {
      case 'configureProvider':
        useChatStore.getState().openSettings('providers')
        break
      case 'test':
        void runTest('handshake')
        break
      case 'command':
        if (onSetupCommand) {
          onSetupCommand(definition.id, action.command, definition.displayName)
        } else {
          void navigator.clipboard?.writeText(action.command).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2_000)
          })
        }
        break
      case 'probe':
        onProbe()
        break
      case 'enable':
      case 'disable':
        break
      case 'setDefault':
        onSetDefault()
        break
      case 'specifyPath':
        toggleAdvanced()
        break
      case 'reason':
        setReasonOpen((open) => !open)
        break
      case 'docs':
        void window.kunGui.openExternal(action.url).catch(() => undefined)
        break
      default:
        break
    }
  }

  const actionButton = (action: AgentCardAction, primary: boolean): ReactElement | null => {
    if (action.kind === 'none' || action.kind === 'install' || action.kind === 'enable' || action.kind === 'disable') return null
    const label = t(action.labelKey)
    return (
      <button aria-busy={Boolean((action.kind === 'probe' || action.kind === 'test') && (probing || testing))} data-settings-action={primary ? 'primary' : 'secondary'} data-settings-size="default"
        key={`${action.kind}:${'command' in action ? action.command : ''}`}
        type="button"
        data-agent-action={action.kind}
        disabled={busy && action.kind !== 'reason' && action.kind !== 'specifyPath'}
        onClick={() => runAction(action)}
        className={
          primary
            ? 'inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition hover:opacity-90 disabled:opacity-45'
            : 'inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 py-1.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45'
        }
      >
        {action.kind === 'command' ? <Terminal className="h-3.5 w-3.5" strokeWidth={1.8} /> : null}
        {action.kind === 'docs' ? <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} /> : null}
        {action.kind === 'probe' || action.kind === 'test' ? (
          <RefreshCw
            className={`h-3.5 w-3.5 ${probing || testing ? 'animate-spin' : ''}`}
            strokeWidth={1.8}
          />
        ) : null}
        {label}
      </button>
    )
  }

  const setupNote = model.primary.kind === 'command' && model.primary.note
    ? model.primary.note
    : undefined
  const statusText = providerOnly && (model.reasonCode === 'signed_out' || model.reasonCode === null)
    ? t('adeAgentAction.providerConnection') : statusLine(model, status, t, tSettings)
  const showsCommand = Boolean(status.resolvedCommand && !providerOnly)
  const hasDetailSettings = showsCommand || definition.permissionModes.length > 0
  const toggleAdvanced = (): void => setAdvancedOpen((open) => !open)

  return (
    <div className="space-y-4" data-agent-card={definition.id}>
      <AgentDetailHeader
        harnessId={definition.id}
        name={definition.displayName}
        tone={agentStatusTone(model.state)}
        status={statusText}
        badges={<>
          {!isKun ? <AgentBadge>{t(TRANSPORT_LABEL_KEY[definition.transport] ?? 'adeAgentTransport.acp')}</AgentBadge> : null}
          {status.version ? <AgentBadge mono>{status.version}</AgentBadge> : null}
          {definition.availability === 'preview' ? <AgentBadge tone="warning">{t('agentEnablement.preview')}</AgentBadge> : null}
          {settings.defaultHarnessId === definition.id ? <AgentBadge tone="accent">{t('adeAgentAction.isDefault')}</AgentBadge> : null}
        </>}
        meta={definition.credentialModes.length ? definition.credentialModes.map((mode) => (
          <AgentBadge key={mode}>
            {t(`adeCredential.${mode === 'native-login' ? 'nativeLogin' : mode === 'kun-gateway' ? 'kunGateway' : 'provider'}`)}
          </AgentBadge>
        )) : undefined}
      />

      {model.state !== 'detecting' && (model.primary.kind !== 'none' || model.secondary.length > 0) ? (
        <div className="flex flex-wrap items-center gap-2" data-agent-actions>
          {actionButton(model.primary, true)}
          {model.secondary.map((action) => actionButton(action, false))}
          {copied ? (
            <span className="text-[11px] text-ds-faint">{t('adeAgentCopied')}</span>
          ) : null}
        </div>
      ) : null}
      {testResult ? (
        <HarnessTestBlock
          result={testResult}
          busy={testing !== false}
          t={t}
          onTrial={onTest ? () => void runTest('trial') : undefined}
        />
      ) : null}
      {setupNote ? (
        <div className="text-[11px] text-ds-faint">{setupNote}</div>
      ) : null}
      {model.primary.kind === 'command' && !onSetupCommand ? (
        <code className="block truncate rounded-md bg-ds-subtle px-2 py-1 font-mono text-[11px] text-ds-muted">
          {model.primary.command}
        </code>
      ) : null}
      {status.message && reasonOpen ? (
        <div className="rounded-lg bg-ds-subtle px-3 py-2 text-[11px] text-ds-muted">
          <span className="font-medium">{t('adeHarnessViewReason')}: </span>
          {status.message}
        </div>
      ) : null}

      {definition.builtin && (definition.setup?.install?.length || definition.setup?.adapter) ? (
        <AgentInstallControl harnessId={definition.id} action={model.reasonCode === 'adapter_missing' ? 'adapter' : 'install'}
          needed={status.installed !== 'yes' || status.versionSupported === false} t={t} />
      ) : null}
      {!isKun ? <AgentEnablementPanel row={row} settings={settings} patch={onPatchHarness} beforeCheck={beforeEnableCheck} /> : null}
      {!isKun ? <AgentUpdateControl row={row} settings={settings} patch={onPatchHarness} beforeCheck={beforeEnableCheck} t={t} /> : null}

      <div className="space-y-3" data-agent-detail-settings hidden={!hasDetailSettings}>
        {showsCommand ? (
          <div className="min-w-0 rounded-lg bg-ds-subtle px-3 py-2 text-[11px] text-ds-muted" data-agent-connection-summary>
            <span className="font-medium">{tSettings('adeSettings.harnessCommandPath')}: </span>
            <span className="break-all font-mono">{status.resolvedCommand}</span>
          </div>
        ) : null}
        {definition.permissionModes.length ? (
          <div className="rounded-xl border border-ds-border-muted px-1">
            {permissionFollowsKunLevel(definition.transport) ? (
              <SettingRow
                title={tSettings('adeSettings.harnessPermissionMode')}
                description={tSettings('adeSettings.harnessPermissionModeFollowsKun', { agent: definition.displayName })}
                control={<span className="text-xs text-ds-muted">{tSettings('adeSettings.harnessPermissionModeDefault')}</span>}
              />
            ) : (
              <SettingRow
                title={tSettings('adeSettings.harnessPermissionMode')}
                description={tSettings('adeSettings.harnessPermissionModeDesc')}
                control={
                  <AgentSettingsSelect label={tSettings('adeSettings.harnessPermissionMode')}
                    value={settings.defaults[definition.id]?.permissionMode ?? ''}
                    onChange={onSetPermissionMode}
                    options={[{ value: '', label: tSettings('adeSettings.harnessPermissionModeDefault') },
                      ...definition.permissionModes.map((mode) => ({ value: mode.id, label: mode.label }))]} />
                }
              />
            )}
          </div>
        ) : null}
      </div>

      {!providerOnly ? (
        <div ref={advancedRef} className="overflow-hidden rounded-xl border border-ds-border-muted">
          <button type="button" data-agent-advanced-toggle aria-expanded={advancedOpen} onClick={toggleAdvanced}
            className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-tint/40">
            <span>{t('agentIntegrations.advanced')}</span>
            <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 transition ${advancedOpen ? 'rotate-180' : ''}`} strokeWidth={1.8} />
          </button>
          {advancedOpen ? (
            <div className="border-t border-ds-border-muted px-1" data-agent-advanced-settings>
              {status.networkSource ? <SettingRow
                title={t('adeAgentNetwork.title')}
                description={t(status.networkSource === 'explicit-required'
                  ? 'adeAgentNetwork.explicitHint' : 'adeAgentNetwork.hint')}
                control={<div className="flex flex-wrap items-center justify-end gap-2 text-[12px]">
                  <span data-agent-network-source={status.networkSource} className="text-ds-muted">
                    {t(`adeAgentNetwork.${status.networkSource}`)}
                  </span>
                  <button aria-busy={probing} data-settings-action="secondary" data-settings-size="default" type="button" disabled={busy} onClick={onProbe}
                    className="rounded-md border border-ds-border-muted px-2 py-1 text-ds-ink hover:bg-ds-hover disabled:opacity-50">
                    {t('adeAgentAction.retry')}
                  </button>
                </div>}
              /> : null}
              <SettingRow
                wideControl
                title={tSettings('adeSettings.harnessCommandPath')}
                description={tSettings('adeSettings.harnessCommandPathDesc')}
                control={
                  <input
                    className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12px] text-ds-ink shadow-sm focus:border-accent focus:outline-none"
                    value={settings.binaryPaths[definition.id] ?? ''}
                    placeholder={status.resolvedCommand ?? definition.id}
                    spellCheck={false}
                    onChange={(event) => onSetBinaryPath(event.target.value)}
                  />
                }
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {custom ? (
        <div className="flex items-center gap-1">
          {onExportCustom ? (
            <button data-settings-action="secondary" data-settings-size="default"
              type="button"
              onClick={onExportCustom}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {tSettings('adeSettings.harnessExportCustom')}
            </button>
          ) : null}
          {onRemoveCustom ? (
            <button data-settings-action="danger" data-settings-size="default"
              type="button"
              onClick={onRemoveCustom}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-red-600 transition hover:bg-red-500/10"
            >
              {tSettings('adeSettings.harnessRemoveCustom')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * P4-10 result block: one row per executed level (detect → handshake →
 * trial), each with its own duration. The trial button stays a separate
 * click because a real turn consumes the harness's quota (p4 §3.5).
 */
function HarnessTestBlock({
  result,
  busy,
  t,
  onTrial
}: {
  result: AdeHarnessTestResult
  busy: boolean
  t: T
  onTrial?: () => void
}): ReactElement {
  const detectDetail = [
    result.detect.status.resolvedCommand,
    result.detect.status.version
  ].filter(Boolean).join(' · ')
  const handshake = result.handshake
  const handshakeDetail = handshake
    ? [
        handshake.agent ? [handshake.agent.name, handshake.agent.version].filter(Boolean).join(' ') : '',
        handshake.capabilities
          ? [
              handshake.capabilities.sessionResume ? t('adeAgentTest.capSessionResume') : '',
              handshake.capabilities.imageInput ? t('adeAgentTest.capImageInput') : '',
              handshake.capabilities.mcpTransports?.length
                ? `MCP: ${handshake.capabilities.mcpTransports.join(', ')}`
                : ''
            ].filter(Boolean).join(' · ')
          : '',
        handshake.detail
      ].filter(Boolean).join(' · ')
    : ''
  const trial = result.trial
  return (
    <div
      className="space-y-1 rounded-lg bg-ds-subtle px-3 py-2 text-[11px] text-ds-muted"
      data-test-result={result.harnessId}
    >
      <TestLevelRow
        label={t('adeAgentTest.detect')}
        ok={result.detect.ok}
        durationMs={result.detect.durationMs}
        detail={detectDetail || result.detect.status.message || ''}
      />
      {handshake ? (
        <TestLevelRow
          label={t('adeAgentTest.handshake')}
          ok={handshake.ok}
          durationMs={handshake.durationMs}
          detail={handshake.supported ? handshakeDetail : t('adeAgentTest.noHandshake')}
        />
      ) : null}
      {trial ? (
        <TestLevelRow
          label={t('adeAgentTest.trial')}
          ok={trial.ok}
          durationMs={trial.durationMs}
          detail={[
            trial.usage ? t('adeAgentTest.tokens', { count: trial.usage.totalTokens }) : '',
            trial.error ?? ''
          ].filter(Boolean).join(' · ')}
        />
      ) : null}
      {result.level !== 'trial' && onTrial ? (
        <button aria-busy={busy} data-settings-action="secondary" data-settings-size="default"
          type="button"
          disabled={busy}
          onClick={onTrial}
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 py-1 text-[11px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45"
        >
          {busy ? <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={1.8} /> : null}
          {t('adeAgentAction.trial')}
        </button>
      ) : null}
    </div>
  )
}

function TestLevelRow({
  label,
  ok,
  durationMs,
  detail
}: {
  label: string
  ok: boolean
  durationMs: number
  detail: string
}): ReactElement {
  return (
    <div className="flex items-baseline gap-2">
      <span className={ok ? 'shrink-0 text-emerald-600 dark:text-emerald-400' : 'shrink-0 text-red-600 dark:text-red-400'}>
        {ok ? '✓' : '✗'}
      </span>
      <span className="shrink-0 font-medium text-ds-muted">{label}</span>
      <span className="shrink-0 text-ds-faint">{Math.round(durationMs)}ms</span>
      {detail ? <span className="min-w-0 truncate text-ds-faint">{detail}</span> : null}
    </div>
  )
}
