import { useState, type ReactElement } from 'react'
import { ChevronDown, ExternalLink, RefreshCw, Terminal } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import {
  harnessUnavailableLabelKey,
  harnessUnavailableNextStepKey
} from '../../store/harness-store'
import { SettingRow, Toggle } from '../settings-controls'
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
  terminal: 'adeAgentTransport.terminal'
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
 * actions hand their command to `onSetupCommand` (terminal prefill, P4-09)
 * or copy it to the clipboard when no handler is wired yet.
 */
export function AgentCenterCard({
  row,
  settings,
  probing,
  platform,
  t,
  tSettings,
  onToggleEnabled,
  onProbe,
  onSetDefault,
  onRemoveCustom,
  onSetBinaryPath,
  onSetPermissionMode,
  onSetupCommand
}: {
  row: AdeHarnessRow
  settings: KunHarnessSettingsV1
  probing: boolean
  platform: string
  /** common-ns translator: adeAgent/adeHarness/adeCredential keys. */
  t: T
  /** settings-ns translator: the legacy adeSettings.* keys. */
  tSettings: T
  onToggleEnabled: (enabled: boolean) => void
  onProbe: () => void
  onSetDefault: () => void
  onRemoveCustom?: () => void
  onSetBinaryPath: (path: string) => void
  onSetPermissionMode: (modeId: string) => void
  onSetupCommand?: (harnessId: string, command: string, title: string) => void
}): ReactElement {
  const { definition, status } = row
  const isKun = definition.id === 'kun'
  const enabled = !settings.disabledIds.includes(definition.id)
  const custom = !definition.builtin
  const [pathOpen, setPathOpen] = useState(false)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const model = agentCardModel(row, {
    enabled,
    platform,
    isDefault: settings.defaultHarnessId === definition.id
  })
  const busy = probing || model.state === 'detecting'

  const runAction = (action: AgentCardAction): void => {
    switch (action.kind) {
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
        onToggleEnabled(true)
        break
      case 'disable':
        onToggleEnabled(false)
        break
      case 'setDefault':
        onSetDefault()
        break
      case 'specifyPath':
        setPathOpen((open) => !open)
        break
      case 'reason':
        setReasonOpen((open) => !open)
        break
      case 'docs':
        window.open(action.url, '_blank', 'noopener,noreferrer')
        break
      default:
        break
    }
  }

  const actionButton = (action: AgentCardAction, primary: boolean): ReactElement | null => {
    if (action.kind === 'none') return null
    const label = t(action.labelKey)
    return (
      <button
        key={`${action.kind}:${'command' in action ? action.command : ''}`}
        type="button"
        disabled={busy && action.kind !== 'reason' && action.kind !== 'specifyPath'}
        onClick={() => runAction(action)}
        className={
          primary
            ? 'inline-flex items-center gap-1.5 rounded-lg bg-ds-accent px-3 py-1.5 text-[12px] font-medium text-white transition hover:opacity-90 disabled:opacity-45'
            : 'inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 py-1.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45'
        }
      >
        {action.kind === 'command' ? <Terminal className="h-3.5 w-3.5" strokeWidth={1.8} /> : null}
        {action.kind === 'docs' ? <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} /> : null}
        {action.kind === 'probe' ? (
          <RefreshCw className={`h-3.5 w-3.5 ${probing ? 'animate-spin' : ''}`} strokeWidth={1.8} />
        ) : null}
        {label}
      </button>
    )
  }

  const setupNote = model.primary.kind === 'command' && model.primary.note
    ? model.primary.note
    : undefined

  return (
    <div className="border-b border-ds-border-muted px-1 py-3 last:border-b-0" data-agent-card={definition.id}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
            <span className="truncate">{definition.displayName}</span>
            {status.version ? (
              <span className="shrink-0 rounded-md bg-ds-main/70 px-1.5 py-0.5 font-mono text-[11px] text-ds-muted">
                {status.version}
              </span>
            ) : null}
            <span className="shrink-0 rounded-md border border-ds-border-muted px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-ds-faint">
              {t(TRANSPORT_LABEL_KEY[definition.transport] ?? 'adeAgentTransport.acp')}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-ds-faint">
            {model.state === 'detecting' ? (
              <RefreshCw className="h-3 w-3 shrink-0 animate-spin" strokeWidth={1.8} />
            ) : null}
            <span className="truncate">{statusLine(model, status, t, tSettings)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {definition.credentialModes.map((mode) => (
              <span
                key={mode}
                className="rounded-md bg-ds-main/60 px-1.5 py-0.5 text-[10.5px] text-ds-muted"
              >
                {t(`adeCredential.${mode === 'native-login' ? 'nativeLogin' : mode === 'kun-gateway' ? 'kunGateway' : 'provider'}`)}
              </span>
            ))}
            {settings.defaultHarnessId === definition.id ? (
              <span className="rounded-md bg-ds-accent/15 px-1.5 py-0.5 text-[10.5px] font-medium text-ds-accent">
                {t('adeAgentAction.isDefault')}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!isKun ? (
            <Toggle
              checked={enabled}
              ariaLabel={`${definition.displayName} ${tSettings('adeSettings.harnessEnabled')}`}
              onChange={onToggleEnabled}
            />
          ) : null}
          <button
            type="button"
            aria-label={t('adeAgentAction.specifyPath')}
            aria-expanded={pathOpen}
            onClick={() => setPathOpen((open) => !open)}
            className="rounded-md p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <ChevronDown
              className={`h-4 w-4 transition ${pathOpen ? 'rotate-180' : ''}`}
              strokeWidth={1.8}
            />
          </button>
        </div>
      </div>

      {model.state !== 'detecting' && (model.primary.kind !== 'none' || model.secondary.length > 0) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {actionButton(model.primary, true)}
          {model.secondary.map((action) => actionButton(action, false))}
          {copied ? (
            <span className="text-[11px] text-ds-faint">{t('adeAgentCopied')}</span>
          ) : null}
        </div>
      ) : null}
      {setupNote ? (
        <div className="mt-1 text-[11px] text-ds-faint">{setupNote}</div>
      ) : null}
      {model.primary.kind === 'command' && !onSetupCommand ? (
        <code className="mt-1 block truncate rounded-md bg-ds-main/60 px-2 py-1 font-mono text-[11px] text-ds-muted">
          {model.primary.command}
        </code>
      ) : null}

      {status.message && reasonOpen ? (
        <div className="mt-2 rounded-lg bg-ds-main/50 px-2.5 py-1.5 text-[11px] text-ds-muted">
          <span className="font-medium">{t('adeHarnessViewReason')}: </span>
          {status.message}
        </div>
      ) : null}

      {pathOpen ? (
        <div className="mt-2 space-y-3">
          <SettingRow
            title={tSettings('adeSettings.harnessCommandPath')}
            description={status.resolvedCommand || tSettings('adeSettings.harnessCommandPathDesc')}
            control={
              <input
                className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none"
                value={settings.binaryPaths[definition.id] ?? ''}
                placeholder={status.resolvedCommand ?? definition.id}
                spellCheck={false}
                onChange={(event) => onSetBinaryPath(event.target.value)}
              />
            }
          />
          {definition.permissionModes.length ? (
            <SettingRow
              title={tSettings('adeSettings.harnessPermissionMode')}
              description={tSettings('adeSettings.harnessPermissionModeDesc')}
              control={
                <select
                  className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none"
                  value={settings.defaultPermissionMode[definition.id] ?? ''}
                  onChange={(event) => onSetPermissionMode(event.target.value)}
                >
                  <option value="">{tSettings('adeSettings.harnessPermissionModeDefault')}</option>
                  {definition.permissionModes.map((mode) => (
                    <option key={mode.id} value={mode.id}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              }
            />
          ) : null}
        </div>
      ) : null}

      {custom && onRemoveCustom ? (
        <button
          type="button"
          onClick={onRemoveCustom}
          className="mt-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-red-600 transition hover:bg-red-500/10"
        >
          {tSettings('adeSettings.harnessRemoveCustom')}
        </button>
      ) : null}
    </div>
  )
}
