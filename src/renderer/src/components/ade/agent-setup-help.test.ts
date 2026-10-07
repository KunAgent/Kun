import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

const f = vi.hoisted(() => ({
  roomsRequest: vi.fn(), get: vi.fn(), append: vi.fn(), resolveBot: vi.fn(), open: vi.fn()
}))
vi.mock('../rooms/rooms-client', () => ({ roomsRequest: f.roomsRequest, roomsClient: { get: f.get }, roomRequestId: () => 'req-1' }))
vi.mock('../rooms/workbench-bridge-actions', () => ({ appendRoomDraft: f.append, resolveBotRoomId: f.resolveBot }))
vi.mock('../rooms/agent-chat-navigation', () => ({ openAgentConversationRoom: f.open }))
vi.mock('../../store/harness-store', () => ({ useHarnessStore: { getState: () => ({
  rows: [{ definition: { id: 'droid', displayName: 'Factory Droid' } }]
}) } }))

import { agentSetupHelpPrompt, askKunAboutAgentSetup } from './agent-setup-help'

beforeAll(async () => { await i18n.changeLanguage('en') })
beforeEach(() => { vi.clearAllMocks() })

describe('agentSetupHelpPrompt', () => {
  it('drafts the failure facts, a fenced log tail and safety instructions', () => {
    const prompt = agentSetupHelpPrompt({
      harnessId: 'dsh', operation: 'install', command: 'npm install -g @deepseek-ai/dsh',
      error: 'Installer exited with code 1', output: 'npm error code EEXIST\n```\nnpm error path /Users/me/.local/bin/dsh',
      currentVersion: '0.0.1', currentPath: '/Users/me/.local/bin/dsh', targetVersion: '0.2.0'
    }, 'DeepSeek Harness')
    expect(prompt).toContain('Kun failed to install the third-party Agent "DeepSeek Harness"')
    expect(prompt).toContain('- Agent: DeepSeek Harness (dsh)')
    expect(prompt).toContain('- Command run: `npm install -g @deepseek-ai/dsh`')
    expect(prompt).toContain('- Currently using: 0.0.1 · /Users/me/.local/bin/dsh')
    expect(prompt).toContain('- Target version: 0.2.0')
    expect(prompt).toContain('- Error: Installer exited with code 1')
    expect(prompt).toContain("```text\nnpm error code EEXIST\n'''\nnpm error path /Users/me/.local/bin/dsh\n```")
    expect(prompt).toContain('Ask before deleting or overwriting files or using sudo.')
  })

  it('keeps only the end of a long log and omits facts it does not have', () => {
    const prompt = agentSetupHelpPrompt({ harnessId: 'opencode', operation: 'update', output: 'x'.repeat(10_000) + 'LAST LINE' }, 'OpenCode')
    expect(prompt).toContain('Kun failed to update the third-party Agent "OpenCode"')
    expect(prompt).toContain('…')
    expect(prompt).toContain('LAST LINE')
    expect(prompt.length).toBeLessThan(7_500)
    expect(prompt).not.toContain('Command run')
    expect(prompt).not.toContain('Target version')
  })
})

describe('askKunAboutAgentSetup', () => {
  it('drafts into the default 小 Kun chat and opens it without sending', async () => {
    f.roomsRequest.mockResolvedValue({ roomId: 'room-kun' })
    f.get.mockResolvedValue({ room: { id: 'room-kun' } })
    await askKunAboutAgentSetup({ harnessId: 'droid', operation: 'update', error: 'verification failed' })
    expect(f.roomsRequest).toHaveBeenCalledWith('/v1/agents/chat-entry', 'POST', { action: 'initialize', clientRequestId: 'req-1' })
    expect(f.append).toHaveBeenCalledWith('room-kun', { body: expect.stringContaining('"Factory Droid"') })
    expect(f.open).toHaveBeenCalledWith('room-kun')
    expect(f.resolveBot).not.toHaveBeenCalled()
  })

  it('falls back to another private chat when 小 Kun was deleted', async () => {
    f.roomsRequest.mockResolvedValue({ roomId: 'room-kun' })
    f.get.mockResolvedValue({ room: { id: 'room-kun', deletedAt: '2026-10-07T00:00:00.000Z' } })
    f.resolveBot.mockResolvedValue('room-other')
    await askKunAboutAgentSetup({ harnessId: 'droid', operation: 'install' })
    expect(f.append).toHaveBeenCalledWith('room-other', expect.anything())
    expect(f.open).toHaveBeenCalledWith('room-other')
  })

  it('reports an unavailable chat instead of opening a deleted one', async () => {
    f.roomsRequest.mockResolvedValue({ roomId: 'room-kun' })
    f.get.mockRejectedValue(new Error('not found'))
    f.resolveBot.mockResolvedValue('room-kun')
    await expect(askKunAboutAgentSetup({ harnessId: 'droid', operation: 'install' })).rejects.toThrow("Kun's private chat isn't available")
    expect(f.append).not.toHaveBeenCalled()
    expect(f.open).not.toHaveBeenCalled()
  })
})
