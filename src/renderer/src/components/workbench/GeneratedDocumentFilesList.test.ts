import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedDocumentCollection } from '../chat/generated-document-artifacts'
import { GeneratedDocumentFilesList } from './GeneratedDocumentFilesList'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'generatedDocumentAllFiles') return `All files (${options?.count ?? 0})`
      const labels: Record<string, string> = {
        generatedDocumentBackToWorkspace: 'Back to workspace',
        generatedDocumentTurnFilesHint: 'Files from this reply',
        generatedDocumentKindWord: 'Word document',
        generatedDocumentKindPdf: 'PDF document',
        generatedDocumentPreview: 'Preview'
      }
      return labels[key] ?? key
    }
  })
}))

const collection: GeneratedDocumentCollection = {
  threadId: 'thread-a',
  turnId: 'turn-a',
  workspaceRoot: '/repo',
  files: [
    { path: 'reports/summary.docx', name: 'summary.docx', kind: 'word', extension: 'DOCX' },
    { path: 'reports/appendix.pdf', name: 'appendix.pdf', kind: 'pdf', extension: 'PDF' }
  ]
}

describe('GeneratedDocumentFilesList', () => {
  let renderer: ReactTestRenderer
  const onPreview = vi.fn()
  const onBackToWorkspace = vi.fn()

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    onPreview.mockReset()
    onBackToWorkspace.mockReset()
    await act(async () => {
      renderer = create(createElement(GeneratedDocumentFilesList, {
        collection,
        selectedPath: 'reports/appendix.pdf',
        onPreview,
        onBackToWorkspace
      }))
    })
  })

  afterEach(async () => {
    await act(async () => renderer.unmount())
  })

  it('lists every generated document and previews the selected row', async () => {
    expect(renderer.root.findByProps({ children: 'All files (2)' })).toBeTruthy()
    const rows = renderer.root.findAll((node) =>
      typeof node.props['data-generated-document-list-item'] === 'string'
    )
    expect(rows).toHaveLength(2)

    await act(async () => rows[0].props.onClick())
    expect(onPreview).toHaveBeenCalledWith(collection.files[0])
    expect(rows[1].props.className).toContain('bg-accent-soft')
  })

  it('returns to the normal workspace list without closing the panel', async () => {
    const back = renderer.root.findByProps({ 'aria-label': 'Back to workspace' })
    await act(async () => back.props.onClick())
    expect(onBackToWorkspace).toHaveBeenCalledOnce()
  })
})
