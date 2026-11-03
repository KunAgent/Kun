import { describe, expect, it } from 'vitest'
import { projectSharedHistory } from './projection.js'
import type { ShareActor } from './contracts.js'
const actor: ShareActor = { ownerAccountId: 'owner', hostDeviceId: 'host', resourceHandle: 'handle', shareId: 'share',
  shareVersion: 1, guestAccountId: 'guest', deviceId: 'phone', memberId: 'member', memberVersion: 1, mode: 'read', expiresAt: Date.now() + 60000, sessionId: 'session' }
describe('shared read-only history lineage markers', () => {
  it('preserves opaque replacement markers and only the selected native reference projection', () => {
    const raw = { id: 'task', title: 'Shared', historyRefId: 'reference', eventScope: 'epoch', sourceHistory: { status: 'available',
      referenceId: 'reference', readOnly: true, path: '/private/history', provider: 'private-provider', warnings: ['private path'] },
      turns: [{ id: 'codex:source:turn', status: 'completed', providerId: 'secret-route', items: [{ id: 'source-item', turnId: 'codex:source:turn', kind: 'assistant_text', text: 'published source reply', sourceHistoryOrder: { referenceId: 'reference', turnIndex: 1, itemIndex: 2 } }] }],
      timeline: { hasMore: false, itemCount: 1, itemBytes: 100 } }
    const result = projectSharedHistory(raw, actor, [], 'version', 'reference')
    expect(result).toMatchObject({ historyRefId: 'reference', eventScope: 'epoch', sourceHistory: { status: 'available' }, turns: [{ items: [{ text: 'published source reply', sourceHistoryOrder: { referenceId: 'reference', turnIndex: 1, itemIndex: 2 } }] }] })
    for (const hidden of ['/private/history', 'secret-route', 'private-provider', 'private path']) expect(JSON.stringify(result)).not.toContain(hidden)
    const native = projectSharedHistory(raw, actor, [{ id: 'codex:source:turn', status: 'completed' } as any], 'version', 'reference')
    expect((native.turns as any[])[0].items[0]).not.toHaveProperty('sourceHistoryOrder')
    expect((projectSharedHistory(raw, actor, [], 'version', 'different').turns as unknown[])).toEqual([])
    expect((projectSharedHistory({ ...raw, sourceHistory: { ...raw.sourceHistory, status: 'disabled' } }, actor, [], 'version', 'reference').turns as unknown[])).toEqual([])
  })
})
