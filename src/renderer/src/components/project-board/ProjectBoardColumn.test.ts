import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectBoardCard } from '../../project-board/project-board-types'
import { ProjectBoardColumn } from './ProjectBoardColumn'

function card(index: number): ProjectBoardCard {
  return {
    id: `manual:${index}`,
    kind: 'manual',
    workspaceRoot: '/project',
    title: `Task ${index}`,
    description: '',
    status: 'pending',
    category: 'other',
    priority: null,
    archived: false,
    updatedAt: '2026-09-01T00:00:00.000Z',
    source: { label: 'Manual' }
  }
}

describe('ProjectBoardColumn virtualization', () => {
  it('does not mount all 500 cards before a scroll viewport is measured', async () => {
    let renderer: ReactTestRenderer | undefined
    await act(async () => {
      renderer = create(createElement(ProjectBoardColumn, {
        status: 'pending',
        cards: Array.from({ length: 500 }, (_, index) => card(index)),
        disabled: false,
        mutatingCardIds: {},
        selectedCardIds: new Set<string>(),
        onAdd: vi.fn(),
        onDropCards: vi.fn(),
        onToggleColumnSelection: vi.fn(),
        onToggleSelect: vi.fn(),
        onDragCard: vi.fn(),
        onMove: vi.fn(),
        onEdit: vi.fn(),
        onArchive: vi.fn(),
        onDelete: vi.fn(),
        onOpenThread: vi.fn(),
        onOpenPlan: vi.fn()
      }))
    })
    const mountedCards = renderer?.root.findAll((node) => node.type === 'article').length ?? 0
    expect(mountedCards).toBeLessThan(50)
    renderer?.unmount()
  })
})
