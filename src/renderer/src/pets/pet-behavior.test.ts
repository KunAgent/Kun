import { describe, expect, it } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import { PET_NOTIFICATION_TTL_MS, PET_ROWS } from '@shared/pets'
import { frameAtElapsedMs, frameDurationMs, staticFrame, totalCycleDurationMs } from './pet-animation'
import { acceptPetSnapshot, applyPetResultText, highestPetStatus, latestAssistantPreview, petWorkProcessText, presentPetRunningItem, projectPetActivity, semanticSnapshotKey, visiblePetNotifications } from './pet-activity'
import { petConversationSupplements } from './pet-conversation-threads'
import { queuePetNavigation, resolvePetThreadTarget } from './pet-navigation'
import { petContextMenuLabels } from './pet-menu-labels'
import { classifyPointerGesture, nextMascotWidth, overlayKeyAction, pointInsidePetHit, welcomeUntil } from './pet-pointer'
import { deliverPetFollowUp, petBubbleBody, petBubbleClock } from './pet-follow-up'
import { petBubbleAllowed } from './pet-publisher'

describe('pet animation and interaction', () => {
  it('maps nine rows, holds open eyes, and returns to idle after three transient cycles', () => {
    for (const state of Object.keys(PET_ROWS) as Array<keyof typeof PET_ROWS>) {
      expect(frameAtElapsedMs(state, 0, 2).row).toBe(PET_ROWS[state].row)
    }
    expect(frameDurationMs('idle', 0)).toBe(PET_ROWS.idle.frameDurationsMs[0])
    const elapsed = totalCycleDurationMs('waiting') * 3
    expect(frameAtElapsedMs('waiting', elapsed, 2).row).toBe(PET_ROWS.idle.row)
    expect(staticFrame('running', 2).column).toBe(0)
  })

  it('classifies pointer gestures, welcomes once, and clamps scale', () => {
    expect(classifyPointerGesture({ cancelled: true, dx: 1, dy: 1 })).toBe('cancel')
    expect(classifyPointerGesture({ cancelled: false, dx: 3, dy: 0 })).toBe('click')
    expect(classifyPointerGesture({ cancelled: false, dx: 4, dy: 0 })).toBe('drag')
    const hit = { left: 10, top: 20, right: 80, bottom: 120 }
    expect(pointInsidePetHit({ x: 10, y: 20 }, hit)).toBe(true)
    expect(pointInsidePetHit({ x: 80, y: 120 }, hit)).toBe(true)
    expect(pointInsidePetHit({ x: 9, y: 40 }, hit)).toBe(false)
    expect(pointInsidePetHit({ x: 40, y: 40 }, null)).toBe(false)
    expect(pointInsidePetHit({ x: 0, y: 0 }, { left: 0, top: 0, right: 0, bottom: 10 })).toBe(false)
    expect(welcomeUntil('kun:dot', [], 1_000)).toBe(9_000)
    expect(welcomeUntil('kun:dot', ['kun:dot'], 1_000)).toBeNull()
    expect(nextMascotWidth(80, -1)).toBe(80)
    expect(nextMascotWidth(112, 1)).toBe(128)
    expect(nextMascotWidth(224, 1)).toBe(224)
    expect(overlayKeyAction('Enter')).toBe('reply')
    expect(overlayKeyAction('Escape')).toBe('close')
    expect(petContextMenuLabels('zh-CN')).toEqual({ settings: '设置', hide: '隐藏', ensemble: '叫朋友来玩' })
    expect(petContextMenuLabels('en-US').settings).toBe('Settings')
    expect(petContextMenuLabels('fr').hide).toBe('Hide')
  })
})

