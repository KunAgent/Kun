import { createElement, Fragment } from 'react'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { useColabStore } from '../colab-store'
import { createCell, serializeIpynb } from './ipynb-format'
import { ColabNotebookCell } from './ColabNotebookCell'
import { ColabNotebookView } from './ColabNotebookView'
import { ColabSidebarContent } from './ColabSidebarContent'
import { NotebookKunDiffCard } from './NotebookKunDiffCard'
import { useColabDriveStore } from './colab-drive-store'
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
  useColabDriveStore.setState({
    states: {},
    probedSessions: {},
    autoMountAttemptedSessions: {}
  })
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

  it('mounts Google Drive in the Files tab, expands MyDrive, and saves the active notebook to Drive', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const workspaceRoot = '/tmp/demo'
    const colabMount = vi.fn(async () => ({
      ok: true as const,
      state: {
        sessionId: 'sess-drive',
        status: 'needs_auth' as const,
        authUrl: 'https://accounts.google.com/auth',
        expiresAt: Date.now() + 60_000
      }
    }))
    const colabCompleteAuth = vi.fn(async () => ({
      ok: true as const,
      state: {
        sessionId: 'sess-drive',
        status: 'mounted' as const,
        mountPath: '/content/drive/MyDrive'
      }
    }))
    const colabUpload = vi.fn(async () => ({ ok: true, uploadedCount: 1 }))
    const colabListFiles = vi.fn(async ({ path }: { sessionId: string; path: string }) => {
      if (path === '/content') {
        return {
          ok: true as const,
          path,
          entries: [{ name: 'drive', path: '/content/drive', isDir: true, size: 0 }]
        }
      }
      if (path === '/content/drive') {
        return {
          ok: true as const,
          path,
          entries: [{ name: 'MyDrive', path: '/content/drive/MyDrive', isDir: true, size: 0 }]
        }
      }
      if (path === '/content/drive/MyDrive') {
        return {
          ok: true as const,
          path,
          entries: [
            {
              name: 'Colab Notebooks',
              path: '/content/drive/MyDrive/Colab Notebooks',
              isDir: true,
              size: 0
            }
          ]
        }
      }
      return {
        ok: true as const,
        path,
        entries: [
          {
            name: 'Qwen35_GSPO.ipynb',
            path: '/content/drive/MyDrive/Colab Notebooks/Qwen35_GSPO.ipynb',
            isDir: false,
            size: 2048
          }
        ]
      }
    })

    const prevGui = window.kunGui
    Object.assign(window.kunGui, {
      colabDriveGetMountState: vi.fn(async () => ({ sessionId: 'sess-drive', status: 'unmounted' as const })),
      colabDriveMount: colabMount,
      colabDriveCompleteMountAuth: colabCompleteAuth,
      colabUploadToSession: colabUpload,
      onColabUploadProgress: vi.fn(() => () => undefined),
      colabNotebookListFiles: colabListFiles
    })

    useChatStore.setState({ workspaceRoot })
    useColabStore.setState({
      snapshot: {
        ...useColabStore.getState().snapshot,
        connections: [
          {
            id: 'conn-1',
            name: 'Account',
            email: 'user@gmail.com',
            avatarColor: '#4f6bed',
            status: 'connected',
            planLabel: 'Colab Pro',
            balanceCu: 100,
            burnRateCuPerHour: 0.1,
            createdAt: '',
            updatedAt: '',
            activeSessions: []
          }
        ],
        sessions: [
          {
            id: 'sess-drive',
            sessionName: 'kun-nb',
            connectionId: 'conn-1',
            connectionName: 'Account',
            connectionEmail: 'user@gmail.com',
            connectionAvatarColor: '#4f6bed',
            workspaceRoot,
            entryCommand: 'kun-notebook',
            accelerator: 'CPU',
            phase: 'running',
            provisioningStep: 'start',
            startedAt: '2026-11-25T10:00:00Z',
            elapsedSeconds: 30,
            burnRateCuPerHour: 0.1,
            consumedCu: 0,
            estimatedTotalCu: 0.2,
            ramGb: 12.7,
            vramGb: null,
            gpuUtilizationPct: null,
            vramUsedGb: null,
            uploadTransferredBytes: 0,
            uploadTotalBytes: 0,
            gpuHistory: [],
            maxRuntimeHours: 2,
            autoStop: true,
            mountDrive: false,
            syncPaths: [],
            outputRemoteDir: '',
            outputLocalDir: '',
            artifacts: [],
            metrics: {},
            logTail: []
          }
        ]
      }
    })
    useColabNotebookStore.setState({
      workspaceRoot,
      notebooks: ['Qwen35_GSPO.ipynb'],
      activePath: 'Qwen35_GSPO.ipynb',
      cells: [createCell('code', 'import torch')],
      dirty: false,
      sidePanelOpen: true,
      sidePanelTab: 'files'
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
      const root = renderer!.root
      expect(useColabNotebookStore.getState().launchOptions.mountDrive).toBe(true)
      expect(root.findByProps({ 'data-colab-drive-unmounted-callout': true })).toBeDefined()
      const mountBtn = root.findByProps({ 'data-colab-mount-drive': true })
      await act(async () => {
        await mountBtn.props.onClick()
      })
      expect(colabMount).toHaveBeenCalledWith({ sessionId: 'sess-drive', forceRemount: undefined })

      const confirmBtn = root.findByProps({ 'data-colab-drive-auth-confirm': true })
      await act(async () => {
        await confirmBtn.props.onClick()
      })
      expect(colabCompleteAuth).toHaveBeenCalledWith({ sessionId: 'sess-drive' })
      expect(root.findByProps({ 'data-colab-drive-mounted': true })).toBeDefined()
      expect(root.findByProps({ 'data-colab-copy-ckpt-path': true })).toBeDefined()
      expect(collectText(root.findByProps({ 'data-colab-drive-status-bar': true }))).toContain(
        '/content/drive/MyDrive'
      )

      const saveDriveBtn = root.findByProps({ 'data-colab-save-to-drive': true })
      await act(async () => {
        await saveDriveBtn.props.onClick()
      })
      expect(colabUpload).toHaveBeenCalledWith({
        sessionId: 'sess-drive',
        workspaceNotebook: 'Qwen35_GSPO.ipynb',
        targetRemoteDir: '/content/drive/MyDrive/Colab Notebooks'
      })

      colabMount.mockClear()
      useColabDriveStore.getState().autoMountSession('sess-auto-once')
      useColabDriveStore.getState().autoMountSession('sess-auto-once')
      expect(colabMount).toHaveBeenCalledTimes(1)
    } finally {
      Object.assign(window.kunGui, prevGui)
      if (renderer) await act(async () => renderer?.unmount())
      vi.unstubAllGlobals()
    }
  })

  it('renders all 8 GPU/TPU/CPU accelerators, locks ineligible tiers, and handles fixed High-RAM shapes', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const workspaceRoot = '/tmp/demo'
    expect(JSON.parse(serializeIpynb([createCell('code', 'x=1')], 'V6E1')).metadata.accelerator).toBe(
      'TPU'
    )
    expect(JSON.parse(serializeIpynb([createCell('code', 'x=1')], 'G4')).metadata.accelerator).toBe(
      'GPU'
    )
    expect(
      JSON.parse(serializeIpynb([createCell('code', 'x=1')], 'CPU')).metadata.accelerator
    ).toBeUndefined()

    useChatStore.setState({ workspaceRoot })
    useColabStore.setState({
      snapshot: {
        cli: { state: 'ready', version: '0.8.1', pythonVersion: '3.12', venvPath: '/tmp/venv' },
        connections: [
          {
            id: 'conn-pro-plus',
            name: 'jackzhongxiaoyu',
            email: 'jackzhongxiaoyu@gmail.com',
            avatarColor: '#7a68e8',
            status: 'connected',
            planLabel: 'Colab Pro+',
            balanceCu: 1000,
            burnRateCuPerHour: 0,
            eligibleAccelerators: ['CPU', 'T4', 'L4', 'G4', 'A100', 'V6E1', 'V5E1'],
            ineligibleAccelerators: ['H100'],
            createdAt: '',
            updatedAt: new Date().toISOString(),
            activeSessions: []
          }
        ],
        workspaceConnections: { [workspaceRoot]: 'conn-pro-plus' },
        oauthPending: null,
        lastLoginOutcome: null,
        sessions: [],
        untrackedSessions: [],
        lastRunsByWorkspace: {}
      }
    })
    useColabNotebookStore.setState({
      workspaceRoot,
      notebooks: ['train.ipynb'],
      activePath: 'train.ipynb',
      cells: [createCell('code', 'import torch')],
      accelerator: 'H100',
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
      const root = renderer!.root
      const options = root.findAll(
        (n) => n.type === 'button' && typeof n.props['data-colab-accel-option'] === 'string'
      )
      expect(options.map((n) => n.props['data-colab-accel-option'])).toEqual([
        'T4',
        'L4',
        'G4',
        'A100',
        'H100',
        'V6E1',
        'V5E1',
        'CPU'
      ])
      const h100Btn = root.findByProps({ 'data-colab-accel-option': 'H100' })
      const g4Btn = root.findByProps({ 'data-colab-accel-option': 'G4' })
      const tpuBtn = root.findByProps({ 'data-colab-accel-option': 'V6E1' })
      expect(h100Btn.props.disabled).toBe(true)
      expect(h100Btn.props.title).toContain('Google AI Ultra')
      expect(g4Btn.props.disabled).toBe(false)
      expect(tpuBtn.props.disabled).toBe(false)
      // Since H100 is ineligible on this account, effective selection falls back to T4 automatically
      expect(root.findByProps({ 'data-colab-accel-option': 'T4' }).props['aria-checked']).toBe(true)

      await act(async () => {
        g4Btn.props.onClick()
        root.findByProps({ 'data-colab-guards-toggle': true }).props.onClick()
      })
      const guardsPanel = root.findByProps({ 'data-colab-guards-panel': true })
      expect(collectText(guardsPanel)).toContain('High-RAM included')
      const pickerText = collectText(root.findByProps({ 'data-colab-kernel-section': 'colab' }))
      expect(pickerText).toContain('Launch G4')
    } finally {
      if (renderer) await act(async () => renderer?.unmount())
      useColabNotebookStore.setState({ accelerator: 'T4', kernelPickerOpen: false })
      vi.unstubAllGlobals()
    }
  })

  it('surfaces Drive auth account_mismatch guidance and error banners even without an open notebook or Files tab', async () => {
    const workspaceRoot = '/tmp/proj-drive'
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      kunGui: {
        listWorkspaceFiles: vi.fn(async () => ({
          ok: true,
          root: workspaceRoot,
          files: [],
          truncated: false
        })),
        colabNotebookInterrupt: vi.fn(async () => ({ ok: true }))
      }
    })
    useChatStore.setState({ workspaceRoot })
    useColabStore.setState({
      snapshot: {
        cli: { state: 'ready', version: '0.8.0', pythonVersion: '3.12', venvPath: '/tmp/venv' },
        connections: [
          {
            id: 'conn-drive',
            name: 'jackzhongxiaoyu',
            email: 'jackzhongxiaoyu@gmail.com',
            avatarColor: '#7a68e8',
            status: 'connected',
            planLabel: 'Colab Pro+',
            balanceCu: 1000,
            burnRateCuPerHour: 0.1,
            createdAt: '',
            updatedAt: new Date().toISOString(),
            activeSessions: []
          }
        ],
        workspaceConnections: { [workspaceRoot]: 'conn-drive' },
        oauthPending: null,
        lastLoginOutcome: null,
        sessions: [
          {
            id: 'sess-drive-ui',
            sessionName: 'kun-nb-drive',
            connectionId: 'conn-drive',
            connectionName: 'jackzhongxiaoyu',
            connectionEmail: 'jackzhongxiaoyu@gmail.com',
            connectionAvatarColor: '#7a68e8',
            workspaceRoot,
            entryCommand: 'kun-notebook',
            accelerator: 'CPU',
            phase: 'running',
            provisioningStep: 'start',
            startedAt: new Date().toISOString(),
            elapsedSeconds: 8,
            burnRateCuPerHour: 0.1,
            consumedCu: 0,
            estimatedTotalCu: 0.2,
            ramGb: 12.7,
            vramGb: null,
            gpuUtilizationPct: null,
            vramUsedGb: null,
            uploadTransferredBytes: 0,
            uploadTotalBytes: 0,
            gpuHistory: [],
            maxRuntimeHours: 2,
            autoStop: true,
            mountDrive: false,
            syncPaths: [],
            outputRemoteDir: '',
            outputLocalDir: '',
            artifacts: [],
            metrics: {},
            logTail: []
          }
        ],
        untrackedSessions: [],
        lastRunsByWorkspace: {}
      }
    })
    useColabNotebookStore.setState({
      workspaceRoot,
      notebooks: [],
      activePath: null,
      cells: [],
      sidePanelOpen: true,
      sidePanelTab: 'kun'
    })
    useColabDriveStore.getState().applyState({
      sessionId: 'sess-drive-ui',
      status: 'needs_auth',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=retry',
      expiresAt: Date.now() + 300_000,
      reason: 'account_mismatch'
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
      const root = renderer!.root
      const authCard = root.findByProps({ 'data-colab-drive-auth-card': true })
      const authText = collectText(authCard)
      expect(authText).toContain('jackzhongxiaoyu@gmail.com')
      expect(authText).toContain('Incognito')

      await act(async () => {
        useColabDriveStore.getState().applyState({
          sessionId: 'sess-drive-ui',
          status: 'error',
          code: 'account_mismatch',
          message: 'HTTP 400'
        })
      })
      const errBanner = root.findByProps({ 'data-colab-drive-error-banner': true })
      expect(collectText(errBanner)).toContain('jackzhongxiaoyu@gmail.com')
    } finally {
      if (renderer) await act(async () => renderer?.unmount())
      useColabDriveStore.setState({ states: {}, probedSessions: {}, autoMountAttemptedSessions: {} })
      vi.unstubAllGlobals()
    }
  })
})
