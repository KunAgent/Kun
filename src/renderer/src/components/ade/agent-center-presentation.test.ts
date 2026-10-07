import { describe, expect, it } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { withHarnessReadiness } from '@shared/test-support/harness-readiness'
import { agentLineText, agentPresentation, type AgentPresentationContext } from './agent-center-presentation'

const SETUP = {
  install: [{ platform: 'any' as const, command: 'npm i -g x' }],
  login: { command: 'x', args: ['auth', 'login'], note: 'Opens a browser' },
  adapter: { command: 'x-acp', install: 'npm i -g x-acp' },
  docsUrl: 'https://example.test/docs'
}

function row(overrides: {
  id?: string
  setup?: AdeHarnessRow['definition']['setup'] | null
  status?: Partial<AdeHarnessRow['status']>
  enabled?: boolean
  transport?: AdeHarnessRow['definition']['transport']
  credentialModes?: AdeHarnessRow['definition']['credentialModes']
} = {}): AdeHarnessRow {
  const id = overrides.id ?? 'claude-code'
  return withHarnessReadiness({
    definition: {
      id, displayName: id, transport: overrides.transport ?? 'acp',
      credentialModes: overrides.credentialModes ?? ['native-login'], permissionModes: [],
      modelSource: 'probe', staticModels: [], builtin: true,
      ...(overrides.setup === null ? {} : { setup: overrides.setup ?? SETUP })
    },
    status: { harnessId: id, installed: 'yes', login: 'signed-in', checkedAt: '2026-01-01T00:00:00.000Z', ...overrides.status },
    ...(overrides.enabled === undefined ? {} : { enabled: overrides.enabled })
  })
}

const ctx = (overrides: Partial<AgentPresentationContext> = {}): AgentPresentationContext =>
  ({ enabled: false, platform: 'darwin', ...overrides })

/** A row that is enabled in settings but has no runtime proof. */
function unproven(status: Partial<AdeHarnessRow['status']> = {}): AdeHarnessRow {
  const base = row({ status })
  return { ...base, readyProfiles: [], enabled: true }
}

