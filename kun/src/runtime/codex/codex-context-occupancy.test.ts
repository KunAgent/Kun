import { describe, expect, it } from 'vitest'
import { codexContextOccupancy } from './codex-context-occupancy.js'
import { CodexEventMapper } from './codex-event-mapper.js'
import { CODEX_NOTIFICATIONS } from './codex-protocol.js'

const usage = (last: number, total: number, window: number | null = 828_400) => ({
  threadId: 'cx', turnId: 't',
  tokenUsage: {
    last: { inputTokens: last - 400, cachedInputTokens: last - 6_000, outputTokens: 400, reasoningOutputTokens: 100, totalTokens: last },
    total: { inputTokens: total - 4_000, cachedInputTokens: total - 60_000, outputTokens: 4_000, reasoningOutputTokens: 1_000, totalTokens: total },
    modelContextWindow: window
  }
})

describe('Codex context occupancy', () => {
  it('uses the latest call against the effective window, with the auto-compaction point', () => {
    expect(codexContextOccupancy(usage(107_624, 618_643).tokenUsage)).toEqual({ usedTokens: 107_624, windowTokens: 828_400, autoCompactTokens: 784_800 })
    expect(codexContextOccupancy({ last: { totalTokens: 1 }, modelContextWindow: 950_000 })?.autoCompactTokens).toBe(900_000)
    expect(codexContextOccupancy(usage(1, 2, null).tokenUsage)).toBeUndefined()
  })

  it('reports the latest call, not the growing thread total, across a long tool loop', () => {
    // Figures from a real gpt-6.1-sol thread: each call re-sends the context, so
    // the thread total passed 600k while the context held about 108k.
    const mapper = new CodexEventMapper({ threadId: 'thr', turnId: 'turn', codexThreadId: 'cx', model: 'gpt-6.1-sol' })
    const calls: Array<[number, number]> = [[20_185, 20_185], [23_405, 43_590], [101_641, 511_019], [107_624, 618_643]]
    const snapshots = calls.flatMap(([last, total]) => mapper.mapNotification(CODEX_NOTIFICATIONS.threadTokenUsageUpdated, usage(last, total)))
      .filter((draft) => draft.kind === 'context_snapshot')
    expect(snapshots.map((snapshot) => (snapshot as { estimatedInputTokens: number }).estimatedInputTokens)).toEqual([20_185, 23_405, 101_641, 107_624])
    expect(snapshots.at(-1)).toMatchObject({ contextWindowTokens: 828_400, softThresholdTokens: 784_800, hardThresholdTokens: 828_400,
      breakdown: { tools: 0, system: 0, skills: 0, messages: 107_624, other: 0 },
      contextManagement: 'sdk-managed', nativeHistory: 'known', occupancySource: 'agent' })
  })
})
