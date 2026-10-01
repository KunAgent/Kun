import { describe, expect, it } from 'vitest'
import type { ApprovalRequest } from '../../kun/src/domain/approval'
import { toolApprovalPresentation } from './tool-approval-presentation'

const request = (): ApprovalRequest => ({
  id: 'id', threadId: 'thread', turnId: 'turn', status: 'pending', createdAt: '2026-09-30',
  toolName: 'execute', summary: 'Requested action',
  action: { version: 1, kind: 'command', toolName: 'execute', workspace: '/workspace', cwd: '/workspace/app',
    arguments: { command: 'shortened...' }, targets: [{ kind: 'command', value: 'printf "hello"\ncat /exact/file' }], reason: 'Check files',
    effects: { network: false, externalWrite: false, processExecution: true, guiAutomation: false } }
})

describe('toolApprovalPresentation', () => {
  it('makes known file modifications explicit without labelling every file access a write', () => {
    const approval = request()
    approval.action!.kind = 'file'
    approval.toolName = 'write'
    expect(toolApprovalPresentation(approval, 'task', true).title).toBe('修改文件')
    approval.toolName = 'read'
    expect(toolApprovalPresentation(approval, 'task', false).title).toBe('Access files')
  })

  it('explains a standard policy confirmation without showing runtime terminology', () => {
    const approval = request()
    approval.action!.reason = 'runtime tool policy requires approval'
    expect(toolApprovalPresentation(approval, 'task', true).description).toBe('确认后，Agent 将执行下面的操作。')
    expect(toolApprovalPresentation(approval, 'task', false).description).not.toContain('runtime')
    approval.action!.reason = 'Needs access to a protected directory'
    expect(toolApprovalPresentation(approval, 'task', false).description).toBe(approval.action!.reason)
  })

  it('uses exact targets instead of shortened argument previews', () => {
    const approval = request()
    const result = toolApprovalPresentation(approval, 'Current task', false)
    expect(result.body).toBe(approval.action!.targets[0]!.value)
    expect(result.details).toContain('shortened...')
    expect(result.detailsLabel).toContain('may be shortened')
    expect(result.workspace).toBe('/workspace/app\nWorkspace: /workspace')
    expect(result.subtitle).toBe('Current task · execute')
    expect(result.footnote).toContain('only to this action')
  })

  it('preserves every target beyond the old 12000-character presentation limit', () => {
    const approval = request()
    approval.action!.targets = Array.from({ length: 16 }, (_, index) => ({ kind: 'file' as const, value: `/files/${index}/` + 'x'.repeat(1800) }))
    const result = toolApprovalPresentation(approval, 'task', true)
    expect(result.body.length).toBeGreaterThan(28000)
    for (const target of approval.action!.targets) expect(result.body).toContain(target.value)
    expect(result.bodyLabel).toBe('操作范围')
  })

  it('labels URLs, recipients, and commands without altering their contents', () => {
    const approval = request()
    approval.action!.targets = [{ kind: 'url', value: 'https://example.com/a?b=c' }, { kind: 'recipient', value: 'team@example.com' }]
    expect(toolApprovalPresentation(approval, 'task', false).body)
      .toBe('URL\nhttps://example.com/a?b=c\n\nRecipient\nteam@example.com')
  })

  it('supports older approvals using their runtime summary without inventing action details', () => {
    const approval = request()
    delete approval.action
    const result = toolApprovalPresentation(approval, 'task', false)
    expect(result.body).toBe('Requested action')
    expect(result.details).toBeUndefined()
    expect(result.kind).toBe('unknown')
  })
})
