import { describe, expect, it } from 'vitest'
import {
  groupProjectBoardCards,
  projectBoardOverview,
  selectVisibleProjectBoardCards
} from './project-board-selectors'
import type { ProjectBoardCard } from './project-board-types'

function card(input: Partial<ProjectBoardCard> & Pick<ProjectBoardCard, 'id'>): ProjectBoardCard {
  return {
    kind: 'manual',
    workspaceRoot: '/project',
    title: input.id,
    description: '',
    status: 'pending',
    category: 'other',
    priority: null,
    archived: false,
    updatedAt: '2026-08-31T00:00:00.000Z',
    source: { label: 'Manual' },
    ...input
  }
}

describe('project board selectors', () => {
  it('combines search/category/priority/source filters without treating Plan as a status', () => {
    const cards = [
      card({ id: 'p0', title: 'Fix provider', category: 'bug', priority: 'P0' }),
      card({
        id: 'plan', kind: 'thread_todo', title: 'Ship board', category: 'plan', priority: 'P1',
        source: { label: 'Plan', threadTitle: 'Board thread' }
      }),
      card({ id: 'done', title: 'Write docs', category: 'docs', status: 'completed' })
    ]
    const visible = selectVisibleProjectBoardCards({
      cards,
      searchQuery: 'provider',
      archived: false,
      filters: { categories: ['bug'], priorities: ['P0'], sources: ['manual'], showCompleted: false }
    })
    expect(visible.map((item) => item.id)).toEqual(['p0'])
  })

  it('sorts P0 to P2 to none and groups into exactly three business states', () => {
    const cards = [
      card({ id: 'none', priority: null, status: 'completed' }),
      card({ id: 'p2', priority: 'P2', status: 'in_progress' }),
      card({ id: 'p0', priority: 'P0' })
    ]
    const visible = selectVisibleProjectBoardCards({
      cards, searchQuery: '', archived: false,
      filters: { categories: [], priorities: [], sources: [], showCompleted: true }
    })
    expect(visible.map((item) => item.id)).toEqual(['p0', 'p2', 'none'])
    expect(Object.keys(groupProjectBoardCards(visible))).toEqual(['pending', 'in_progress', 'completed'])
    expect(projectBoardOverview(cards)).toMatchObject({ total: 3, completed: 1, inProgress: 1 })
  })
})
