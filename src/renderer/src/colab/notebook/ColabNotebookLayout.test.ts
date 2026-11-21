import { createElement, Fragment } from 'react'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { createCell } from './ipynb-format'
import { ColabNotebookCell } from './ColabNotebookCell'
import { ColabNotebookView } from './ColabNotebookView'
import { ColabSidebarContent } from './ColabSidebarContent'
import { NotebookKunDiffCard } from './NotebookKunDiffCard'
import { useColabNotebookStore } from './colab-notebook-store'
import { useJupyterStore } from './jupyter-store'

function collectText(node: ReactTestInstance | string | number | null | undefined): string {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return node.children.map((child) => collectText(child)).join(' ')
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
  ;(globalThis as unknown as { window: unknown }).window = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    kunGui: {
      listWorkspaceFiles: vi.fn(async () => ({
        ok: true,
        root: '/tmp/demo',
        files: ['Untitled.ipynb'],
        truncated: false
      })),
      colabNotebookInterrupt: vi.fn(async () => ({ ok: true }))
    }
  }
})

afterEach(() => {
  useJupyterStore.getState().setSnapshot({ servers: [], sessions: [] })
  useColabNotebookStore.setState({
    runningCellId: null,
    runningExecId: null,
    runningStartedAt: null,
    cellDurationsMs: {},
    queue: [],
    dirty: false,
    kernelPickerOpen: false,
    sidePanelOpen: true,
    sidePanelTab: 'kun',
    kunBaselineCells: null,
    kunChangedCellIds: []
  })
})

