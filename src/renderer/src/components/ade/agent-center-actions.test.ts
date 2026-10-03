import { withHarnessReadiness } from '@shared/test-support/harness-readiness'
import { describe, expect, it } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import {
  agentCardModel,
  setupInstallCommand,
  setupLoginCommand
} from './agent-center-actions'

function makeRow(overrides: {
  id?: string
  builtin?: boolean
  status?: Partial<AdeHarnessRow['status']>
  setup?: AdeHarnessRow['definition']['setup']
  credentialModes?: AdeHarnessRow['definition']['credentialModes']
} = {}): AdeHarnessRow {
  const id = overrides.id ?? 'claude-code'
  return withHarnessReadiness({
    definition: {
      id,
      displayName: id,
      transport: id === 'kun' ? 'native-loop' : 'acp',
      credentialModes: overrides.credentialModes ?? ['native-login'],
      permissionModes: [],
      modelSource: 'probe',
      staticModels: [],
      builtin: overrides.builtin ?? true,
      ...(overrides.setup ? { setup: overrides.setup } : {})
    },
    status: {
      harnessId: id,
      installed: 'yes',
      login: 'signed-in',
      checkedAt: '2026-01-01T00:00:00.000Z',
      ...overrides.status
    }
  })
}

const SETUP = {
  install: [
    { platform: 'darwin' as const, command: 'brew install x' },
    { platform: 'any' as const, command: 'npm i -g x' }
  ],
  login: { command: 'x', args: ['auth', 'login'], note: 'n' },
  adapter: { command: 'x-acp', install: 'npm i -g x-acp' },
  docsUrl: 'https://example.test'
}

