import { describe, expect, it } from 'vitest'
import { approvalKind, approvalOptionRows } from './approval-kind'

const t = (key: string) => key

describe('approval kind and decision rows', () => {
  it('classifies Gmail sends, commands and other tools', () => {
    expect(approvalKind({ kind: 'external-effect', toolName: 'gmail_send',
      arguments: { to: ['a@example.com'], subject: 'Hi', body: 'Body', from: 'me@example.com' } }))
      .toMatchObject({ kind: 'email', email: { to: ['a@example.com'], from: 'me@example.com' } })
    expect(approvalKind({ kind: 'command', cwd: '/repo', arguments: { command: 'ls' } }))
      .toEqual({ kind: 'command', command: 'ls', cwd: '/repo' })
    expect(approvalKind({ kind: 'mcp', toolName: 'x', arguments: {} })).toEqual({ kind: 'other' })
  })

  it('offers send / do-not-send for mail without runtime options', () => {
    const rows = approvalOptionRows(approvalKind({ kind: 'external-effect', toolName: 'gmail_send',
      arguments: { to: ['a@example.com'], subject: 'Hi', body: 'Body' } }), undefined, t)
    expect(rows.rows).toEqual([{ label: 'approvalEmailSend', decision: 'allow' }])
    expect(rows.deny).toEqual({ label: 'approvalEmailDontSend', decision: 'deny' })
  })

  it('keeps runtime scopes and routes the deny row through reject_once', () => {
    const rows = approvalOptionRows({ kind: 'command', command: 'rm -rf build' }, [
      { optionId: 'once', name: '', kind: 'allow_once' },
      { optionId: 'always', name: 'Always allow rm', kind: 'allow_always' },
      { optionId: 'no', name: '', kind: 'reject_once' }
    ], t)
    expect(rows.rows).toEqual([
      { label: 'approvalOption_allow_once', decision: 'allow', choice: { optionId: 'once' } },
      { label: 'Always allow rm', decision: 'allow', choice: { optionId: 'always' } }
    ])
    expect(rows.deny).toEqual({ label: 'approvalDeny', decision: 'deny', choice: { optionId: 'no' } })
  })
})
