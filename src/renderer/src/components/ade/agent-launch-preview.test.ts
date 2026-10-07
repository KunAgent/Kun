import { describe, expect, it } from 'vitest'
import { SECRET_MASK, launchPreview } from './agent-launch-preview'

describe('launchPreview', () => {
  it('writes environment, command and arguments in the order a shell reads them', () => {
    expect(launchPreview({ command: '/opt/homebrew/bin/codex', args: ['app-server', '--listen'], env: { CODEX_HOME: '~/.codex-work' }, secretNames: [] }))
      // A tilde is passed to the Agent literally, so it is quoted rather than shown as if a shell expanded it.
      .toBe(`CODEX_HOME='~/.codex-work' /opt/homebrew/bin/codex app-server --listen`)
  })

  it('masks credential-store variables and never prints a value for them', () => {
    const text = launchPreview({ command: 'codemaker', args: ['acp'], env: { PLAIN: '1', TOKEN: 'must-not-print' }, secretNames: ['TOKEN', 'OTHER'] })
    expect(text).toBe(`PLAIN=1 TOKEN=${SECRET_MASK} OTHER=${SECRET_MASK} codemaker acp`)
    expect(text).not.toContain('must-not-print')
  })

  it('quotes words with spaces or quotes', () => {
    expect(launchPreview({ command: '/Applications/My Agent/agent', args: ["it's"], env: {}, secretNames: [] }))
      .toBe(`'/Applications/My Agent/agent' 'it'\\''s'`)
  })

  it('handles an unknown command', () => {
    expect(launchPreview({ args: [], env: {}, secretNames: [] })).toBe('')
  })
})
