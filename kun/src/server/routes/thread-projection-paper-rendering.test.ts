import { describe, expect, it } from 'vitest'
import { createTurnRecord } from '../../domain/turn.js'
import { makeAssistantTextItem, makeAssistantReasoningItem } from '../../domain/item.js'
import { createPaperTurnContext } from '../../contracts/paper-turn-context.js'
import { projectPublicTurn, projectTimelineTurn } from './thread-projection.js'

const paperContext = createPaperTurnContext({ version: 1, scope: 'current-paper', privacy: 'model-provider',
  purpose: 'Review', providerId: 'api', model: 'fixed-model', maxModelRequests: 1,
  sources: [{ paperId: 'p1', title: 'Paper', sourceVersion: 'sha1', text: 'Source' }] })

function makeTurn(paper = true) {
  const turn = createTurnRecord({ id: 'turn', threadId: 'thread', prompt: 'Summarize',
    ...(paper ? { paperContext } : {}) })
  turn.status = 'completed'
  turn.items = [makeAssistantTextItem, makeAssistantReasoningItem].map((make, index) => make({
    id: String(index), threadId: 'thread', turnId: turn.id, text: '# Summary', renderMode: 'plain-text'
  }))
  return turn
}

describe('legacy paper display policy', () => {
  it.each([projectPublicTurn, (turn: ReturnType<typeof makeTurn>) => projectTimelineTurn(turn, turn.items)])(
    'upgrades only provenance-bound paper answers without rewriting their saved source', (project) => {
      const turn = makeTurn()
      expect(project(turn).items).toEqual(turn.items.map(item => ({ ...item, renderMode: 'safe-markdown' })))
      expect(turn.items.every(item => 'renderMode' in item && item.renderMode === 'plain-text')).toBe(true)
      const ordinary = makeTurn(false)
      expect(project(ordinary).items).toEqual(ordinary.items)
    }
  )

  it('does not infer a paper policy from text, unset mode or a mismatched owning turn', () => {
    const turn = makeTurn()
    const ordinary = makeAssistantTextItem({ id: 'plain', threadId: 'thread', turnId: turn.id, text: '# Markdown' })
    const unrelated = makeAssistantTextItem({ id: 'other', threadId: 'thread', turnId: 'other',
      text: '# Markdown', renderMode: 'plain-text' })
    expect(projectTimelineTurn(turn, [ordinary, unrelated]).items).toEqual([ordinary, unrelated])
  })
})
