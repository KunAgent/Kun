import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { chatBusyForArtifact, reservedArtifactPathFromPrompt } from './screen-generation-recovery'
import {
  clearCanvasTurnTerminalRegistry,
  recordCanvasTurnTerminal,
  subscribeCanvasTurnTerminal
} from './canvas-turn-terminal-registry'

const COMPACT = '.kun-design/doc/compact/v1.html'
const DETAIL = '.kun-design/doc/detail/v1.html'

function userBlock(id: string, path?: string): ChatBlock {
  return {
    kind: 'user',
    id,
    turnId: `turn_${id}`,
    text: path ? `Build the page.\nReserved artifact file: ${path}\nModify ONLY it.` : 'Plan the screens'
  } as ChatBlock
}

describe('reservedArtifactPathFromPrompt', () => {
  it('reads the reserved file from a screen turn prompt', () => {
    expect(reservedArtifactPathFromPrompt(`x\nReserved artifact file: ${DETAIL}\ny`)).toBe(DETAIL)
    expect(reservedArtifactPathFromPrompt('no reservation here')).toBeNull()
  })
})

describe('chatBusyForArtifact', () => {
  it('is false when the thread is idle', () => {
    expect(chatBusyForArtifact({ busy: false, blocks: [userBlock('a', COMPACT)] }, COMPACT)).toBe(false)
  })

  it('only counts a turn that reserved this artifact as drawing it', () => {
    const blocks = [userBlock('a', COMPACT)]
    expect(chatBusyForArtifact({ busy: true, blocks }, COMPACT)).toBe(true)
    expect(chatBusyForArtifact({ busy: true, blocks }, DETAIL)).toBe(false)
  })

  it('keeps the old behavior for turns that reserve no file', () => {
    expect(chatBusyForArtifact({ busy: true, blocks: [userBlock('a')] }, DETAIL)).toBe(true)
  })
})

describe('canvas turn terminal registry subscription', () => {
  it('notifies subscribers with the recorded outcome until unsubscribed', () => {
    clearCanvasTurnTerminalRegistry()
    const seen: string[] = []
    const unsubscribe = subscribeCanvasTurnTerminal((turnId, record) => {
      seen.push(`${turnId}:${record.outcome}`)
    })
    recordCanvasTurnTerminal('turn_1', 'failed', 'thr_1')
    unsubscribe()
    recordCanvasTurnTerminal('turn_2', 'completed')
    expect(seen).toEqual(['turn_1:failed'])
  })
})
