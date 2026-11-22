import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkAnnotation, WorkAnnotationMessage } from '@shared/work-annotations'
import type { WriteDocumentReviewHandle } from '../write-document-editor-handle'
import { markdownAnchor } from '../../../write/annotations/markdown-anchor'
import { useAnnotationReview } from './use-annotation-review'

const fixture = vi.hoisted(() => {
  const state = { activeFilePath: '/space/a.md', workspaceRoot: '/space',
    fileContent: 'An input.\n', pendingAgentReview: null, reviewActive: false,
    documentsByPath: { '/space/a.md': { fileContent: 'An input.\n', pendingAgentReview: null } } }
  return { state, applied: vi.fn(async () => {}), clear: vi.fn(), report: vi.fn() }
})
vi.mock('../../../write/write-workspace-store', () => ({
  useWriteWorkspaceStore: Object.assign((select: (state: typeof fixture.state) => unknown) => select(fixture.state),
    { getState: () => fixture.state })
}))
vi.mock('../../../write/annotations/document-anchors', async () => import('../../../write/annotations/markdown-anchor'))
vi.mock('../../../write/selection-review-state', () => ({ clearAbandonedSelectionReview: fixture.clear }))
vi.mock('../../../write/work-annotations', () => ({ markWorkAnnotationSuggestionApplied: fixture.applied }))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()), useTranslation: () => ({ t: (key: string) => key })
}))

const scope = { workspaceRoot: '/space', filePath: '/space/a.md' }
const anchor = markdownAnchor('An input.\n', 3, 8, 'input')!
const message: WorkAnnotationMessage = { role: 'assistant', id: 'reply', createdAt: '', text: 'Proposed.',
  suggestion: { kind: 'insertAfter', text: 'Clarification.', anchor } }
const annotation: WorkAnnotation = { ...scope, id: 'note', anchor, resolved: false, messages: [message], createdAt: '', updatedAt: '' }
let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount())
  renderer = undefined
  fixture.state.documentsByPath['/space/a.md'].fileContent = fixture.state.fileContent
  vi.clearAllMocks()
})
async function setup() {
  let pending = false
  const handle = {
    beginDiffReview: vi.fn(() => { pending = true; return true }),
    isDiffReviewActive: () => pending,
    acceptAllDiff: vi.fn(() => { pending = false }),
    rejectAllDiff: vi.fn(() => { pending = false })
  }
  let controller!: ReturnType<typeof useAnnotationReview>
  function Host() {
    controller = useAnnotationReview(scope, false, () => handle as unknown as WriteDocumentReviewHandle, fixture.report, [annotation])
    return null
  }
  await act(async () => { renderer = create(createElement(Host)) })
  return { handle, get: () => controller }
}
it('reviews the proposed paragraph against the original bytes and records acceptance only after the decision', async () => {
  const test = await setup()
  await act(async () => test.get().preview(annotation, message))
  expect(test.handle.beginDiffReview).toHaveBeenCalledWith({
    original: 'An input.\n', nextDoc: 'An input.\n\nClarification.\n', origin: 'selection'
  })
  expect(fixture.applied).not.toHaveBeenCalled()
  await act(async () => test.get().accept())
  expect(test.handle.acceptAllDiff).toHaveBeenCalledOnce()
  expect(fixture.applied).toHaveBeenCalledWith(scope, 'note', 'reply')
})
it('discards the preview if the document changed while it was open', async () => {
  const test = await setup()
  await act(async () => test.get().preview(annotation, message))
  fixture.state.documentsByPath['/space/a.md'].fileContent = 'Edited elsewhere'
  await act(async () => test.get().accept())
  expect(test.handle.rejectAllDiff).toHaveBeenCalledOnce()
  expect(fixture.applied).not.toHaveBeenCalled()
  expect(fixture.report).toHaveBeenCalledWith('writeAnnotationSourceChanged')
})
it('will not apply an earlier suggestion to a newly attached passage', async () => {
  const test = await setup()
  const other = markdownAnchor(fixture.state.fileContent, 0, 2, 'An')!
  await act(async () => test.get().preview({ ...annotation, anchor: other }, message))
  expect(test.handle.beginDiffReview).not.toHaveBeenCalled()
  expect(fixture.report).toHaveBeenCalledWith('writeAnnotationEarlierSuggestion')
})
