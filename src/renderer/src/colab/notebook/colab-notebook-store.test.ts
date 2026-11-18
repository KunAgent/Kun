import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ColabNotebookExecEvent } from '@shared/colab/colab-notebook-types'
import i18n from '../../i18n'
import { createCell, serializeIpynb } from './ipynb-format'
import { buildColabKunTurnPrompt } from './colab-kun-turn'
import { useColabNotebookStore } from './colab-notebook-store'
import { handleColabNotebookAgentRequest } from './use-colab-notebook-agent'
import { ColabNotebookCell } from './ColabNotebookCell'
import { ColabNotebookView } from './ColabNotebookView'
import { ColabSidebarContent } from './ColabSidebarContent'
import { ColabKunPane } from './ColabKunPane'
import { useJupyterStore } from './jupyter-store'
import { useNotebookPullStore } from './notebook-pull-store'
import { highlightPythonCode } from './python-highlight'
import { useChatStore } from '../../store/chat-store'

let emit: (event: ColabNotebookExecEvent) => void = () => undefined
const execute = vi.fn(async (_input: { sessionId: string; execId: string; code: string }) => ({ ok: true as const }))
const readWorkspaceFile = vi.fn(async () => ({ ok: false as const, message: 'not mocked' }))
const writeWorkspaceFile = vi.fn(async () => ({ ok: true as const }))

beforeAll(async () => {
  await i18n.changeLanguage('en')
  ;(globalThis as unknown as { window: unknown }).window = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    kunGui: {
      colabNotebookExecute: execute,
      colabNotebookInterrupt: vi.fn(async () => ({ ok: true })),
      listWorkspaceFiles: vi.fn(async () => ({ ok: true, root: '/tmp/demo', files: ['train.ipynb'], truncated: false })),
      readWorkspaceFile,
      writeWorkspaceFile,
      onColabNotebookEvent: (handler: (event: ColabNotebookExecEvent) => void) => {
        emit = handler
        return () => undefined
      }
    }
  }
})

afterEach(() => {
  execute.mockClear()
  readWorkspaceFile.mockReset()
  writeWorkspaceFile.mockClear()
})

const lastExecId = (): string => execute.mock.calls[execute.mock.calls.length - 1][0].execId

