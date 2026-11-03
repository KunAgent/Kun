import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assistantExportMarkdown } from '../../lib/conversation-export-markdown'
import { AssistantExportButton, CopyFeedbackButton } from './message-timeline-bubble-support'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./injected-memory-meta-chip', () => ({ InjectedMemoryMetaChip: () => null }))
vi.mock('../../store/chat-store', () => ({
  useChatStore: (select: (state: { workspaceRoot: string }) => unknown) => select({ workspaceRoot: '/workspace' })
}))

let view: ReactTestRenderer | undefined
afterEach(async () => {
  if (view) await act(async () => view!.unmount())
  view = undefined
  vi.unstubAllGlobals()
})

describe('assistant answer export policy', () => {
  it.each(['start', 'complete'] as const)('optional analytics %s failure never prevents export', async (when) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const exportWriteDocument = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('window', { kunGui: { exportWriteDocument } })
    const onExportStarted = () => {
      if (when === 'start') throw new Error('analytics unavailable')
      return () => { throw new Error('analytics unavailable') }
    }
    await act(async () => { view = create(createElement(AssistantExportButton, { text: 'answer', onExportStarted })) })
    await act(async () => view!.root.findAllByType('button')[0].props.onClick())
    expect(exportWriteDocument).toHaveBeenCalledOnce()
    expect(view!.root.findByType('summary').props.title).toBe('exportAnswer')
  })

  it('records export only after success and not after a canceled dialog', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const exported = vi.fn()
    const exportWriteDocument = vi.fn().mockResolvedValueOnce({ ok: false, canceled: true }).mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('window', { kunGui: { exportWriteDocument } })
    await act(async () => { view = create(createElement(AssistantExportButton, { text: 'answer', onExportStarted: () => exported })) })
    await act(async () => view!.root.findAllByType('button')[0].props.onClick())
    expect(exported).not.toHaveBeenCalled()
    await act(async () => view!.root.findAllByType('button')[0].props.onClick())
    expect(exported).toHaveBeenCalledOnce()
  })

  it.each(['start', 'complete'] as const)('optional analytics %s failure never prevents copying', async (when) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    const onCopyStarted = () => {
      if (when === 'start') throw new Error('analytics unavailable')
      return () => { throw new Error('analytics unavailable') }
    }
    await act(async () => { view = create(createElement(CopyFeedbackButton, { text: 'answer', onCopyStarted })) })
    await act(async () => view!.root.findByType('button').props.onClick())
    expect(writeText).toHaveBeenCalledExactlyOnceWith('answer')
    expect(view!.root.findByType('button').props.title).not.toContain('Failed')
  })

  it.each(['safe-markdown', 'plain-text', undefined] as const)('preserves %s for every standalone export format', async (renderMode) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const exportWriteDocument = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('window', { kunGui: { exportWriteDocument } })
    const text = '    const value = 1\n\n# Answer\n\n![secret](https://attacker.invalid/image)\n\n```mermaid\ngraph LR; a-->b\n```  '
    await act(async () => {
      view = create(createElement(AssistantExportButton, { text, renderMode, createdAt: '2026-01-01T00:00:00.000Z' }))
    })
    for (const button of view!.root.findAllByType('button')) {
      await act(async () => button.props.onClick())
    }
    expect(exportWriteDocument.mock.calls.map(([payload]) => payload.format)).toEqual(['pdf', 'docx', 'png', 'html'])
    for (const [payload] of exportWriteDocument.mock.calls) {
      expect(payload.content).toBe(renderMode ? assistantExportMarkdown(text, renderMode) : text)
      expect(payload.workspaceRoot).toBe('/workspace')
    }
  })
})
