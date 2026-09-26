import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { activateThreadTurnTarget, mergeThreadTurnTarget, prepareThreadTurnTarget, useThreadTurnTarget } from './thread-turn-target'

const provider = vi.hoisted(() => ({ getThreadDetail: vi.fn() }))
vi.mock('../../agent/registry', () => ({ getProvider: () => provider }))
const block = (id: string, turnId: string, second: number): ChatBlock => ({
  id, turnId, kind: 'user', text: id, createdAt: `2026-09-13T00:00:${String(second).padStart(2, '0')}.000Z`
})
afterEach(() => { vi.clearAllMocks(); useThreadTurnTarget.setState({ target: null }) })

describe('external exact-turn navigation', () => {
  it('fetches the exact turn without accepting an alternative latest turn or an empty projection', async () => {
    provider.getThreadDetail.mockResolvedValue({ latestTurnId: 'new', blocks: [block('new', 'new', 50)] })
    await expect(prepareThreadTurnTarget('thread', 'old')).rejects.toThrow('Requested turn history is unavailable')
    expect(provider.getThreadDetail).toHaveBeenCalledWith('thread', { turnId: 'old', priority: 'foreground' })
    provider.getThreadDetail.mockResolvedValue({ latestTurnId: 'old', blocks: [] })
    await expect(prepareThreadTurnTarget('thread', 'old')).rejects.toThrow()
    expect(useThreadTurnTarget.getState().target).toBeNull()
  })

  it('merges only the selected thread and keeps the current projection authoritative without mutating it', async () => {
    const old = block('old', 'old', 20), current = [block('new', 'new', 50)]
    const detail = { blocks: [old], latestSeq: 3, latestTurnId: 'old' }
    provider.getThreadDetail.mockResolvedValue(detail)
    activateThreadTurnTarget('thread', 'old', await prepareThreadTurnTarget('thread', 'old'))
    const target = useThreadTurnTarget.getState().target
    expect(mergeThreadTurnTarget(current, target, 'thread').map((item) => item.id)).toEqual(['old', 'new'])
    expect(current.map((item) => item.id)).toEqual(['new'])
    expect(mergeThreadTurnTarget(current, target, 'another')).toBe(current)
    expect(mergeThreadTurnTarget(current, target, 'thread', ['old']).map((item) => item.id)).toEqual(['new'])
    const withEarlier = [block('earlier', 'earlier', 10), { ...old, text: 'newer snapshot' }, ...current]
    const merged = mergeThreadTurnTarget(withEarlier, target, 'thread')
    expect(merged.map((item) => item.id)).toEqual(['earlier', 'old', 'new'])
    expect(merged[1]).toMatchObject({ text: 'newer snapshot' })
  })
})
