import { describe, expect, it, vi } from 'vitest'
import { ApprovalDialog } from './runtime-dialogs.js'
import type { TuiController } from './controller.js'
import { stripAnsi } from './layout.js'
import { buildGoogleWorkspaceApprovalAction, buildGoogleWorkspaceApprovalSummary } from '../google-workspace/approval.js'
import type { ToolHostContext } from '../ports/tool-host.js'

describe('Google Workspace TUI complete approval', () => {
  it('wraps and scrolls through complete recipients and text before an explicit choice', () => {
    const controller = { state: {}, decideApproval: vi.fn() } as unknown as TuiController
    const text = 'Full body '.repeat(220) + 'FINAL_BODY_MARKER'
    const action = buildGoogleWorkspaceApprovalAction({ toolName: 'google_workspace_call', callId: 'id', arguments: {
      method: 'gmail.users.messages.send', body: { to: ['to@example.com'], bcc: ['secret@example.com'], subject: 'Approved subject', text }
    } }, { workspace: '/tmp' } as ToolHostContext)
    const dialog = new ApprovalDialog(controller, 'google_workspace_call', buildGoogleWorkspaceApprovalSummary(action), () => 30)
    const observed: string[] = []
    for (let i = 0; i < 150; i++) {
      observed.push(dialog.render(60).map(stripAnsi).join('\n'))
      dialog.handleInput('j')
    }
    const all = observed.join('\n')
    expect(all).toContain('secret@example.com')
    expect(all).toContain('Approved subject')
    expect(all).toContain('FINAL_BODY_MARKER')
    expect(controller.decideApproval).not.toHaveBeenCalled()
    dialog.handleInput('y')
    expect(controller.decideApproval).toHaveBeenCalledWith('allow')
  })
})
