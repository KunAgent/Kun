// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { startCompletion, currentCompletions } from '@codemirror/autocomplete'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LatexSourceEditor } from './LatexSourceEditor'
import { useLatexProjectStore, latexSessionKey, type LatexSession } from '../../../write/latex/latex-project-store'

vi.mock('../../../i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../../../paper/paper-space-store', () => ({ usePaperSpaceStore: { getState: () => ({ items: [] }) } }))
let root: Root
let host: HTMLDivElement
const rangeMethods = new Map(['getClientRects', 'getBoundingClientRect'].map((method) => [method, Object.getOwnPropertyDescriptor(Range.prototype, method)]))
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const rect = { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20, x: 0, y: 0, toJSON() { return {} } }
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  useLatexProjectStore.setState({ sessions: {} })
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  for (const [method, descriptor] of rangeMethods) {
    if (descriptor) Object.defineProperty(Range.prototype, method, descriptor)
    else Reflect.deleteProperty(Range.prototype, method)
  }
  vi.unstubAllGlobals()
})
function seed(name: string, citeKey: string): string {
  const project = { rootPath: `/work/${name}`, mainPath: `/work/${name}/main.tex`, files: ['main.tex', 'refs.bib'], mainCandidates: ['main.tex'],
    config: { version: 1 as const, title: name, mainFile: 'main.tex', engine: 'pdflatex' as const, autoBuild: false, toolDirectory: '', bibFile: 'refs.bib' } }
  const key = latexSessionKey('/work', project.mainPath)
  const session = { instanceId: name, workspaceRoot: '/work', project, activeFile: 'main.tex',
    buffers: { 'main.tex': { content: '\\cite{', saved: '\\cite{' }, 'refs.bib': { content: `@article{${citeKey},title={${citeKey}}}`, saved: `@article{${citeKey},title={${citeKey}}}` } },
    review: [], reviewRevision: 0, projectRevision: 0, proposalIds: [], revision: 0 } as unknown as LatexSession
  useLatexProjectStore.setState((state) => ({ sessions: { ...state.sessions, [key]: session } }))
  return key
}
async function completions(): Promise<string[]> {
  const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!)!
  await act(async () => { view.dispatch({ selection: { anchor: view.state.doc.length } }); startCompletion(view) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)) })
  return currentCompletions(view.state).map((completion) => completion.label)
}

describe('LaTeX editor project isolation', () => {
  it('keeps same-name, same-content source states and citations scoped to each paper', async () => {
    const first = seed('first', 'fromFirst')
    const second = seed('second', 'fromSecond')
    const handleRef = { current: null }
    const props = { file: 'main.tex', value: '\\cite{', readOnly: false, diagnostics: [], jump: null,
      onChange: () => {}, onSave: () => {}, onSelection: () => {}, handleRef }
    await act(async () => root.render(createElement(LatexSourceEditor, { ...props, sessionKey: first })))
    expect(await completions()).toEqual(['fromFirst'])
    await act(async () => root.render(createElement(LatexSourceEditor, { ...props, sessionKey: second })))
    expect(await completions()).toEqual(['fromSecond'])
    await act(async () => root.render(createElement(LatexSourceEditor, { ...props, sessionKey: first })))
    expect(await completions()).toEqual(['fromFirst'])
  })
})
