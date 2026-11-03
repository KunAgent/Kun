import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SCREEN_DISPATCH_SETTLE_MS,
  createScreenDispatchGate,
  drainPendingScreens,
  type CanvasTurnDrainContext
} from './canvas-turn-drain'
import type { CanvasDocument } from './canvas-types'

function documentWithScreens(ids: string[]): CanvasDocument {
  const objects: Record<string, unknown> = {}
  for (const id of ids) {
    objects[id] = {
      id, type: 'frame', htmlArtifactId: `artifact-${id}`, x: 0, y: 0, width: 10, height: 10
    }
  }
  return { objects } as unknown as CanvasDocument
}

function makeContext(
  overrides: Partial<CanvasTurnDrainContext>
): CanvasTurnDrainContext {
  const ids = ['a', 'b']
  return {
    pendingScreens: ids.map((shapeId) => ({ shapeId, userPrompt: `brief ${shapeId}` })),
    screenDispatchGate: createScreenDispatchGate(),
    pendingSvgToolBlocks: new Map(),
    svgSourceTurnIds: new Map(),
    isDisposed: () => false,
    getChatState: () => ({ currentTurnId: null, busy: false, blocks: [] }),
    getDocument: () => documentWithScreens(ids),
    getHtmlArtifactIds: () => new Set(ids.map((id) => `artifact-${id}`)),
    ensureBarrier: () => null,
    commitWatermarks: () => undefined,
    selectShape: () => undefined,
    applySvgToolBlock: async () => undefined,
    scheduleScreenDrain: () => undefined,
    scheduleSvgDrain: () => undefined,
    ...overrides
  }
}

describe('drainPendingScreens', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('never dispatches a second screen while the first dispatch is still awaiting the runtime', async () => {
    const started: string[] = []
    let releaseFirst: () => void = () => undefined
    const context = makeContext({
      onScreenCreated: (shapeId) => {
        started.push(shapeId)
        return new Promise<boolean>((resolve) => {
          releaseFirst = () => resolve(true)
        })
      }
    })

    const first = drainPendingScreens(context)
    // The chat store still reads idle here, as it does while the thread is resolved.
    await drainPendingScreens(context)
    await drainPendingScreens(context)
    expect(started).toEqual(['a'])

    releaseFirst()
    await first
    expect(started).toEqual(['a'])
  })

  it('waits for the settle window after a dispatch before releasing the next screen', async () => {
    const started: string[] = []
    const scheduled: number[] = []
    const context = makeContext({
      onScreenCreated: (shapeId) => {
        started.push(shapeId)
        return true
      },
      scheduleScreenDrain: (delay) => {
        scheduled.push(delay ?? -1)
      }
    })

    await drainPendingScreens(context)
    expect(started).toEqual(['a'])

    await drainPendingScreens(context)
    expect(started).toEqual(['a'])
    expect(scheduled.at(-1)).toBeGreaterThan(0)
    expect(scheduled.at(-1)).toBeLessThanOrEqual(SCREEN_DISPATCH_SETTLE_MS)

    vi.advanceTimersByTime(SCREEN_DISPATCH_SETTLE_MS + 1)
    await drainPendingScreens(context)
    expect(started).toEqual(['a', 'b'])
  })

  it('releases the in-flight lock when a dispatch fails so the retry can run', async () => {
    const started: string[] = []
    const context = makeContext({
      onScreenCreated: (shapeId) => {
        started.push(shapeId)
        return false
      }
    })
    await drainPendingScreens(context)
    await drainPendingScreens(context)
    expect(started).toEqual(['a', 'a'])
  })
})