describe('colab notebook store', () => {
  it('defaults the Kun chat sidebar to open', () => {
    expect(useColabNotebookStore.getState().sidePanelOpen).toBe(true)
  })

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
    emit({ execId: lastExecId(), kind: 'output', output: { type: 'stream', name: 'stdout', text: '0%\r' } })
    emit({ execId: lastExecId(), kind: 'clear' })
    emit({ execId: lastExecId(), kind: 'output', output: { type: 'stream', name: 'stdout', text: '1' } })
    emit({ execId: lastExecId(), kind: 'output', output: { type: 'stream', name: 'stdout', text: '\n' } })
    emit({ execId: lastExecId(), kind: 'done', ok: true, interrupted: false })

    const cells = useColabNotebookStore.getState().cells
    expect(cells.map((c) => c.executionCount)).toEqual([1, null, 2])
    expect(cells[2].outputs).toEqual([{ type: 'stream', name: 'stdout', text: '1\n' }])
    expect(useColabNotebookStore.getState().runningCellId).toBeNull()
  })

  it('skips reloadActiveNotebook while a save is in progress', async () => {
    const a = createCell('code', 'x = 1')
    useColabNotebookStore.setState({
      workspaceRoot: '/tmp/demo',
      activePath: 'train.ipynb',
      cells: [a],
      dirty: false,
      saving: true,
      runningExecId: null,
      queue: []
    })
    await useColabNotebookStore.getState().reloadActiveNotebook()
    expect(readWorkspaceFile).not.toHaveBeenCalled()
    useColabNotebookStore.setState({ saving: false })
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

  it('tracks cells modified by Kun on disk and restores baseline on undo', async () => {
    const original = createCell('code', 'x = 1')
    useColabNotebookStore.setState({
      workspaceRoot: '/tmp/demo',
      activePath: 'train.ipynb',
      cells: [original],
      dirty: false,
      runningExecId: null,
      queue: [],
      kunBaselineCells: null,
      kunChangedCellIds: []
    })
    useColabNotebookStore.getState().captureKunBaseline()

    const updated = [createCell('code', 'x = 1'), createCell('code', 'eval_model()')]
    readWorkspaceFile.mockResolvedValueOnce({
      ok: true as const,
      path: 'train.ipynb',
      content: serializeIpynb(updated, 'T4'),
      truncated: false,
      totalBytes: 120
    } as never)

    await useColabNotebookStore.getState().reloadActiveNotebook()
    const afterReload = useColabNotebookStore.getState()
    expect(afterReload.cells).toHaveLength(2)
    expect(afterReload.kunChangedCellIds).toHaveLength(1)
    expect(afterReload.cells[1].source).toBe('eval_model()')

    await useColabNotebookStore.getState().undoKunChanges()
    const afterUndo = useColabNotebookStore.getState()
    expect(afterUndo.cells).toHaveLength(1)
    expect(afterUndo.cells[0].source).toBe('x = 1')
    expect(afterUndo.kunChangedCellIds).toEqual([])
    expect(writeWorkspaceFile).toHaveBeenCalledTimes(1)
  })

  it('builds Kun prompt context for active notebook, selected cell, and Jupyter runtime', () => {
    const c1 = createCell('code', 'import torch\nprint(torch.__version__)')
    c1.outputs = [{ type: 'stream', name: 'stdout', text: '2.4.0\n' }]
    const prompt = buildColabKunTurnPrompt({
      request: 'Plot confusion matrix',
      activePath: 'eval.ipynb',
      cells: [c1],
      selectedCellNumber: 1,
      includeNotebook: true,
      session: null,
      jupyterSession: {
        id: 'jpy-1',
        serverId: 'jsrv-1',
        serverName: 'AutoDL GPU',
        baseUrl: 'https://u123.autodl.pro:8888',
        workspaceRoot: '/tmp/demo',
        kernelId: 'k-1',
        kernelName: 'python3',
        startedAt: '2026-11-18T00:00:00.000Z'
      }
    })
    expect(prompt).toContain('Active notebook: `eval.ipynb`')
    expect(prompt).toContain('Connected Jupyter server: `AutoDL GPU`')
    expect(prompt).toContain('Focused cell [1] (code):')
    expect(prompt).toContain('2.4.0')
    expect(prompt).toContain('notebook_run_cells')
    expect(prompt).toContain('Do not start a new Colab session')
  })

  it('locks user edits and manual runs while Kun edits, but lets Kun tool runs through', async () => {
    const a = createCell('code', 'x = 1')
    useColabNotebookStore.setState({
      cells: [a],
      queue: [],
      runningExecId: null,
      runningCellId: null,
      execCounter: 0,
      dirty: false,
      kunBusy: true
    })
    const store = useColabNotebookStore.getState()
    store.updateCellSource(a.id, 'x = 2')
    store.addCell('code')
    store.deleteCell(a.id)
    store.runCells('s1', [a.id])
    expect(useColabNotebookStore.getState().cells.map((c) => c.source)).toEqual(['x = 1'])
    expect(useColabNotebookStore.getState().dirty).toBe(false)
    expect(execute).not.toHaveBeenCalled()

    const done = store.runCellsAndWait('s1', [a.id])
    expect(execute).toHaveBeenCalledTimes(1)
    emit({ execId: lastExecId(), kind: 'output', output: { type: 'stream', name: 'stdout', text: 'ok\n' } })
    emit({ execId: lastExecId(), kind: 'done', ok: true, interrupted: false })
    await done
    expect(useColabNotebookStore.getState().cells[0].outputs).toEqual([{ type: 'stream', name: 'stdout', text: 'ok\n' }])
    useColabNotebookStore.setState({ kunBusy: false })
  })

  it('handles a Kun notebook_run_cells request end to end and reports per-cell results', async () => {
    const a = createCell('code', 'acc = 0.91')
    const md = createCell('markdown', '# notes')
    const b = createCell('code', 'print(acc)')
    useColabNotebookStore.setState({
      workspaceRoot: '/tmp/demo',
      activePath: 'eval.ipynb',
      loadError: null,
      cells: [a, md, b],
      queue: [],
      runningExecId: null,
      runningCellId: null,
      execCounter: 0,
      dirty: false,
      kunBusy: true
    })
    readWorkspaceFile.mockResolvedValue({ ok: false as const, message: 'unchanged' })
    const runtime = { wsKey: '/tmp/demo', activeSessionId: 'jpy-1', activeRuntimeLabel: 'Lab · python3' } as never

    const pending = handleColabNotebookAgentRequest(
      { requestId: 'r1', kind: 'run', workspaceRoot: '/tmp/demo/', cells: [2, 3] },
      runtime
    )
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect(execute.mock.calls[0][0]).toMatchObject({ sessionId: 'jpy-1', code: 'print(acc)' })
    emit({ execId: lastExecId(), kind: 'output', output: { type: 'stream', name: 'stdout', text: '0.91\n' } })
    emit({ execId: lastExecId(), kind: 'done', ok: true, interrupted: false })

    const result = await pending
    expect(result).toEqual({
      ok: true,
      notebookPath: 'eval.ipynb',
      runtime: 'Lab · python3',
      cells: [
        { number: 2, kind: 'markdown', status: 'skipped', executionCount: null, output: '' },
        { number: 3, kind: 'code', status: 'ok', executionCount: 1, output: '0.91' }
      ]
    })
    expect(writeWorkspaceFile).toHaveBeenCalled()

    expect(
      await handleColabNotebookAgentRequest({ requestId: 'r2', kind: 'run', workspaceRoot: '/tmp/demo', cells: [9] }, runtime)
    ).toMatchObject({ ok: false, message: expect.stringContaining('out of range') })
    expect(
      await handleColabNotebookAgentRequest(
        { requestId: 'r3', kind: 'variables', workspaceRoot: '/tmp/demo' },
        { wsKey: '/tmp/demo', activeSessionId: null, activeRuntimeLabel: null } as never
      )
    ).toMatchObject({ ok: false, message: expect.stringContaining('No notebook runtime') })
    useColabNotebookStore.setState({ kunBusy: false })
  })
})

