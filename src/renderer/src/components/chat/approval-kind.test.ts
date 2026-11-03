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
    const rows = approvalOptionRows('email', undefined, t)
    expect(rows.rows).toEqual([{ label: 'approvalEmailSend', decision: 'allow' }])
    expect(rows.deny).toEqual({ label: 'approvalEmailDontSend', decision: 'deny' })
  })

  it('offers allow once / deny once for other requests without runtime options', () => {
    const rows = approvalOptionRows('command', undefined, t)
    expect(rows.rows).toEqual([{
      label: 'composerApproval.option.allow', description: { text: 'composerApproval.option.once' }, decision: 'allow'
    }])
    expect(rows.deny).toEqual({
      label: 'composerApproval.option.deny', description: { text: 'composerApproval.option.denyOnce' }, decision: 'deny'
    })
  })

  it('keeps runtime scopes and routes the deny row through reject_once', () => {
    const rows = approvalOptionRows('command', [
      { optionId: 'once', name: '', kind: 'allow_once' },
      { optionId: 'always', name: 'Always allow rm', kind: 'allow_always' },
      { optionId: 'no', name: '', kind: 'reject_once' }
    ], t)
    expect(rows.rows).toEqual([
      { label: 'composerApproval.option.allow', description: { text: 'composerApproval.option.once' },
        decision: 'allow', choice: { optionId: 'once' } },
      { label: 'composerApproval.option.allowAlways', description: { text: 'Always allow rm' },
        decision: 'allow', choice: { optionId: 'always' } }
    ])
    expect(rows.deny).toEqual({ label: 'composerApproval.option.deny', description: { text: 'composerApproval.option.denyOnce' },
      decision: 'deny', choice: { optionId: 'no' } })
  })

  it('cancels when the runtime offers no reject-once option', () => {
    const rows = approvalOptionRows('other', [
      { optionId: 'once', name: 'Allow', kind: 'allow_once' },
      { optionId: 'never', name: 'Reject always', kind: 'reject_always' }
    ], t)
    expect(rows.rows.map((row) => [row.label, row.decision])).toEqual([
      ['composerApproval.option.allow', 'allow'],
      ['composerApproval.option.denyAlways', 'deny']
    ])
    expect(rows.rows[1].description).toEqual({ text: 'composerApproval.option.denyAlwaysSession' })
    expect(rows.deny.choice).toEqual({ cancelled: true })
  })
})
