import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { harnessRowUnavailableCode } from '../../store/harness-store'
import { usesProviderOnlySdk } from '../../lib/harness-connection-presentation'
import { setupInstallCommand, setupLoginCommand } from './agent-center-actions'

/**
 * The one place that decides what the Agent list and detail say about an
 * Agent (docs/ade/18 §4): its state, the list/status lines, the switch and
 * the single next step. Components render the result; they never re-derive it.
 */

export type AgentGroup = 'connected' | 'available' | 'notInstalled'
export type AgentTone = 'success' | 'warning' | 'muted' | 'running'
export type AgentSwitchState = 'on' | 'off' | 'busy' | 'locked'
export type AgentStateId =
  | 'detecting' | 'notInstalled' | 'installing' | 'installFailed' | 'versionLow' | 'adapterMissing'
  | 'available' | 'checking' | 'ready' | 'needsRecheck' | 'signedOut' | 'connectFailed'

/** An i18n key plus parameters; `*Key` parameters are keys themselves (see `agentLineText`). */
export type AgentLine = { key: string; params?: Record<string, string | number> }

export type AgentNextAction =
  | { kind: 'install'; action: 'install' | 'adapter' }
  | { kind: 'cancelInstall' }
  | { kind: 'reinstall' }
  | { kind: 'docs'; url: string }
  | { kind: 'update' }
  | { kind: 'enable' }
  | { kind: 'cancelCheck' }
  | { kind: 'recheck' }
  | { kind: 'login'; command: string; note?: string }
  | { kind: 'configureProvider' }

export type AgentInstallObservation = { status: 'running' | 'verifying' | 'failed' | 'cancelled' | 'completed' }

export type AgentPresentationContext = {
  /** The selected profile is explicitly enabled (always true for Kun). */
  enabled: boolean
  platform: string
  /** The enablement check is running for this Agent. */
  checking?: boolean
  /** Connection or launch settings changed after the last passing check. */
  changed?: boolean
  install?: AgentInstallObservation
  credentialMode?: 'native-login' | 'provider' | 'kun-gateway'
  defaultModel?: string
  modelCount?: number
}

export type AgentPresentation = {
  state: AgentStateId
  group: AgentGroup
  tone: AgentTone
  listLine: AgentLine
  statusLine: AgentLine
  switch: AgentSwitchState
  /** `setup` shows the install / connect / check steps; `manage` shows the tabs. */
  mode: 'setup' | 'manage'
  /** The single primary action for this state. */
  next: AgentNextAction | null
}

const MODE_KEY = {
  'native-login': 'adeCredential.nativeLogin',
  provider: 'adeCredential.provider',
  'kun-gateway': 'adeCredential.kunGateway'
} as const

const TONE: Record<AgentStateId, AgentTone> = {
  detecting: 'running', installing: 'running', checking: 'running',
  ready: 'success', available: 'muted', notInstalled: 'muted',
  installFailed: 'warning', versionLow: 'warning', adapterMissing: 'warning',
  needsRecheck: 'warning', signedOut: 'warning', connectFailed: 'warning'
}

const MANAGE_STATES: ReadonlySet<AgentStateId> = new Set(
  ['ready', 'needsRecheck', 'signedOut', 'connectFailed', 'checking', 'versionLow'])

/** Translates a line; parameters named `xKey` are keys translated into `x`. */
export function agentLineText(t: (key: string, options?: Record<string, unknown>) => string, line: AgentLine): string {
  const params: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(line.params ?? {})) {
    if (name.endsWith('Key') && typeof value === 'string') params[name.slice(0, -3)] = t(value)
    else params[name] = value
  }
  return t(line.key, params)
}

function lines(state: AgentStateId, extra: {
  mode?: AgentLine['params']; install?: 'install' | 'docs' | 'none'; changed?: boolean; counted?: boolean
}): { list: AgentLine; status: AgentLine } {
  const base = `agentCenter.state.${state}`
  switch (state) {
    case 'ready':
      return {
        list: { key: `${base}.list`, params: extra.mode },
        status: { key: extra.counted ? `${base}.statusModels` : `${base}.status`, params: extra.mode }
      }
    case 'notInstalled':
      return {
        list: { key: `${base}.list_${extra.install ?? 'none'}` },
        status: { key: `${base}.status_${extra.install ?? 'none'}` }
      }
    case 'needsRecheck':
      return { list: { key: `${base}.list` }, status: { key: `${base}.${extra.changed ? 'statusChanged' : 'status'}` } }
    default:
      return { list: { key: `${base}.list` }, status: { key: `${base}.status` } }
  }
}