describe('agentPresentation', () => {
  it('shows detection without offering anything', () => {
    const p = agentPresentation(row({ status: { detecting: true, installed: 'unknown' } }), ctx())
    expect(p).toMatchObject({ state: 'detecting', tone: 'running', switch: 'locked', next: null })
  })

  it('offers a one-click install for a missing command and groups it as not installed', () => {
    const p = agentPresentation(row({ status: { installed: 'no', reasonCode: 'not_installed' } }), ctx())
    expect(p).toMatchObject({ state: 'notInstalled', group: 'notInstalled', switch: 'locked', mode: 'setup',
      next: { kind: 'install', action: 'install' } })
    expect(p.listLine.key).toBe('agentCenter.state.notInstalled.list_install')
  })

  it('falls back to the install guide, then to nothing', () => {
    const missing = { installed: 'no' as const, reasonCode: 'not_installed' as const }
    const docs = agentPresentation(row({ status: missing, setup: { docsUrl: 'https://example.test' } }), ctx())
    expect(docs.next).toEqual({ kind: 'docs', url: 'https://example.test' })
    expect(docs.listLine.key).toBe('agentCenter.state.notInstalled.list_docs')
    const none = agentPresentation(row({ status: missing, setup: null }), ctx())
    expect(none.next).toBeNull()
    expect(none.listLine.key).toBe('agentCenter.state.notInstalled.list_none')
  })

  it('reports a running install and lets it be cancelled', () => {
    const p = agentPresentation(row({ status: { installed: 'no', reasonCode: 'not_installed' } }), ctx({ install: { status: 'running' } }))
    expect(p).toMatchObject({ state: 'installing', tone: 'running', switch: 'locked', group: 'notInstalled', next: { kind: 'cancelInstall' } })
  })

  it('reports a failed install and offers a reinstall', () => {
    const p = agentPresentation(row({ status: { installed: 'no', reasonCode: 'not_installed' } }), ctx({ install: { status: 'failed' } }))
    expect(p).toMatchObject({ state: 'installFailed', tone: 'warning', next: { kind: 'reinstall' } })
  })

  it('asks for an update when the installed version is too old', () => {
    const p = agentPresentation(row({ status: { versionSupported: false, reasonCode: 'version_too_low' } }), ctx())
    expect(p).toMatchObject({ state: 'versionLow', switch: 'off', next: { kind: 'update' } })
  })

  it('offers the adapter install when the ACP adapter is missing', () => {
    const p = agentPresentation({ ...row({ status: { reasonCode: 'adapter_missing' } }), readyProfiles: [] }, ctx())
    expect(p).toMatchObject({ state: 'adapterMissing', next: { kind: 'install', action: 'adapter' } })
  })

  it('treats an installed, not yet enabled Agent as available with one next step', () => {
    const p = agentPresentation({ ...row(), readyProfiles: [], enabled: false }, ctx())
    expect(p).toMatchObject({ state: 'available', group: 'available', switch: 'off', mode: 'setup', next: { kind: 'enable' } })
  })

  it('shows an in-flight check as busy and cancellable', () => {
    const p = agentPresentation(row(), ctx({ enabled: true, checking: true }))
    expect(p).toMatchObject({ state: 'checking', switch: 'busy', next: { kind: 'cancelCheck' }, tone: 'running' })
  })

  it('is ready with the default model and connection mode named in the list', () => {
    const p = agentPresentation(row(), ctx({ enabled: true, credentialMode: 'native-login', defaultModel: 'gpt-5.5', modelCount: 4 }))
    expect(p).toMatchObject({ state: 'ready', group: 'connected', switch: 'on', mode: 'manage', next: null, tone: 'success' })
    const t = (key: string, options?: Record<string, unknown>): string => `${key}|${JSON.stringify(options ?? {})}`
    expect(agentLineText(t, p.listLine)).toContain('"model":"gpt-5.5"')
    expect(agentLineText(t, p.listLine)).toContain('"mode":"adeCredential.nativeLogin|{}"')
    expect(p.statusLine.key).toBe('agentCenter.state.ready.statusModels')
  })

  it('names the Agent default model when none is chosen', () => {
    const p = agentPresentation(row(), ctx({ enabled: true }))
    expect(p.listLine.params).toMatchObject({ modelKey: 'agentEnablement.nativeDefault' })
    expect(p.statusLine.key).toBe('agentCenter.state.ready.status')
  })

  it('needs a re-check after a settings change and keeps the switch on', () => {
    const p = agentPresentation(row(), ctx({ enabled: true, changed: true }))
    expect(p).toMatchObject({ state: 'needsRecheck', switch: 'on', mode: 'manage', next: { kind: 'recheck' } })
    expect(p.statusLine.key).toBe('agentCenter.state.needsRecheck.statusChanged')
  })

  it('needs a re-check when the runtime has no proof for an enabled Agent', () => {
    const p = agentPresentation(unproven(), ctx({ enabled: true }))
    expect(p).toMatchObject({ state: 'needsRecheck', switch: 'on', next: { kind: 'recheck' } })
  })

  it('keeps an enabled Agent on when its account is signed out and offers the sign-in command', () => {
    const p = agentPresentation(unproven({ login: 'signed-out', reasonCode: 'signed_out' }), ctx({ enabled: true }))
    expect(p).toMatchObject({ state: 'signedOut', switch: 'on', mode: 'manage',
      next: { kind: 'login', command: 'x auth login', note: 'Opens a browser' } })
  })

  it('falls back to a re-check when there is no sign-in command', () => {
    const p = agentPresentation({ ...unproven({ login: 'signed-out', reasonCode: 'signed_out' }), definition: { ...row({ setup: null }).definition } }, ctx({ enabled: true }))
    expect(p).toMatchObject({ state: 'signedOut', next: { kind: 'recheck' } })
  })

  it('sends a provider-only SDK to provider settings instead of a CLI login', () => {
    const sdk = row({ id: 'cursor', transport: 'cursor-sdk', credentialModes: ['provider'] })
    const p = agentPresentation({ ...sdk, readyProfiles: [], enabled: true, status: { ...sdk.status, login: 'signed-out', reasonCode: 'signed_out' } }, ctx({ enabled: true }))
    expect(p).toMatchObject({ state: 'signedOut', next: { kind: 'configureProvider' } })
  })

  it('reports a failed handshake as a connection failure with a re-check', () => {
    const p = agentPresentation(unproven({ ready: 'no', reasonCode: 'handshake_failed' }), ctx({ enabled: true }))
    expect(p).toMatchObject({ state: 'connectFailed', switch: 'on', mode: 'manage', next: { kind: 'recheck' } })
  })

  it('never turns an enabled Agent off by itself when something is wrong', () => {
    const problems: Array<Partial<AdeHarnessRow['status']>> = [
      { login: 'signed-out', reasonCode: 'signed_out' }, { ready: 'no', reasonCode: 'handshake_failed' }, {}
    ]
    for (const status of problems) {
      expect(agentPresentation(unproven(status), ctx({ enabled: true })).switch).toBe('on')
    }
  })

  it('never offers a built-in install command for an Agent the user defined', () => {
    const custom = row({ status: { installed: 'no', reasonCode: 'not_installed' } })
    custom.definition.builtin = false
    expect(agentPresentation(custom, ctx()).next).toBeNull()
  })

  it('treats Kun as always ready', () => {
    const kun = row({ id: 'kun', transport: 'native-loop', setup: null })
    expect(agentPresentation(kun, ctx({ enabled: true }))).toMatchObject({ state: 'ready', group: 'connected', mode: 'manage' })
  })
})

describe('agentLineText', () => {
  it('translates *Key parameters into their base name', () => {
    const t = (key: string, options?: Record<string, unknown>): string => options ? `${key}:${JSON.stringify(options)}` : `<${key}>`
    expect(agentLineText(t, { key: 'k', params: { modeKey: 'm', count: 2 } })).toBe('k:{"mode":"<m>","count":2}')
  })
})
