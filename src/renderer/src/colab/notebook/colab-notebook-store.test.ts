import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ColabNotebookExecEvent } from '@shared/colab/colab-notebook-types'
import i18n from '../../i18n'
import { createCell } from './ipynb-format'
import { useColabNotebookStore } from './colab-notebook-store'
import { ColabNotebookCell } from './ColabNotebookCell'
import { ColabNotebookView } from './ColabNotebookView'
import { highlightPythonCode } from './python-highlight'
import { useChatStore } from '../../store/chat-store'

let emit: (event: ColabNotebookExecEvent) => void = () => undefined
const execute = vi.fn(async (_input: { sessionId: string; execId: string; code: string }) => ({ ok: true as const }))

beforeAll(async () => {
  await i18n.changeLanguage('en')
  ;(globalThis as unknown as { window: unknown }).window = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    kunGui: {
      colabNotebookExecute: execute,
      colabNotebookInterrupt: vi.fn(async () => ({ ok: true })),
      listWorkspaceFiles: vi.fn(async () => ({ ok: true, root: '/tmp/demo', files: ['train.ipynb'], truncated: false })),
      onColabNotebookEvent: (handler: (event: ColabNotebookExecEvent) => void) => {
        emit = handler
        return () => undefined
      }
    }
  }
})

afterEach(() => {
  execute.mockClear()
})

const lastExecId = (): string => execute.mock.calls[execute.mock.calls.length - 1][0].execId

describe('colab notebook store', () => {
  it('runs queued cells in order, streams outputs and numbers executions', () => {
    const a = createCell('code', 'x = 1')
    const md = createCell('markdown', '# skip')
    const b = createCell('code', 'print(x)')
    useColabNotebookStore.setState({ cells: [a, md, b], queue: [], runningExecId: null, runningCellId: null, execCounter: 0 })

    useColabNotebookStore.getState().runCells('s1', [a.id, md.id, b.id])
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0]).toMatchObject({ sessionId: 's1', code: 'x = 1' })
    emit({ execId: lastExecId(), kind: 'done', ok: true, interrupted: false })

    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1][0].code).toBe('print(x)')
    emit({ execId: lastExecId(), kind: 'output', output: { type: 'stream', name: 'stdout', text: '1' } })
    emit({ execId: lastExecId(), kind: 'output', output: { type: 'stream', name: 'stdout', text: '\n' } })
    emit({ execId: lastExecId(), kind: 'done', ok: true, interrupted: false })

    const cells = useColabNotebookStore.getState().cells
    expect(cells.map((c) => c.executionCount)).toEqual([1, null, 2])
    expect(cells[2].outputs).toEqual([{ type: 'stream', name: 'stdout', text: '1\n' }])
    expect(useColabNotebookStore.getState().runningCellId).toBeNull()
  })

  it('stops a run-all queue when a cell fails and ignores stale events', () => {
    const a = createCell('code', 'raise ValueError()')
    const b = createCell('code', 'print(2)')
    useColabNotebookStore.setState({ cells: [a, b], queue: [], runningExecId: null, runningCellId: null, execCounter: 0 })

    useColabNotebookStore.getState().runCells('s1', [a.id, b.id])
    const failedExec = lastExecId()
    emit({ execId: 'stale', kind: 'output', output: { type: 'stream', name: 'stdout', text: 'nope' } })
    emit({ execId: failedExec, kind: 'output', output: { type: 'error', ename: 'ValueError', evalue: '', traceback: 'tb' } })
    emit({ execId: failedExec, kind: 'done', ok: false, interrupted: false })

    expect(execute).toHaveBeenCalledTimes(1)
    const state = useColabNotebookStore.getState()
    expect(state.queue).toEqual([])
    expect(state.cells[0].outputs).toEqual([{ type: 'error', ename: 'ValueError', evalue: '', traceback: 'tb' }])
    expect(state.cells[1].executionCount).toBeNull()
  })
})

describe('ColabNotebookCell', () => {
  it('renders execution count, stream text with carriage returns, images and errors', () => {
    const cell = createCell('code', 'train()')
    cell.executionCount = 4
    cell.outputs = [
      { type: 'stream', name: 'stdout', text: '10%\r100%\n' },
      { type: 'image', mime: 'image/png', data: 'AAAA' },
      { type: 'error', ename: 'E', evalue: 'v', traceback: 'Traceback: E' }
    ]
    const html = renderToStaticMarkup(createElement(ColabNotebookCell, {
      cell, index: 0, total: 1, selected: false, running: false, queued: false, canRun: true, onRun: () => undefined
    }))
    expect(html).toContain('[4]')
    expect(html).toContain('100%')
    expect(html).not.toContain('10%')
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).toContain('Traceback: E')
    expect(html).toContain('Run cell (Shift+Enter)')
  })

  it('preserves exact Python source text while highlighting tokens', () => {
    const code = '# comment\nimport torch\nx = fn("hi", 2e-4)\n'
    const html = renderToStaticMarkup(createElement('pre', null, ...highlightPythonCode(code)))
    expect(html).toContain('import')
    expect(html).toContain('fn')
    expect(html).toContain('2e-4')
    const stripped = html
      .replace(/<[^>]+>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/\u200b$/, '')
    expect(stripped).toBe(code)
  })

  it('inserts or replaces cells from Kun assist and renders toolbar + inline Kun bar', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const first = createCell('code', 'a = 1')
    useChatStore.setState({ workspaceRoot: '/tmp/demo' })
    useColabNotebookStore.setState({
      workspaceRoot: '/tmp/demo',
      activePath: 'train.ipynb',
      cells: [first],
      selectedCellId: first.id,
      loadError: null
    })
    useColabNotebookStore.getState().applyAssistCell({ kind: 'code', source: 'b = 2', replaceSelected: false })
    expect(useColabNotebookStore.getState().cells).toHaveLength(2)
    expect(useColabNotebookStore.getState().cells[1].source).toBe('b = 2')

    useColabNotebookStore.getState().applyAssistCell({ kind: 'code', source: 'b = 3', replaceSelected: true })
    expect(useColabNotebookStore.getState().cells).toHaveLength(2)
    expect(useColabNotebookStore.getState().cells[1].source).toBe('b = 3')

    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        createElement(ColabNotebookView, { leftSidebarCollapsed: false, onToggleLeftSidebar: () => undefined })
      )
    })
    const serialized = JSON.stringify(renderer.toJSON())
    expect(serialized).toContain('train.ipynb')
    expect(serialized).toContain('Ask Kun to write')
    expect(serialized).toContain('Run all')
    await act(async () => renderer.unmount())
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })
})
