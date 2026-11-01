import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkPaperSearchMode, withWorkPaperSearchScope, workPaperSearchScopeLine } from './work-paper-search-mode'

describe('work paper search mode', () => {
  beforeEach(() => useWorkPaperSearchMode.setState({ enabled: false, depth: 'quick', focusRequest: 0 }))

  it('leaves prompts alone while off', () => {
    expect(withWorkPaperSearchScope('find papers on RAG', useWorkPaperSearchMode.getState())).toBe('find papers on RAG')
  })

  it('appends the research scope line Kun understands while on', () => {
    useWorkPaperSearchMode.getState().start()
    expect(useWorkPaperSearchMode.getState().focusRequest).toBe(1)
    expect(withWorkPaperSearchScope('find papers on RAG', useWorkPaperSearchMode.getState()))
      .toBe('find papers on RAG\n\n[paper-research] depth=quick; sources=default; years=any')
    useWorkPaperSearchMode.getState().setDepth('deep')
    expect(withWorkPaperSearchScope('q', useWorkPaperSearchMode.getState())).toBe(`q\n\n${workPaperSearchScopeLine('deep')}`)
  })

  it('turning the chip off resets depth', () => {
    useWorkPaperSearchMode.setState({ enabled: true, depth: 'deep' })
    useWorkPaperSearchMode.getState().setEnabled(false)
    expect(useWorkPaperSearchMode.getState()).toMatchObject({ enabled: false, depth: 'quick' })
  })
})
