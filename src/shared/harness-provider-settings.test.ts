import { describe, expect, it } from 'vitest'
import {
  agentCommandPath,
  agentExtraArgs,
  isUserAgent,
  userAgentEntry,
  userAgentOverride,
  withAgentCommandPath,
  withAgentLaunchPatch
} from './harness-provider-settings'

describe('harness provider settings edits', () => {
  it('sets and clears a builtin command path without leaving empty entries', () => {
    const set = withAgentCommandPath({}, 'codex', ' /opt/codex ')
    expect(set).toEqual({ codex: { command: '/opt/codex' } })
    expect(agentCommandPath(set, 'codex')).toBe('/opt/codex')
    expect(withAgentCommandPath(set, 'codex', '')).toEqual({})
    const patched = { codex: { command: '/opt/codex', env: { A: '1' } } }
    expect(withAgentCommandPath(patched, 'codex', '')).toEqual({ codex: { env: { A: '1' } } })
  })

  it('never clears the command a generic user Agent exists through', () => {
    const providers = { mine: { extends: 'acp', command: '/bin/mine' } }
    expect(withAgentCommandPath(providers, 'mine', '')).toEqual(providers)
    expect(withAgentCommandPath(providers, 'mine', '/bin/other').mine?.command).toBe('/bin/other')
    // A derived Agent falls back to its base command.
    expect(withAgentCommandPath({ fork: { extends: 'opencode', command: 'fork' } }, 'fork', ''))
      .toEqual({ fork: { extends: 'opencode' } })
  })

  it('edits appended arguments and environment', () => {
    const next = withAgentLaunchPatch({}, 'opencode', { args: ['--print-logs'], env: { OPENCODE_X: '1' } })
    expect(next).toEqual({ opencode: { args: { mode: 'append', values: ['--print-logs'] }, env: { OPENCODE_X: '1' } } })
    expect(agentExtraArgs(next, 'opencode')).toEqual(['--print-logs'])
    expect(withAgentLaunchPatch(next, 'opencode', { args: [], env: {} })).toEqual({})
    // Replaced arguments belong to a user Agent definition, not the extra-args field.
    expect(agentExtraArgs({ mine: { extends: 'acp', command: 'x', args: { mode: 'replace', values: ['--acp'] } } }, 'mine')).toEqual([])
  })

  it('edits credential-store variables without touching the other launch fields', () => {
    const base = withAgentLaunchPatch({}, 'opencode', { args: ['--x'], env: { A: '1' } })
    const withSecret = withAgentLaunchPatch(base, 'opencode', { secretEnv: [{ name: 'TOKEN', secretRef: 'ref-1' }] })
    expect(withSecret).toEqual({ opencode: { args: { mode: 'append', values: ['--x'] }, env: { A: '1' }, secretEnv: [{ name: 'TOKEN', secretRef: 'ref-1' }] } })
    expect(withAgentLaunchPatch(withSecret, 'opencode', { secretEnv: [] }).opencode).toEqual({ args: { mode: 'append', values: ['--x'] }, env: { A: '1' } })
    expect(withAgentLaunchPatch(withSecret, 'opencode', { args: [], env: {}, secretEnv: [] })).toEqual({})
  })

  it('round-trips a portable user Agent definition', () => {
    const entry = { id: 'fork', extends: 'opencode', displayName: 'Fork', command: '', args: [], env: {} }
    const override = userAgentOverride(entry)
    expect(override).toEqual({ extends: 'opencode', label: 'Fork' })
    expect(userAgentEntry({ fork: override }, 'fork')).toEqual(entry)
    expect(userAgentOverride({ id: 'mine', displayName: 'Mine', command: '/bin/mine', args: ['--acp'], env: { A: '1' } }))
      .toEqual({ extends: 'acp', label: 'Mine', command: '/bin/mine', args: { mode: 'replace', values: ['--acp'] }, env: { A: '1' } })
    expect(userAgentEntry({ tty: { extends: 'terminal', command: 'tty' } }, 'tty')).toBeUndefined()
    expect(isUserAgent({ tty: { extends: 'terminal', command: 'tty' }, codex: { command: 'x' } }, 'tty')).toBe(true)
    expect(isUserAgent({ codex: { command: 'x' } }, 'codex')).toBe(false)
  })
})