describe('Notebook layout redesign', () => {
  it('renders sticky command bar, switches Run all to Interrupt while busy, and toggles shortcuts popover', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const c1 = createCell('code', 'import torch\nprint(torch.cuda.is_available())')
    const c2 = createCell('code', 'print(2)')
    const workspaceRoot = '/tmp/demo'
    useChatStore.setState({ workspaceRoot })
    useColabNotebookStore.setState({
      workspaceRoot,
      notebooks: ['Untitled.ipynb'],
      activePath: 'Untitled.ipynb',
      cells: [c1, c2],
      selectedCellId: c1.id,
      loadError: null,
      dirty: false
    })

    let renderer: ReturnType<typeof create> | undefined
    try {
      await act(async () => {
        renderer = create(
          createElement(
            Fragment,
            null,
            createElement(ColabSidebarContent, { workspaceRoot }),
            createElement(ColabNotebookView, {
              leftSidebarCollapsed: false,
              onToggleLeftSidebar: () => undefined
            })
          )
        )
      })
      const sidebar = renderer!.root.findByType(ColabSidebarContent)
      const stage = renderer!.root.findByType(ColabNotebookView)

      // Sidebar list does not repeat "Saved" for clean active notebook
      expect(collectText(sidebar.findByProps({ 'aria-current': 'page' }))).not.toContain('Saved')

      // Command bar renders Run all (not Interrupt) when idle, and opens shortcuts popover
      expect(stage.findByProps({ 'data-colab-cmd-run-all': true })).toBeDefined()
      expect(stage.findAllByProps({ 'data-colab-cmd-interrupt': true })).toHaveLength(0)

      await act(async () => {
        stage.findByProps({ 'data-colab-shortcuts-trigger': true }).props.onClick()
      })
      const popover = stage.findByProps({ 'data-colab-shortcuts-popover': true })
      expect(collectText(popover)).toContain('Run current cell')
      expect(collectText(popover)).toContain('Toggle side panel')

      // Dismissible offline banner opens kernel picker or hides on Later
      expect(stage.findByProps({ 'data-colab-offline-banner': true })).toBeDefined()
      await act(async () => {
        stage.findByProps({ 'data-colab-offline-later': true }).props.onClick()
      })
      expect(stage.findAllByProps({ 'data-colab-offline-banner': true })).toHaveLength(0)

      // Status bar carries shortcuts hint and Connect… link when offline
      const statusBar = stage.findByProps({ 'data-colab-status-bar': true })
      expect(collectText(statusBar)).toContain('⌘↵ Run')
      expect(collectText(statusBar)).toContain('Connect…')

      // Right sidebar merges History + New session into the single header
      const rightHeader = stage.findByProps({ 'data-colab-right-header': true })
      expect(rightHeader.findByProps({ 'data-colab-kun-history-trigger': true })).toBeDefined()
      expect(rightHeader.findByProps({ 'data-colab-kun-new-session': true })).toBeDefined()

      // Running state swaps Run all -> Interrupt and shows queue count in command bar + status bar
      await act(async () => {
        useColabNotebookStore.setState({
          runningCellId: c1.id,
          runningStartedAt: Date.now() - 1200,
          queue: [c2.id]
        })
      })
      expect(stage.findByProps({ 'data-colab-cmd-interrupt': true })).toBeDefined()
      expect(stage.findAllByProps({ 'data-colab-cmd-run-all': true })).toHaveLength(0)
      expect(collectText(stage.findByProps({ 'data-colab-command-bar': true }))).toContain('Running [1]')
      expect(collectText(stage.findByProps({ 'data-colab-status-bar': true }))).toContain('1 queued')
    } finally {
      if (renderer) await act(async () => renderer?.unmount())
      vi.unstubAllGlobals()
    }
  })

  it('auto-folds long code cells with line numbers and expands/collapses on click', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const longSource = Array.from({ length: 24 }, (_, idx) => `x_${idx + 1} = ${idx + 1}`).join('\n')
    const cell = createCell('code', longSource)
    cell.executionCount = 2
    cell.outputs = [{ type: 'stream', name: 'stdout', text: 'ok\n' }]
    useColabNotebookStore.setState({ cellDurationsMs: { [cell.id]: 420 } })

    let renderer: ReturnType<typeof create> | undefined
    try {
      await act(async () => {
        renderer = create(
          createElement(ColabNotebookCell, {
            cell,
            index: 0,
            total: 1,
            selected: true,
            running: false,
            queued: false,
            canRun: true,
            onRun: () => undefined
          })
        )
      })
      const root = renderer!.root
      expect(root.findByProps({ 'data-cell-header': true })).toBeDefined()
      expect(root.findByProps({ 'data-cell-line-numbers': true }).children.join('')).toContain('24')
      expect(collectText(root.findByProps({ 'data-cell-header': true }))).toContain('0.4s')
      expect(collectText(root.findByProps({ 'data-cell-output': true }))).toContain('Out')

      const expandBtn = root.findByProps({ 'data-cell-expand-btn': true })
      expect(collectText(expandBtn)).toContain('Show 8 more lines')

      await act(async () => expandBtn.props.onClick({ stopPropagation: () => undefined }))
      expect(root.findAllByProps({ 'data-cell-fold-overlay': true })).toHaveLength(0)
      expect(collectText(root.findByProps({ 'data-cell-header': true }))).toContain('Collapse')
    } finally {
      if (renderer) await act(async () => renderer?.unmount())
      vi.unstubAllGlobals()
    }
  })

  it('renders NotebookKunDiffCard with line stats and undo/keep actions', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const before = [createCell('code', 'import os\nprint(1)')]
    const afterCell = createCell('code', 'import os, platform\nprint(platform.system())')
    const onUndo = vi.fn()
    const onKeep = vi.fn()
    const onLocate = vi.fn()

    let renderer: ReturnType<typeof create> | undefined
    try {
      await act(async () => {
        renderer = create(
          createElement(NotebookKunDiffCard, {
            baseline: before,
            cells: [afterCell],
            changedCellIds: [afterCell.id],
            onLocate,
            onUndo,
            onKeep
          })
        )
      })
      const card = renderer!.root.findByProps({ 'data-colab-kun-diff-card': true })
      const text = collectText(card)
      expect(text).toContain('+2')
      expect(text).toContain('−2')
      expect(text).toContain('import os, platform')

      const undoBtn = card.findAllByType('button').find((b) => b.children.includes('Undo'))!
      const keepBtn = card.findAllByType('button').find((b) => b.children.includes('Keep'))!
      await act(async () => undoBtn.props.onClick())
      await act(async () => keepBtn.props.onClick())
      expect(onUndo).toHaveBeenCalledTimes(1)
      expect(onKeep).toHaveBeenCalledTimes(1)
    } finally {
      if (renderer) await act(async () => renderer?.unmount())
      vi.unstubAllGlobals()
    }
  })
})
