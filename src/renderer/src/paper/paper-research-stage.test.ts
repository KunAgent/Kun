import { describe, expect, it } from 'vitest'
import type { WriteEditorLayoutV1 } from '../write/write-workspace-store-types'
import { paperResearchStageActive, paperResearchStageOnStage } from './paper-view'

function discoverLayout(): WriteEditorLayoutV1 {
  return {
    version: 1,
    orientation: 'single',
    ratio: 1,
    focusedGroupId: 'primary',
    groups: [{
      id: 'primary',
      tabs: [{ kind: 'paper-view', view: 'discover:search', viewMode: 'rich' }],
      activePath: 'paper-view:discover:search'
    }]
  } as WriteEditorLayoutV1
}

describe('paper research stage', () => {
  const state = { editorLayout: discoverLayout(), paperResearch: { agentTab: true } } as Parameters<typeof paperResearchStageActive>[0]

  it('hosts the conversation while the research page owns the stage', () => {
    expect(paperResearchStageActive(state)).toBe(true)
    expect(paperResearchStageOnStage(state, false)).toBe(true)
  })

  it('steps aside once a session tab takes the stage', () => {
    expect(paperResearchStageOnStage(state, true)).toBe(false)
  })
})