export function agentPresentation(row: AdeHarnessRow, ctx: AgentPresentationContext): AgentPresentation {
  const { definition, status } = row
  const setup = definition.builtin ? definition.setup : undefined
  const installed = status.installed === 'yes' || usesProviderOnlySdk(row)
  const code = harnessRowUnavailableCode(row)
  const loginCommand = setupLoginCommand(setup, status.installed === 'yes' ? status.resolvedCommand : undefined, ctx.platform)
  const installable = Boolean(setupInstallCommand(setup, ctx.platform))
  const docsUrl = setup?.docsUrl
  const installKind: 'install' | 'docs' | 'none' = installable ? 'install' : docsUrl ? 'docs' : 'none'
  const installRunning = ctx.install?.status === 'running' || ctx.install?.status === 'verifying'

  let state: AgentStateId
  let next: AgentNextAction | null = null
  if (installRunning) {
    state = 'installing'; next = { kind: 'cancelInstall' }
  } else if (ctx.checking) {
    state = 'checking'; next = { kind: 'cancelCheck' }
  } else if (status.detecting === true || code === 'detecting') {
    state = 'detecting'
  } else if (!installed && ctx.install?.status === 'failed') {
    state = 'installFailed'; next = { kind: 'reinstall' }
  } else if (!installed || code === 'not_installed') {
    state = 'notInstalled'
    next = installable ? { kind: 'install', action: 'install' } : docsUrl ? { kind: 'docs', url: docsUrl } : null
  } else if (code === 'adapter_missing') {
    state = 'adapterMissing'
    next = setup?.adapter ? { kind: 'install', action: 'adapter' } : docsUrl ? { kind: 'docs', url: docsUrl } : null
  } else if (code === 'version_too_low' || status.versionSupported === false) {
    state = 'versionLow'; next = { kind: 'update' }
  } else if (!ctx.enabled) {
    state = 'available'; next = { kind: 'enable' }
  } else if (code === null) {
    state = ctx.changed ? 'needsRecheck' : 'ready'
    if (state === 'needsRecheck') next = { kind: 'recheck' }
  } else if (code === 'signed_out' || code === 'credentials_missing' || code === 'authentication_unverified') {
    state = 'signedOut'
    next = usesProviderOnlySdk(row) ? { kind: 'configureProvider' }
      : loginCommand ? { kind: 'login', command: loginCommand.command, ...(loginCommand.note ? { note: loginCommand.note } : {}) }
        : { kind: 'recheck' }
  } else if (code === 'readiness_required' || code === 'disabled') {
    state = 'needsRecheck'; next = { kind: 'recheck' }
  } else {
    state = 'connectFailed'; next = { kind: 'recheck' }
  }

  const group: AgentGroup = ctx.enabled ? 'connected' : installed && state !== 'installing' ? 'available' : 'notInstalled'
  const mode = ctx.enabled && MANAGE_STATES.has(state) ? 'manage' : 'setup'
  const sw: AgentSwitchState = state === 'checking' ? 'busy'
    : ctx.enabled && state !== 'detecting' ? 'on'
      : state === 'available' || state === 'versionLow' || state === 'adapterMissing' ? 'off'
        : 'locked'
  const modeKey = MODE_KEY[ctx.credentialMode ?? 'native-login']
  const modelKey = ctx.defaultModel ? undefined : 'agentEnablement.nativeDefault'
  const text = lines(state, {
    mode: { modeKey, ...(ctx.defaultModel ? { model: ctx.defaultModel } : { modelKey: modelKey! }),
      ...(ctx.modelCount ? { count: ctx.modelCount } : {}) },
    install: installKind, changed: ctx.changed, counted: Boolean(ctx.modelCount)
  })
  return { state, group, tone: TONE[state], listLine: text.list, statusLine: text.status, switch: sw, mode, next }
}