describe('pet activity projection', () => {
  it('prefers activity rows, drops restored rows, and dedupes the same thread event', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const snapshot = projectPetActivity({
      generation: 3,
      profileKey: 'profile',
      nowMs: now,
      rows: [
        row({ unitId: 'root', state: 'working', turnId: 'turn-1' }),
        row({ unitId: 'child', state: 'working', turnId: 'turn-1', parentThreadId: 'root' }),
        row({ unitId: 'wait', threadId: 'thr-wait', state: 'waiting' }),
        row({ unitId: 'old', state: 'done', restoredUnconfirmed: true }),
        row({ unitId: 'cancelled', threadId: 'thr-cancel', state: 'done', lastOutcome: 'cancelled' }),
        row({ unitId: 'stalled', threadId: 'thr-stall', state: 'working', stalled: true })
      ],
      supplements: [{ threadId: 'thr', title: 'Duplicate', latestTurnStatus: 'running' }, { threadId: 'plain', title: 'Plain', latestTurnStatus: 'failed', latestTurnId: 'turn-9' }]
    })
    expect(snapshot.items.map((item) => item.unitId).sort()).toEqual(['child', 'plain', 'stalled', 'wait'])
    const finished = projectPetActivity({
      generation: 4,
      profileKey: 'profile',
      nowMs: now,
      rows: [row({ unitId: 'idle-row', threadId: 'chat', state: 'idle', mainState: 'idle' })],
      supplements: [{ threadId: 'chat', title: 'Chat', status: 'idle', latestTurnStatus: 'completed', updatedAt: '2026-01-01T00:00:00.000Z' }]
    })
    expect(finished.items).toMatchObject([{ threadId: 'chat', status: 'review' }])
    const privateChat = projectPetActivity({
      generation: 5,
      profileKey: 'profile',
      nowMs: now + PET_NOTIFICATION_TTL_MS.review + 5_000,
      rows: [row({ unitId: 'old-done', threadId: 'dm', state: 'done', stateSince: new Date(now).toISOString() })],
      supplements: [{ threadId: 'dm', title: '小 Kun', status: 'running', latestTurnStatus: 'running', updatedAt: new Date(now).toISOString() }]
    })
    expect(privateChat.items).toEqual(expect.arrayContaining([expect.objectContaining({ threadId: 'dm', status: 'running' })]))
    expect(visiblePetNotifications(privateChat, new Set(), now + 10 * 60_000).some((item) => item.threadId === 'dm' && item.status === 'running')).toBe(true)
    expect(petConversationSupplements([
      { id: 'dm', title: '小 Kun', status: 'running', relation: 'side', updatedAt: '2026-01-01T00:00:00.000Z', roomContext: { roomId: 'room', memberId: 'member', kind: 'coordination' } },
      { id: 'proj', title: 'Project', status: 'running', relation: 'primary', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'gone', title: 'Archived', status: 'running', relation: 'side', archived: true, updatedAt: '2026-01-01T00:00:00.000Z' }
    ], new Set(['proj']))).toEqual([expect.objectContaining({ threadId: 'dm', roomId: 'room', title: '小 Kun' })])
    expect(snapshot.items.find((item) => item.unitId === 'stalled')).toMatchObject({ status: 'failed', stalled: true, subtitle: 'Stalled' })
    expect(highestPetStatus(snapshot.items)).toBe('waiting')
    expect(acceptPetSnapshot(snapshot, { ...snapshot, generation: 2 })).toBe(snapshot)
  })

  it('expires from the transition time, keeps the next turn, and limits replay', async () => {
    const since = '2026-01-01T00:00:00.000Z'
    const snapshot = projectPetActivity({
      generation: 1,
      profileKey: 'profile',
      nowMs: Date.parse(since),
      rows: [row({ state: 'failed', stateSince: since })],
      supplements: []
    })
    const key = snapshot.items[0].key
    const dismissed = new Set([key])
    expect(visiblePetNotifications(snapshot, dismissed, Date.parse(since) + 1_000)).toEqual([])
    expect(visiblePetNotifications(snapshot, new Set(), Date.parse(since) + PET_NOTIFICATION_TTL_MS.failed + 1)).toHaveLength(1)
    const review = projectPetActivity({
      generation: 1,
      profileKey: 'profile',
      nowMs: Date.parse(since),
      rows: [row({ state: 'done', stateSince: since, lastMessagePreview: '你好，我在。' })],
      supplements: []
    })
    expect(visiblePetNotifications(review, new Set(), Date.parse(since) + PET_NOTIFICATION_TTL_MS.review + 1_000)).toMatchObject([{ subtitle: '你好，我在。' }])
    expect(latestAssistantPreview([{ kind: 'user', text: '问候' }, { kind: 'assistant', text: '你好，我在。' }])).toBe('你好，我在。')
    expect(latestAssistantPreview([
      { kind: 'assistant', turnId: 'old', text: '我是 Kun，一个 AI 编程助手' },
      { kind: 'assistant', turnId: 'now', text: '' }
    ], 180, 'now')).toBe('')
    const running = projectPetActivity({
      generation: 1,
      profileKey: 'profile',
      nowMs: Date.parse(since),
      rows: [row({ state: 'working', stateSince: since, lastMessagePreview: '我是 Kun，一个 AI 编程助手' })],
      supplements: []
    }).items[0]
    const labels = { workingLabel: '分析中…', thinkingLabel: '思考中…', toolLabel: (action: string) => `正在${action}` }
    expect(petWorkProcessText({ thinking: false, ...labels })).toBe('分析中…')
    expect(petWorkProcessText({ thinking: true, toolAction: '读取', ...labels })).toBe('正在读取')
    const process = presentPetRunningItem(running, { processText: '分析中…', liveSinceMs: 1_000 })
    expect(process).toMatchObject({ subtitle: '分析中…', liveSinceMs: 1_000 })
    expect(presentPetRunningItem(process, { assistantText: '新的回答' }).liveSinceMs).toBeUndefined()
    expect(petBubbleClock('分析中…', 'running', 1_000, 8_300)).toBe('分析中… · 7.3s')
    expect(applyPetResultText([process], () => '我是 Kun，一个 AI 编程助手')).toMatchObject([{ subtitle: '分析中…' }])
    expect(applyPetResultText(review.items, () => '这是完整的回答')).toMatchObject([{ subtitle: '这是完整的回答' }])
    const nextSince = '2026-01-01T00:00:10.000Z'
    const next = projectPetActivity({
      generation: 1,
      profileKey: 'profile',
      nowMs: Date.parse(nextSince),
      rows: [row({ state: 'failed', stateSince: nextSince, turnId: 'turn-2' })],
      supplements: []
    })
    expect(visiblePetNotifications(next, dismissed, Date.parse(nextSince) + 1_000)).toHaveLength(1)
    expect(visiblePetNotifications(next, dismissed, Date.parse(nextSince) + 1_000, new Set(['other']))).toHaveLength(1)
    expect(visiblePetNotifications(snapshot, new Set(), Date.parse(since) + PET_NOTIFICATION_TTL_MS.failed + 1, new Set(['thr']))).toHaveLength(1)
    expect(petBubbleBody({ status: 'running', stalled: false, sending: false, queued: '继续' })).toBe('跟进消息将在本轮结束后发送')
    expect(petBubbleBody({ status: 'waiting', stalled: false, sending: true, queued: '继续' })).toBe('正在发送…')
    expect(petBubbleBody({ status: 'failed', stalled: true, sending: false })).toBe('这次运行遇到阻塞')
    expect(petBubbleAllowed({ preferenceEnabled: false })).toBe(false)
    expect(petBubbleAllowed({ preferenceEnabled: true })).toBe(true)
    await expect(deliverPetFollowUp({
      threadId: 'thr', prompt: '继续', knownThreadIds: new Set(['thr']),
      selectThread: async () => undefined, sendMessage: async () => true
    })).resolves.toEqual({ ok: true })
    await expect(deliverPetFollowUp({
      threadId: 'missing', prompt: '继续', knownThreadIds: new Set(['thr']),
      selectThread: async () => undefined, sendMessage: async () => true
    })).resolves.toMatchObject({ ok: false })
  })

  it('keeps dismissals across feed restarts while publishing changed summaries', () => {
    const input = {
      generation: 1, profileKey: 'profile', nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
      rows: [row({ state: 'waiting', progressNote: 'First summary' })], supplements: []
    }
    const first = projectPetActivity(input)
    const restarted = projectPetActivity({ ...input, generation: 3 })
    expect(restarted.items[0].key).toBe(first.items[0].key)
    expect(visiblePetNotifications(restarted, new Set([first.items[0].key]), input.nowMs)).toEqual([])
    expect(semanticSnapshotKey(restarted)).not.toBe(semanticSnapshotKey(first))
    const changed = projectPetActivity({ ...input, rows: [row({ state: 'waiting', progressNote: 'Updated summary' })] })
    expect(semanticSnapshotKey(changed)).not.toBe(semanticSnapshotKey(first))
    expect(changed.items[0].key).toBe(first.items[0].key)
  })

  it('does not activate a missing, protected, or unrelated thread', () => {
    expect(resolvePetThreadTarget({ request: { type: 'reply', threadId: 'missing' }, knownThreadIds: new Set(['current']) })).toEqual({ ok: false, reason: 'missing' })
    expect(resolvePetThreadTarget({ request: { type: 'open', threadId: 'room-thread', roomId: 'room' }, knownThreadIds: new Set(['room-thread']) })).toEqual({ ok: true, threadId: 'room-thread' })
    expect(queuePetNavigation({ ready: false, request: { type: 'reply', threadId: 'room-thread' }, pending: null }).deliver).toBeNull()
  })

  it('does not replace a newer event with an older bootstrap activity replay', () => {
    const current = projectPetActivity({
      generation: 1, profileKey: 'profile', nowMs: 2_000,
      rows: [row({ state: 'done', lastMessagePreview: 'Image ready' })], supplements: []
    })
    const stale = { ...current, emittedAtMs: 1_000, items: [{ ...current.items[0], status: 'running' as const }] }
    expect(acceptPetSnapshot(current, stale)).toBe(current)
    expect(acceptPetSnapshot(stale, current)).toBe(current)
  })
})

function row(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    unitId: 'unit',
    kind: 'thread',
    threadId: 'thr',
    harnessId: 'kun',
    title: 'Task',
    workspace: { path: '/ws', kind: 'local' },
    state: 'working',
    mainState: 'working',
    children: { working: 0, waiting: 0, done: 0, failed: 0 },
    stateSince: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    provenance: 'runtime',
    restoredUnconfirmed: false,
    stalled: false,
    visibility: 'active',
    residency: 'live',
    pinned: false,
    ...overrides
  }
}