describe('ColabNotebookCell and ColabNotebookView', () => {
  it('renders execution count, stream text with carriage returns, images, errors, and Kun modified badge', () => {
    const cell = createCell('code', 'train()')
    cell.executionCount = 4
    cell.outputs = [
      { type: 'stream', name: 'stdout', text: '10%\r100%\n' },
      { type: 'image', mime: 'image/png', data: 'AAAA' },
      { type: 'error', ename: 'E', evalue: 'v', traceback: 'Traceback: E' }
    ]
    const html = renderToStaticMarkup(createElement(ColabNotebookCell, {
      cell,
      index: 0,
      total: 1,
      selected: false,
      running: false,
      queued: false,
      canRun: true,
      kunChanged: true,
      onRun: () => undefined
    }))
    expect(html).toContain('[4]')
    expect(html).toContain('100%')
    expect(html).not.toContain('10%')
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).toContain('Traceback: E')
    expect(html).toContain('Run cell (Shift+Enter)')
    expect(html).toContain('Kun updated')
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

  it('opens a server pull from the left while keeping the editor and Kun chat mounted', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const first = createCell('code', 'a = 1')
    const workspaceRoot = '/tmp/demo'
    const jupyterListNotebooks = vi.fn(async () => ({
      ok: true as const, status: 'ready' as const, entries: [{
        name: 'analysis.ipynb', remotePath: 'experiments/analysis.ipynb', relativePath: 'experiments/analysis.ipynb',
        sizeBytes: 125, modifiedAtMs: 0
      }]
    }))
    const jupyterConnect = vi.fn()
    const priorWindow = window
    vi.stubGlobal('window', { ...priorWindow, kunGui: { ...priorWindow.kunGui, jupyterListNotebooks, jupyterConnect } })
    useChatStore.setState({ workspaceRoot })
    useColabNotebookStore.setState({
      workspaceRoot, activePath: 'train.ipynb', cells: [first], selectedCellId: first.id,
      loadError: null, dirty: false, sidePanelOpen: true
    })
    useJupyterStore.getState().setSnapshot({ servers: [{
      id: 'lab', name: 'Research Lab', baseUrl: 'https://jupyter.example', hasAuth: true,
      kernelName: 'python3', availableKernels: ['python3'], updatedAt: ''
    }], sessions: [] })

    let renderer: ReturnType<typeof create> | undefined
    try {
      await act(async () => {
        renderer = create(createElement(Fragment, null,
          createElement(ColabSidebarContent, { workspaceRoot }),
          createElement(ColabNotebookView, { leftSidebarCollapsed: false, onToggleLeftSidebar: () => undefined })
        ))
      })
      const { root } = renderer!
      const sidebar = root.findByType(ColabSidebarContent)
      const stage = root.findByType(ColabNotebookView)
      const button = (scope: typeof root, text: string) => scope.findAllByType('button').find((node) => node.children.includes(text))!
      const chat = stage.findByType(ColabKunPane)
      const chatAside = () => stage.findByProps({ 'data-colab-right-sidebar': 'kun' })
      const editor = () => stage.findByProps({ 'data-colab-notebook-editor': true })
      expect(JSON.stringify(renderer!.toJSON())).toContain('Run all')
      expect(chatAside().props.hidden).toBe(false)
      expect(sidebar.findByProps({ 'data-colab-connections': true })).toBeDefined()
      expect(stage.findAllByProps({ 'data-colab-right-sidebar': 'runtime' })).toHaveLength(0)

      await act(async () => button(sidebar, 'Browse server notebooks').props.onClick())
      expect(jupyterListNotebooks).toHaveBeenCalledWith({ serverId: 'lab' })
      expect(jupyterConnect).not.toHaveBeenCalled()
      expect(editor().props.hidden).toBe(true)
      const pull = stage.findByProps({ 'data-notebook-pull-page': 'select' })
      expect(JSON.stringify(pull.findAllByType('strong').map((node) => node.children))).toContain('Research Lab')
      expect(pull.findAllByType('strong').some((node) => node.props.title === workspaceRoot)).toBe(true)
      await act(async () => pull.findByProps({ 'aria-label': 'experiments/analysis.ipynb' }).props.onChange({ target: { checked: true } }))
      await act(async () => button(stage, 'Notebook editor').props.onClick())
      expect(editor().props.hidden).toBe(false)
      expect(useColabNotebookStore.getState().cells[0]).toEqual(first)
      await act(async () => button(stage, 'Browse server notebooks').props.onClick())
      expect(stage.findByProps({ 'aria-label': 'experiments/analysis.ipynb' }).props.checked).toBe(true)
      expect(jupyterListNotebooks).toHaveBeenCalledTimes(1)

      await act(async () => stage.findByProps({ 'aria-label': 'Hide Kun chat (⌘J)' }).props.onClick())
      expect(chatAside().props.hidden).toBe(true)
      expect(stage.findByProps({ 'data-colab-chat-rail': true })).toBeDefined()
      expect(stage.findByType(ColabKunPane)).toBe(chat)
      await act(async () => stage.findByProps({ 'aria-label': 'Show Kun chat (⌘J)' }).props.onClick())
      expect(chatAside().props.hidden).toBe(false)
      expect(stage.findByType(ColabKunPane)).toBe(chat)
    } finally {
      if (renderer) await act(async () => renderer?.unmount())
      useNotebookPullStore.setState({ task: null, visible: false })
      useJupyterStore.getState().setSnapshot({ servers: [], sessions: [] })
      vi.unstubAllGlobals()
    }
  })
})
