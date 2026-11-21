import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  COLAB_NOTEBOOK_ENTRY_COMMAND,
  type ColabNotebookExecEvent
} from '@shared/colab/colab-notebook-types'
import i18n from '../../i18n'
import { createCell, serializeIpynb } from './ipynb-format'
import { buildColabKunTurnPrompt } from './colab-kun-turn'
import { useColabStore } from '../colab-store'
import { useColabNotebookStore } from './colab-notebook-store'
import { useColabPortForwardStore } from './colab-port-forward-store'
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

  it('manages runtime picker, modal import dialog, right panel tabs, and pinned sidebar runtime card while keeping Kun mounted', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const first = createCell('code', 'a = 1')
    const workspaceRoot = '/tmp/demo'
    const jupyterListNotebooks = vi.fn(async () => ({
      ok: true as const, status: 'ready' as const, entries: [{
        name: 'analysis.ipynb', remotePath: 'experiments/analysis.ipynb', relativePath: 'experiments/analysis.ipynb',
        sizeBytes: 125, modifiedAtMs: Date.now() - 7_200_000
      }]
    }))
    const jupyterConnect = vi.fn()
    const priorWindow = window
    vi.stubGlobal('window', { ...priorWindow, kunGui: { ...priorWindow.kunGui, jupyterListNotebooks, jupyterConnect } })
    useChatStore.setState({ workspaceRoot })
    useColabNotebookStore.setState({
      workspaceRoot, notebooks: ['train.ipynb', 'eval.ipynb'], activePath: 'train.ipynb', cells: [first], selectedCellId: first.id,
      loadError: null, dirty: false, sidePanelOpen: true, sidePanelTab: 'kun', kernelPickerOpen: false
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
      const chat = stage.findByType(ColabKunPane)
      const rightAside = () => stage.findByProps({ id: 'colab-kun-sidebar' })

      expect(JSON.stringify(renderer!.toJSON())).toContain('Run all')
      expect(rightAside().props.hidden).toBe(false)
      expect(sidebar.findAllByProps({ 'data-colab-connections': true })).toHaveLength(0)
      expect(sidebar.findByProps({ 'data-colab-runtime-card': 'offline' })).toBeDefined()
      expect(stage.findByProps({ 'data-colab-status-bar': true })).toBeDefined()

      // Left-bottom runtime card opens the topbar kernel picker popover defaulting to Custom Jupyter when Jupyter servers exist without Colab accounts
      const connectBtn = sidebar.findByProps({ 'data-colab-runtime-connect': true })
      await act(async () => connectBtn.props.onClick())
      expect(stage.findByProps({ 'data-colab-kernel-picker': true })).toBeDefined()
      expect(stage.findByProps({ 'data-colab-kernel-section': 'jupyter' })).toBeDefined()
      await act(async () => stage.findByProps({ 'data-colab-kernel-picker-trigger': true }).props.onClick())
      expect(stage.findAllByProps({ 'data-colab-kernel-picker': true })).toHaveLength(0)

      const buttonWithText = (scope: typeof root, text: string) =>
        scope.findAllByType('button').find(
          (node) =>
            node.children.includes(text) ||
            node.findAllByType('span').some((s) => s.children.includes(text))
        )!

      // Topbar Import menu opens the centered modal dialog without unmounting the editor or Kun chat
      await act(async () => stage.findByProps({ 'data-colab-import-trigger': true }).props.onClick())
      const importMenu = stage.findByProps({ 'data-colab-import-menu': true })
      const fromJupyterBtn = buttonWithText(importMenu, 'From Jupyter server')
      await act(async () => fromJupyterBtn.props.onClick())
      expect(jupyterListNotebooks).toHaveBeenCalledWith({ serverId: 'lab' })
      expect(jupyterConnect).not.toHaveBeenCalled()

      const pull = stage.findByProps({ 'data-notebook-pull-page': 'select' })
      expect(pull.props.role).toBe('dialog')
      expect(JSON.stringify(pull.findAllByType('strong').map((node) => node.children))).toContain('Research Lab')
      expect(pull.findAllByType('strong').some((node) => node.props.title === workspaceRoot)).toBe(true)
      await act(async () => pull.findByProps({ 'aria-label': 'experiments/analysis.ipynb' }).props.onChange({ target: { checked: true } }))

      // Dismissing the non-temporary modal preserves checked selection and returns to editor
      const closeDialogBtn = pull.findByProps({ 'aria-label': 'Cancel' })
      await act(async () => closeDialogBtn.props.onClick())
      expect(stage.findAllByProps({ 'data-notebook-pull-page': 'select' })).toHaveLength(0)
      expect(useColabNotebookStore.getState().cells[0]).toEqual(first)

      // Reopen via Import -> Resume active import…
      await act(async () => stage.findByProps({ 'data-colab-import-trigger': true }).props.onClick())
      const resumeBtn = buttonWithText(stage.findByProps({ 'data-colab-import-menu': true }), 'Resume active import…')
      await act(async () => resumeBtn.props.onClick())
      expect(stage.findByProps({ 'aria-label': 'experiments/analysis.ipynb' }).props.checked).toBe(true)
      expect(jupyterListNotebooks).toHaveBeenCalledTimes(1)

      // Right sidebar shows 4 tabs (hiding Colab-only Ports when not on Colab) and keeps ColabKunPane mounted
      const tabs = rightAside().findAllByProps({ role: 'tab' })
      expect(tabs).toHaveLength(4)
      await act(async () => tabs[1]!.props.onClick())
      expect(useColabNotebookStore.getState().sidePanelTab).toBe('variables')
      expect(stage.findByType(ColabKunPane)).toBe(chat)
      await act(async () => tabs[3]!.props.onClick())
      expect(useColabNotebookStore.getState().sidePanelTab).toBe('resources')
      expect(stage.findByType(ColabKunPane)).toBe(chat)
      await act(async () => tabs[0]!.props.onClick())
      expect(useColabNotebookStore.getState().sidePanelTab).toBe('kun')

      // Collapse and reopen via topbar Kun toggle
      await act(async () => rightAside().findByProps({ 'aria-label': 'Hide side panel (⌘J)' }).props.onClick())
      expect(rightAside().props.hidden).toBe(true)
      expect(stage.findByType(ColabKunPane)).toBe(chat)
      await act(async () => stage.findByProps({ 'data-colab-kun-toggle': true }).props.onClick())
      expect(rightAside().props.hidden).toBe(false)
      expect(stage.findByType(ColabKunPane)).toBe(chat)
    } finally {
      if (renderer) await act(async () => renderer?.unmount())
      useNotebookPullStore.setState({ task: null, visible: false })
      useJupyterStore.getState().setSnapshot({ servers: [], sessions: [] })
      vi.unstubAllGlobals()
    }
  })

  it('surfaces hardware/cost guards, unmanaged runtime adoption, session extension, and port forwarding', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const workspaceRoot = '/tmp/demo'
    const first = createCell('code', 'import gradio as gr')
    const colabExtendSession = vi.fn(async () => ({ ok: true as const }))
    const colabPortForwardStart = vi.fn(async (req: { sessionId: string; remotePort: number; localPort?: number; label?: string }) => ({
      ok: true as const,
      forward: {
        id: 'pf-1',
        sessionId: req.sessionId,
        sessionName: 'kun-a100',
        localPort: req.localPort ?? req.remotePort,
        remotePort: req.remotePort,
        localUrl: `http://127.0.0.1:${req.localPort ?? req.remotePort}`,
        label: req.label,
        state: 'up' as const
      }
    }))
    const priorWindow = window
    vi.stubGlobal('window', {
      ...priorWindow,
      kunGui: { ...priorWindow.kunGui, colabExtendSession, colabPortForwardStart }
    })

    const nowIso = new Date().toISOString()
    useChatStore.setState({ workspaceRoot })
    useColabPortForwardStore.setState({ forwards: [] })
    useColabStore.getState().applySnapshot({
      cli: { state: 'ready', version: '0.1.0', pythonVersion: '3.11', venvPath: '/tmp/venv' },
      connections: [
        {
          id: 'conn-1',
          name: 'Research Lab',
          email: 'lab@example.com',
          avatarColor: '#4f46e5',
          planLabel: 'Colab Pro+',
          status: 'connected',
          balanceCu: 42.5,
          burnRateCuPerHour: 5.4,
          activeSessions: [],
          createdAt: nowIso,
          updatedAt: nowIso
        }
      ],
      workspaceConnections: { [workspaceRoot]: 'conn-1' },
      oauthPending: null,
      lastLoginOutcome: null,
      sessions: [
        {
          id: 'sess-a100',
          sessionName: 'kun-a100',
          connectionId: 'conn-1',
          connectionName: 'Research Lab',
          connectionEmail: 'lab@example.com',
          connectionAvatarColor: '#4f46e5',
          workspaceRoot,
          entryCommand: COLAB_NOTEBOOK_ENTRY_COMMAND,
          phase: 'running',
          provisioningStep: 'start',
          accelerator: 'A100',
          highMem: true,
          ramGb: 167,
          vramGb: 80,
          syncPaths: [],
          outputRemoteDir: '',
          outputLocalDir: '',
          maxRuntimeHours: 2,
          idleAutoStopMinutes: 30,
          autoStop: true,
          mountDrive: false,
          watchdogActive: true,
          autoStopAt: new Date(Date.now() + 540_000).toISOString(),
          guardWarnings: ['runtime_nearing'],
          startedAt: nowIso,
          elapsedSeconds: 6660,
          consumedCu: 9.8,
          burnRateCuPerHour: 11.8,
          estimatedTotalCu: 23.6,
          uploadTransferredBytes: 0,
          uploadTotalBytes: 0,
          gpuUtilizationPct: 35,
          vramUsedGb: 22,
          gpuHistory: [35],
          metrics: {},
          logTail: [],
          artifacts: []
        }
      ],
      untrackedSessions: [
        {
          connectionId: 'conn-1',
          connectionName: 'Research Lab',
          connectionEmail: 'lab@example.com',
          endpoint: 'm-s-browser-1',
          accelerator: 'T4',
          variant: 'GPU',
          remoteLabel: 'Colab Browser T4',
          detectedAt: nowIso
        }
      ],
      lastRunsByWorkspace: {}
    })
    useColabNotebookStore.setState({
      workspaceRoot,
      notebooks: ['train.ipynb'],
      activePath: 'train.ipynb',
      cells: [first],
      selectedCellId: first.id,
      loadError: null,
      dirty: false,
      sidePanelOpen: true,
      sidePanelTab: 'ports',
      kernelPickerOpen: true
    })

    let renderer: ReturnType<typeof create> | undefined
    try {
      await act(async () => {
        renderer = create(
          createElement(ColabNotebookView, {
            leftSidebarCollapsed: false,
            onToggleLeftSidebar: () => undefined
          })
        )
      })
      const stage = renderer!.root.findByType(ColabNotebookView)
      const buttonWithText = (scope: typeof stage, text: string) =>
        scope.findAllByType('button').find(
          (node) =>
            node.children.includes(text) ||
            node.findAllByType('span').some((s) => s.children.includes(text))
        )!

      // Kernel picker defaults to Colab when Colab is running, showing unmanaged banner, guards, and all 5 right-sidebar tabs
      expect(stage.findByProps({ id: 'colab-kun-sidebar' }).findAllByProps({ role: 'tab' })).toHaveLength(5)
      expect(stage.findByProps({ 'data-colab-kernel-section': 'colab' })).toBeDefined()
      expect(stage.findByProps({ 'data-colab-untracked-list': true })).toBeDefined()
      await act(async () => stage.findByProps({ 'data-colab-guards-toggle': true }).props.onClick())
      expect(stage.findByProps({ 'data-colab-guards-panel': true })).toBeDefined()

      // Switching kernel picker source tab reveals Custom Jupyter quick-start onboarding
      await act(async () => stage.findByProps({ 'data-runtime-source': 'jupyter' }).props.onClick())
      expect(stage.findByProps({ 'data-colab-kernel-section': 'jupyter' })).toBeDefined()
      expect(JSON.stringify(renderer!.toJSON())).toContain('jupyter lab --no-browser --port 8888')

      // Inline cost guard warning banner triggers +30m session extension
      const warnBanner = stage.findByProps({ 'data-colab-guard-warning': true })
      await act(async () => buttonWithText(warnBanner, '+30m').props.onClick())
      expect(colabExtendSession).toHaveBeenCalledWith({ sessionId: 'sess-a100', addMinutes: 30 })

      // Ports tab blocks reserved port 8080 and starts a preset Gradio :7860 tunnel
      const portsPane = stage.findByProps({ 'data-colab-tab-pane': 'ports' })
      const inputs = portsPane.findAllByType('input')
      await act(async () => inputs[0]!.props.onChange({ target: { value: '8080' } }))
      await act(async () => portsPane.findByType('form').props.onSubmit({ preventDefault: () => undefined }))
      expect(portsPane.findByProps({ role: 'alert' }).children.join('')).toContain('8080')
      expect(colabPortForwardStart).not.toHaveBeenCalled()

      await act(async () => buttonWithText(portsPane, 'Gradio').props.onClick())
      expect(colabPortForwardStart).toHaveBeenCalledWith({
        sessionId: 'sess-a100',
        remotePort: 7860,
        localPort: 7860,
        label: 'Gradio'
      })
      expect(stage.findByProps({ 'data-colab-status-bar': true })).toBeDefined()
      const renderedJson = JSON.stringify(renderer!.toJSON())
      expect(renderedJson).toContain('7860')
      expect(renderedJson).toContain('1 port(s)')
      expect(renderedJson).toContain('Auto-stop in')
    } finally {
      if (renderer) await act(async () => renderer?.unmount())
      useColabPortForwardStore.setState({ forwards: [] })
      useColabStore.getState().applySnapshot({
        cli: { state: 'missing', version: null, pythonVersion: null, venvPath: '' },
        connections: [],
        workspaceConnections: {},
        oauthPending: null,
        lastLoginOutcome: null,
        sessions: [],
        untrackedSessions: [],
        lastRunsByWorkspace: {}
      })
      useColabNotebookStore.setState({ kernelPickerOpen: false, sidePanelTab: 'kun' })
      vi.unstubAllGlobals()
    }
  })

  it('gives custom local/remote Jupyter notebooks first-class runtime controls without Colab noise', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const workspaceRoot = '/tmp/demo'
    const first = createCell('code', 'import sys; print(sys.executable)')
    const jupyterConnect = vi.fn(async () => ({ ok: false as const, message: 'mocked' }))
    const priorWindow = window
    vi.stubGlobal('window', { ...priorWindow, kunGui: { ...priorWindow.kunGui, jupyterConnect } })

    const nowIso = new Date().toISOString()
    useChatStore.setState({ workspaceRoot })
    useJupyterStore.getState().setSnapshot({
      servers: [{
        id: 'local-1', name: 'Local Lab', baseUrl: 'http://127.0.0.1:8888', hasAuth: true,
        authMode: 'token', kernelName: 'python3', availableKernels: ['python3', 'pytorch-gpu'], updatedAt: nowIso
      }],
      sessions: [{
        id: 'jpy-local-1', serverId: 'local-1', serverName: 'Local Lab', baseUrl: 'http://127.0.0.1:8888',
        workspaceRoot, kernelId: 'k-1', kernelName: 'python3', startedAt: nowIso
      }]
    })
    useColabNotebookStore.setState({
      workspaceRoot, notebooks: ['exp.ipynb'], activePath: 'exp.ipynb', cells: [first], selectedCellId: first.id,
      loadError: null, dirty: false, sidePanelOpen: true, sidePanelTab: 'ports', kernelPickerOpen: false
    })

    let renderer: ReturnType<typeof create> | undefined
    try {
      await act(async () => {
        renderer = create(createElement(Fragment, null,
          createElement(ColabSidebarContent, { workspaceRoot }),
          createElement(ColabNotebookView, { leftSidebarCollapsed: false, onToggleLeftSidebar: () => undefined })
        ))
      })
      const sidebar = renderer!.root.findByType(ColabSidebarContent)
      const stage = renderer!.root.findByType(ColabNotebookView)
      const rightAside = stage.findByProps({ id: 'colab-kun-sidebar' })

      // Left sidebar card shows Local Jupyter; right sidebar hides Colab-only Ports tab and falls back cleanly to Resources
      expect(sidebar.findByProps({ 'data-colab-runtime-card': 'jupyter' })).toBeDefined()
      expect(rightAside.findAllByProps({ role: 'tab' })).toHaveLength(4)
      const resourcesPane = stage.findByProps({ 'data-colab-tab-pane': 'resources' })
      expect(JSON.stringify(renderer!.toJSON())).toContain('Local Jupyter')

      // Switching kernel directly inside Resources tab invokes jupyterConnect with the new kernel
      const kernelSelect = resourcesPane.findByProps({ 'aria-label': 'Switch execution kernel' })
      await act(async () => kernelSelect.props.onChange({ target: { value: 'pytorch-gpu' } }))
      expect(jupyterConnect).toHaveBeenCalledWith({
        workspaceRoot, serverId: 'local-1', kernelName: 'pytorch-gpu'
      })
    } finally {
      if (renderer) await act(async () => renderer?.unmount())
      useJupyterStore.getState().setSnapshot({ servers: [], sessions: [] })
      useColabNotebookStore.setState({ sidePanelTab: 'kun', kernelPickerOpen: false })
      vi.unstubAllGlobals()
    }
  })
})
