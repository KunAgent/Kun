import { describe, expect, it } from 'vitest'
import { createEmptyDocument, createHtmlFrameShape, type CanvasDocument } from './canvas/canvas-types'
import { assignAgentBoardSections } from './design-board-sections'
import { artifact } from './design-board.test-helpers'

function withFrames(ids: string[]): { doc: CanvasDocument; frameIds: string[] } {
  const doc = createEmptyDocument()
  const frameIds: string[] = []
  for (const id of ids) {
    const frame = createHtmlFrameShape(id, 0, 0, id, 'desktop', `${id}-v1`)
    frame.parentId = doc.rootId
    doc.objects[frame.id] = frame
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [...doc.objects[doc.rootId].children, frame.id] }
    frameIds.push(frame.id)
  }
  return { doc, frameIds }
}

describe('assignAgentBoardSections', () => {
  it('groups new boards into sections named by their artifacts', () => {
    const { doc, frameIds } = withFrames(['a', 'b', 'c', 'd'])
    const next = assignAgentBoardSections(doc, frameIds, [
      artifact('a', 'html', { boardSection: '01 Flow' }),
      artifact('b', 'html', { boardSection: '01 flow' }),
      artifact('c', 'html', { boardSection: 'Themes' }),
      artifact('d', 'html')
    ])
    expect(next.sections?.map((section) => [section.title, section.memberIds])).toEqual([
      ['01 Flow', [frameIds[0], frameIds[1]]],
      ['Themes', [frameIds[2]]]
    ])
  })

  it('leaves frames it did not add, and unlabelled designs, untouched', () => {
    const { doc, frameIds } = withFrames(['a', 'b'])
    const artifacts = [artifact('a', 'html', { boardSection: 'Flow' }), artifact('b', 'html', { boardSection: 'Flow' })]
    expect(assignAgentBoardSections(doc, [], artifacts)).toBe(doc)
    expect(assignAgentBoardSections(doc, frameIds, [artifact('a', 'html'), artifact('b', 'html')])).toBe(doc)
    const sectioned = assignAgentBoardSections(doc, [frameIds[0]], artifacts)
    expect(sectioned.sections?.[0].memberIds).toEqual([frameIds[0]])
    const extended = assignAgentBoardSections(sectioned, [frameIds[1]], artifacts)
    expect(extended.sections).toHaveLength(1)
    expect(extended.sections?.[0].memberIds).toEqual(frameIds)
  })
})