describe('agentCardModel', () => {
  it('offers explicit Devin CLI sign-in when an installed ACP account is unconfirmed', () => {
    const model = agentCardModel(makeRow({ id: 'devin', status: { login: 'unknown' },
      credentialModes: ['native-login'], setup: { login: { command: 'devin', args: ['auth', 'login'] } }
    }), { enabled: true, platform: 'darwin', isDefault: false })
    expect(model.primary.kind).toBe('test')
    expect(model.secondary).toContainEqual(expect.objectContaining({ kind: 'command', command: 'devin auth login' }))
    expect(model.reasonCode).toBeNull()
  })

  it('configures the Cursor SDK provider instead of using a stale CLI login command', () => {
    const row = makeRow({ id: 'cursor', credentialModes: ['provider'], status: { login: 'signed-out' }, setup: SETUP })
    row.definition.transport = 'cursor-sdk'
    const model = agentCardModel(row, { enabled: true, platform: 'darwin', isDefault: false })
    expect(model.primary).toEqual({ kind: 'configureProvider', labelKey: 'adeAgentAction.configureProvider' })
    expect(model.secondary.some((action) => action.kind === 'command' || action.kind === 'specifyPath')).toBe(false)
  })

  it('detecting rows get no actions', () => {
    const model = agentCardModel(
      makeRow({ status: { installed: 'unknown', detecting: true } }),
      { enabled: true, platform: 'darwin', isDefault: false }
    )
    expect(model.state).toBe('detecting')
    expect(model.primary.kind).toBe('none')
    expect(model.secondary).toEqual([])
  })

  it('disabled rows only offer enable', () => {
    const model = agentCardModel(makeRow(), {
      enabled: false, platform: 'darwin', isDefault: false
    })
    expect(model.state).toBe('disabled')
    expect(model.primary.kind).toBe('enable')
  })

  it('not_installed delegates installer selection to the host on every renderer platform', () => {
    const row = makeRow({ status: { installed: 'no', login: 'unknown' }, setup: SETUP })
    const darwin = agentCardModel(row, { enabled: true, platform: 'darwin', isDefault: false })
    expect(darwin.primary).toMatchObject({ kind: 'install', action: 'install' })
    const linux = agentCardModel(row, { enabled: true, platform: 'linux', isDefault: false })
    expect(linux.primary).toMatchObject({ kind: 'install', action: 'install' })
    expect(linux.secondary.map((a) => a.kind)).toContain('specifyPath')
  })

  it('adapter_missing offers the adapter install command', () => {
    const row = makeRow({
      status: { installed: 'no', login: 'unknown', reasonCode: 'adapter_missing' },
      setup: SETUP
    })
    const model = agentCardModel(row, { enabled: true, platform: 'linux', isDefault: false })
    expect(model.primary).toMatchObject({ kind: 'install', action: 'adapter' })
  })

  it('falls back to the docs link when no install command exists', () => {
    const row = makeRow({
      status: { installed: 'no', login: 'unknown' },
      setup: { docsUrl: 'https://example.test' }
    })
    const model = agentCardModel(row, { enabled: true, platform: 'darwin', isDefault: false })
    expect(model.primary).toMatchObject({ kind: 'docs', url: 'https://example.test' })
  })

  it('signed_out prefills the login command', () => {
    const row = makeRow({ status: { login: 'signed-out' }, setup: SETUP })
    const model = agentCardModel(row, { enabled: true, platform: 'darwin', isDefault: false })
    expect(model.primary).toMatchObject({ kind: 'command', command: 'x auth login' })
  })

  it('handshake_timeout retries; signed_out outranks it on the wire', () => {
    const timeout = agentCardModel(
      makeRow({ status: { ready: 'unknown', login: 'signed-in' } }),
      { enabled: true, platform: 'darwin', isDefault: false }
    )
    // Unknown protocol readiness can no longer admit a new route.
    expect(timeout.state).toBe('unavailable')
    const advisory = agentCardModel(
      makeRow({ status: { ready: 'unknown', login: 'signed-in', reasonCode: 'handshake_timeout' } }),
      { enabled: true, platform: 'darwin', isDefault: false }
    )
    expect(advisory.reasonCode).toBe('handshake_timeout')
    expect(advisory.primary.kind).toBe('probe')
    expect(advisory.state).toBe('unavailable')
  })

  it('ready rows offer test + setDefault + disable', () => {
    const model = agentCardModel(makeRow(), {
      enabled: true, platform: 'darwin', isDefault: false
    })
    expect(model.state).toBe('ready')
    expect(model.primary.kind).toBe('test')
    expect(model.secondary.map((a) => a.kind)).toEqual(['setDefault', 'disable'])
  })

  it('kun keeps no setDefault/disable and no setup actions', () => {
    const model = agentCardModel(makeRow({ id: 'kun' }), {
      enabled: true, platform: 'darwin', isDefault: true
    })
    expect(model.secondary).toEqual([])
  })

  it('custom definitions never expose builtin setup commands', () => {
    const row = makeRow({
      builtin: false,
      status: { installed: 'no', login: 'unknown' },
      setup: SETUP
    })
    const model = agentCardModel(row, { enabled: true, platform: 'darwin', isDefault: false })
    expect(model.primary.kind).not.toBe('command')
  })

  it('P4-13: a ready terminal agent offers no test/setDefault/disable', () => {
    const row = makeRow({ builtin: false })
    row.definition.transport = 'terminal'
    const model = agentCardModel(row, {
      enabled: true, platform: 'darwin', isDefault: false
    })
    expect(model.state).toBe('ready')
    expect(model.primary.kind).toBe('none')
    expect(model.secondary).toEqual([])
  })

  it('P4-13: a missing terminal agent still surfaces install-path actions', () => {
    const row = makeRow({
      builtin: false,
      status: { installed: 'no', login: 'unknown', reasonCode: 'not_installed' }
    })
    row.definition.transport = 'terminal'
    const model = agentCardModel(row, { enabled: true, platform: 'darwin', isDefault: false })
    expect(model.state).toBe('unavailable')
    expect(model.primary.kind).toBe('probe')
    expect(model.secondary.map((a) => a.kind)).toContain('specifyPath')
  })
})

describe('setupInstallCommand', () => {
  it('returns null without install entries', () => {
    expect(setupInstallCommand(undefined, 'darwin')).toBeNull()
    expect(setupInstallCommand({}, 'darwin')).toBeNull()
  })
})

describe('setupLoginCommand', () => {
  it('joins command and args for the terminal prefill', () => {
    expect(setupLoginCommand(SETUP)).toMatchObject({ command: 'x auth login' })
    expect(setupLoginCommand({ login: { command: 'x', args: [] } })).toMatchObject({ command: 'x' })
  })
})
