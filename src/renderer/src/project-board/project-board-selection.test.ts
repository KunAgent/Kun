import { describe, expect, it } from 'vitest'
import type { ProjectBoardCard } from './project-board-types'
import {
  EMPTY_PROJECT_BOARD_SELECTION,
  reconcileProjectBoardSelection,
  selectionForProjectBoardDrag,
  setProjectBoardColumnSelection,
  toggleProjectBoardCardSelection
} from './project-board-selection'

function card(id: string, status: ProjectBoardCard['status'] = 'pending'): ProjectBoardCard {
  return {
    id,
    kind: 'manual',
    workspaceRoot: '/project',
    title: id,
    description: '',
    status,
    category: 'other',
    priority: null,
    archived: false,
    updatedAt: '2026-09-01T00:00:00.000Z',
    source: { label: 'Manual' }
  }
}

describe('project board selection', () => {
  it('selects the current filtered column and clears when another column starts', () => {
    const pending = setProjectBoardColumnSelection('pending', ['one', 'two'], true)
    expect(pending.cardIds).toEqual(['one', 'two'])
    const switched = toggleProjectBoardCardSelection({
      selection: pending,
      card: card('done', 'completed'),
      orderedCardIds: ['done'],
      range: false
    })
    expect(switched).toEqual({
      status: 'completed',
      cardIds: ['done'],
      anchorId: 'done'
    })
  })

  it('extends a same-column selection over a Shift range', () => {
    const initial = toggleProjectBoardCardSelection({
      selection: EMPTY_PROJECT_BOARD_SELECTION,
      card: card('one'),
      orderedCardIds: ['one', 'two', 'three'],
      range: false
    })
    const ranged = toggleProjectBoardCardSelection({
      selection: initial,
      card: card('three'),
      orderedCardIds: ['one', 'two', 'three'],
      range: true
    })
    expect(ranged.cardIds).toEqual(['one', 'two', 'three'])
  })

  it('drags the whole selection only when the grabbed card is selected', () => {
    const selected = setProjectBoardColumnSelection('pending', ['one', 'two'], true)
    expect(selectionForProjectBoardDrag(selected, card('two')).cardIds).toEqual(['one', 'two'])
    expect(selectionForProjectBoardDrag(selected, card('three')).cardIds).toEqual(['three'])
  })

  it('drops hidden or moved cards from the selection', () => {
    const selected = setProjectBoardColumnSelection('pending', ['one', 'two'], true)
    expect(reconcileProjectBoardSelection(selected, [card('two')]).cardIds).toEqual(['two'])
    expect(reconcileProjectBoardSelection(selected, [card('done', 'completed')]))
      .toBe(EMPTY_PROJECT_BOARD_SELECTION)
  })
})
