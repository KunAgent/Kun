import type { AdeHarnessRow, AdeHarnessSetup } from '@shared/ade-harnesses'
import { harnessRowUnavailableCode } from '../../store/harness-store'
import { usesProviderOnlySdk } from '../../lib/harness-connection-presentation'

/**
 * Agent Center card state + action table (docs/ade/impl/p4 §3.2, P4-08).
 * Pure mapping from a harness row to the card's one primary action and its
 * secondary actions — the card component only renders what this returns.
 */

export type AgentCardAction =
  | { kind: 'install'; labelKey: string; action: 'install' | 'adapter' }
  | { kind: 'command'; labelKey: string; command: string; note?: string }
  | { kind: 'probe' | 'enable' | 'disable' | 'setDefault' | 'specifyPath' | 'reason' | 'test' | 'configureProvider' | 'openApplication'; labelKey: string }
  | { kind: 'docs'; labelKey: string; url: string }
  | { kind: 'none' }

export type AgentCardModel = {
  /** 'detecting' renders a spinner instead of actions. */
  state: 'detecting' | 'ready' | 'unavailable' | 'disabled'
  /** The wire/derived code when state is 'unavailable' (P4-05 reasons). */
  reasonCode: string | null
  primary: AgentCardAction
  secondary: AgentCardAction[]
}

const ACTION = {
  probe: { kind: 'probe', labelKey: 'adeAgentAction.retry' },
  test: { kind: 'test', labelKey: 'adeAgentAction.test' },
  enable: { kind: 'enable', labelKey: 'adeAgentAction.enable' },
  disable: { kind: 'disable', labelKey: 'adeAgentAction.disable' },
  setDefault: { kind: 'setDefault', labelKey: 'adeAgentAction.setDefault' },
  specifyPath: { kind: 'specifyPath', labelKey: 'adeAgentAction.specifyPath' },
  reason: { kind: 'reason', labelKey: 'adeHarnessViewReason' },
  none: { kind: 'none' }
} as const satisfies Record<string, AgentCardAction>

/** Install entries prefer an exact platform match over the 'any' fallback. */
export function setupInstallCommand(
  setup: AdeHarnessSetup | undefined,
  platform: string
): { command: string; note?: string } | null {
  const entries = setup?.install ?? []
  const exact = entries.find((entry) => entry.platform === platform)
  const any = entries.find((entry) => entry.platform === 'any')
  const picked = exact ?? any
  return picked ? { command: picked.command, note: picked.note } : null
}

