import { describe, expect, it } from 'vitest'
import { selectWorkConversationStage } from './work-conversation-stage'
import type { WriteEditorLayoutV1 } from './write-workspace-store-types'

function layout(tabs: number): WriteEditorLayoutV1 {
  return {
    version: 1,
    orientation: 'horizontal',
    ratio: 0.5,
    focusedGroupId: 'primary',
    groups: [{
      id: 'primary',
      activePath: tabs ? '/w/a.md' : null,
      tabs: Array.from({ length: tabs }, (_, index) => ({ path: `/w/${index}.md`, viewMode: 'rich' as const }))
    }]
  } as unknown as WriteEditorLayoutV1
}

describe('selectWorkConversationStage', () => {
  it('centers the assistant only on the documents surface with nothing open', () => {
    const base = { workSurface: 'docs' as const, workspaceRoot: '/w', activeWhiteboardId: null }
    expect(selectWorkConversationStage({ ...base, editorLayout: layout(0) })).toBe(true)
    expect(selectWorkConversationStage({ ...base, editorLayout: layout(1) })).toBe(false)
    expect(selectWorkConversationStage({ ...base, activeWhiteboardId: 'board', editorLayout: layout(0) })).toBe(false)
    expect(selectWorkConversationStage({ ...base, workSurface: 'papers', editorLayout: layout(0) })).toBe(false)
    expect(selectWorkConversationStage({ ...base, workspaceRoot: ' ', editorLayout: layout(0) })).toBe(false)
  })
})