export function setupLoginCommand(
  setup: AdeHarnessSetup | undefined,
  resolvedCommand?: string,
  platform = 'darwin'
): { command: string; note?: string } | null {
  const login = setup?.login
  if (!login) return null
  const executable = resolvedCommand || login.command
  const quote = (value: string): string => /^[a-z0-9_./:-]+$/i.test(value) ? value
    : platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`
  const command = [executable, ...login.args].map(quote).join(' ')
  return { command: platform === 'win32' && quote(executable) !== executable ? `& ${command}` : command, note: login.note }
}

function commandAction(
  labelKey: string,
  resolved: { command: string; note?: string } | null
): AgentCardAction {
  return resolved
    ? { kind: 'command', labelKey, command: resolved.command, note: resolved.note }
    : ACTION.none
}

/**
 * §3.2 state table. `enabled` comes from harness settings; `platform` is the
 * host `process.platform` mirror from the preload bridge.
 */
export function agentCardModel(
  row: AdeHarnessRow,
  options: { enabled: boolean; platform: string; isDefault: boolean; ready?: boolean }
): AgentCardModel {
  const { enabled, isDefault } = options
  const setup = row.definition.builtin ? row.definition.setup : undefined
  const loginCommand = setupLoginCommand(setup, row.status.installed === 'yes' ? row.status.resolvedCommand : undefined, options.platform)
  const hasDetail = Boolean(row.status.message?.trim())

  if (row.definition.transport === 'application') {
    const docsUrl = row.definition.setup?.docsUrl ?? row.definition.application?.configurationDocsUrl
    return {
      state: row.status.detecting ? 'detecting' : row.status.installed === 'yes' ? 'ready' : 'unavailable',
      reasonCode: row.status.detecting || row.status.installed === 'yes' ? null : 'not_installed',
      primary: row.status.installed === 'yes'
        ? { kind: 'openApplication', labelKey: 'agentIntegrations.openApplication' }
        : docsUrl ? { kind: 'docs', labelKey: 'agentIntegrations.installInstructions', url: docsUrl } : ACTION.probe,
      secondary: [ACTION.probe]
    }
  }

  if (!enabled) {
    return {
      state: 'disabled',
      reasonCode: 'disabled',
      primary: ACTION.enable,
      secondary: [
        ...(setup?.login ? [commandAction('adeAgentAction.login', loginCommand)] : []),
        ...(usesProviderOnlySdk(row) ? [{ kind: 'configureProvider' as const, labelKey: 'adeAgentAction.configureProvider' }] : [ACTION.specifyPath]),
        ...(setup?.docsUrl ? [{ kind: 'docs' as const, labelKey: 'adeAgentAction.docs', url: setup.docsUrl }] : [])
      ]
    }
  }

  const code = row.definition.transport === 'terminal' && options.ready === true ? null : harnessRowUnavailableCode(row)
  if (code === 'detecting') {
    return { state: 'detecting', reasonCode: null, primary: ACTION.none, secondary: [] }
  }

  if (usesProviderOnlySdk(row)) {
    return {
      state: code ? 'unavailable' : 'ready',
      reasonCode: code,
      primary: { kind: 'configureProvider', labelKey: 'adeAgentAction.configureProvider' },
      secondary: [ACTION.probe, ...(code || isDefault ? [] : [ACTION.setDefault]), ACTION.disable,
        ...(hasDetail ? [ACTION.reason] : [])]
    }
  }

  const unknownLogin = row.status.login === 'unknown' && row.status.installed === 'yes' &&
    row.definition.credentialModes.includes('native-login') && setup?.login
    ? commandAction('adeAgentAction.login', loginCommand) : null

  if (code === null) {
    // A settled row can still carry an advisory wire reasonCode (e.g. a
    // handshake timeout under P4-03): surface it on the status line and
    // offer retry without blocking the card.
    const advisory = row.status.reasonCode ?? null
    // P4-13: terminal-only agents have no turn surface — nothing to test,
    // set as default, or disable through the builtin-only disabledIds map.
    if (row.definition.transport === 'terminal') {
      return {
        state: 'ready',
        reasonCode: advisory,
        primary: ACTION.none,
        secondary: [
          ...(unknownLogin ? [unknownLogin] : []),
          ...(advisory ? [ACTION.probe] : []),
          ...(setup?.docsUrl ? [{ kind: 'docs' as const, labelKey: 'adeAgentAction.docs', url: setup.docsUrl }] : [])
        ]
      }
    }
    return {
      state: 'ready',
      reasonCode: advisory,
      primary: ACTION.test,
      secondary: [
        ...(unknownLogin ? [unknownLogin] : []),
        ...(advisory ? [ACTION.probe] : []),
        ...(isDefault || row.definition.id === 'kun' ? [] : [ACTION.setDefault]),
        ...(row.definition.id === 'kun' ? [] : [ACTION.disable])
      ]
    }
  }

  const secondary: AgentCardAction[] = []
  let primary: AgentCardAction = ACTION.none
  switch (code) {
    case 'not_installed':
    case 'version_too_low': {
      const install: AgentCardAction = setup?.install?.length
        ? { kind: 'install', labelKey: 'agentInstall.start', action: 'install' } : ACTION.none
      const docs = setup?.docsUrl
        ? ({ kind: 'docs', labelKey: 'adeAgentAction.docs', url: setup.docsUrl } as const)
        : null
      primary = install.kind === 'install' ? install : docs ?? ACTION.probe
      if (docs && install.kind === 'install') secondary.push(docs)
      secondary.push(ACTION.specifyPath)
      break
    }
    case 'adapter_missing': {
      const adapter = setup?.adapter
      primary = adapter
        ? { kind: 'install', labelKey: 'agentInstall.adapter', action: 'adapter' }
        : setup?.docsUrl
          ? { kind: 'docs', labelKey: 'adeAgentAction.docs', url: setup.docsUrl }
          : ACTION.probe
      secondary.push(ACTION.specifyPath)
      break
    }
    case 'handshake_failed':
      primary = hasDetail ? ACTION.reason : ACTION.probe
      secondary.push(ACTION.probe)
      if (!hasDetail) secondary.push(ACTION.specifyPath)
      break
    case 'handshake_timeout':
      primary = ACTION.probe
      break
    case 'signed_out': {
      const login = commandAction('adeAgentAction.login', loginCommand)
      primary = login.kind === 'command' ? login : ACTION.probe
      secondary.push(ACTION.probe)
      break
    }
    default:
      primary = ACTION.probe
      break
  }
  if (hasDetail && primary.kind !== 'reason') secondary.push(ACTION.reason)
  return { state: 'unavailable', reasonCode: code, primary, secondary }
}
