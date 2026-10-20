import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { GitBranchesResult } from '@shared/git-branches'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { useChatStore } from '../../store/chat-store'
import i18n from '../../i18n'
import { FloatingComposer } from './FloatingComposer'
import { GitBranchPicker } from './GitBranchPicker'
import { calculateComposerPopoverPlacement } from './floating-composer-popover-placement'

const { createPortalMock } = vi.hoisted(() => ({
  createPortalMock: vi.fn((children: unknown) => children)
}))

vi.mock('react-dom', () => ({ createPortal: createPortalMock }))

const BRANCH_RESULT: GitBranchesResult = {
  ok: true,
  repositoryRoot: '/workspace/project',
  primaryRepositoryRoot: '/workspace/project',
  currentBranch: 'codemaker/dev',
  dirtyCount: 2,
  branches: [
    { name: 'codemaker/dev', current: true },
    { name: 'codemaker/production', current: false },
    { name: 'codemaker/1_17_11', current: false }
  ]
}

function installWindow(overrides: Record<string, unknown> = {}): void {
  vi.stubGlobal('document', { activeElement: null, body: {} })
  vi.stubGlobal('HTMLElement', class {})
  vi.stubGlobal('window', {
    innerWidth: 1440,
    innerHeight: 900,
    setTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
    kunGui: {
      getSettings: vi.fn(async () => ({ composerSendKey: 'enter', gitBranchPrefix: 'codex/' })),
      getGitBranches: vi.fn(async () => BRANCH_RESULT),
      switchGitBranch: vi.fn(async () => BRANCH_RESULT),
      ...overrides
    }
  })
}

function floatingComposerProps(overrides: Record<string, unknown> = {}) {
  return {
    input: '',
    setInput: () => undefined,
    mode: 'agent' as const,
    setMode: () => undefined,
    busy: false,
    runtimeReady: true,
    hasActiveThread: true,
    workspaceRootOverride: '/workspace/project',
    composerModel: 'test-model',
    composerPickList: ['test-model'],
    onComposerModelChange: () => undefined,
    queuedMessages: [] as [],
    onRemoveQueuedMessage: () => undefined,
    onSend: () => undefined,
    onInterrupt: () => undefined,
    onPlanCommand: () => undefined,
    ...overrides
  }
}

describe('composer worktree launch settings', () => {
  let previousLanguage: string

  beforeEach(async () => {
    createPortalMock.mockClear()
    previousLanguage = i18n.language
    await i18n.changeLanguage('en')
    rendererRuntimeClient.invalidateSettings()
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      activeThreadTodos: null,
      blocks: [],
      route: 'chat',
      workspaceRoot: '/workspace/project',
      threads: []
    })
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
    await i18n.changeLanguage(previousLanguage)
  })

  it('bounds a tall branch panel inside a short viewport', () => {
    const placement = calculateComposerPopoverPlacement({
      anchorRect: { left: 240, right: 434, top: 440, bottom: 472 },
      popoverHeight: 580,
      viewportHeight: 562,
      viewportWidth: 675,
      preferredWidth: 560,
      maximumHeight: 640
    })

    expect(placement).toEqual({ left: 57, top: 12, width: 560, maxHeight: 420 })
  })

  it('summarizes the selected branch and toggles isolated-worktree mode', async () => {
    installWindow()
    const onToggleWorktreeMode = vi.fn()
    const onWorktreeBranchChange = vi.fn()
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(GitBranchPicker, {
        workspaceRoot: '/workspace/project',
        useWorktreePool: true,
        worktreeBranch: 'codemaker/production',
        onToggleWorktreeMode,
        onWorktreeBranchChange
      }))
    })

    try {
      const trigger = renderer!.root.findByProps({
        'data-composer-launch-settings-trigger': true
      })
      expect(trigger.props['data-composer-launch-mode']).toBe('worktree')
      const spanTexts = trigger.findAllByType('span').map((span) => span.children.join(''))
      expect(spanTexts).toContain('codemaker/production')
      expect(spanTexts).toContain('· Isolated worktree')

      await act(async () => {
        trigger.props.onClick()
      })
      const toggle = renderer!.root.findByProps({
        'data-composer-worktree-mode-toggle': true
      })
      const panel = renderer!.root.findByProps({
        'data-composer-launch-settings-panel': true
      })
      expect(createPortalMock).toHaveBeenCalledWith(expect.anything(), document.body)
      expect(panel.props.className).toContain('fixed')
      expect(panel.props.className).toContain('z-[1000]')
      expect(panel.props.role).toBe('dialog')
      expect(toggle.findByProps({ role: 'switch' }).props['aria-checked']).toBe(true)

      await act(async () => {
        toggle.props.onClick()
      })
      expect(onToggleWorktreeMode).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => {
        renderer!.unmount()
      })
    }
  })

  it('selects a worktree base branch without switching the current checkout', async () => {
    const switchGitBranch = vi.fn(async () => BRANCH_RESULT)
    installWindow({ switchGitBranch })
    const onWorktreeBranchChange = vi.fn()
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(GitBranchPicker, {
        workspaceRoot: '/workspace/project',
        useWorktreePool: true,
        worktreeBranch: 'codemaker/dev',
        onWorktreeBranchChange,
        onToggleWorktreeMode: () => undefined
      }))
    })
    await act(async () => {
      renderer!.root.findByProps({
        'data-composer-launch-settings-trigger': true
      }).props.onClick()
    })

    try {
      const branch = renderer!.root.findByProps({
        'data-composer-launch-branch': 'codemaker/production'
      })
      await act(async () => {
        branch.props.onClick()
      })
      expect(onWorktreeBranchChange).toHaveBeenCalledWith('codemaker/production')
      expect(switchGitBranch).not.toHaveBeenCalled()
    } finally {
      await act(async () => {
        renderer!.unmount()
      })
    }
  })

  it('switches the checkout when selecting a branch in current-directory mode', async () => {
    const switchedResult: GitBranchesResult = {
      ...BRANCH_RESULT,
      currentBranch: 'codemaker/production',
      branches: BRANCH_RESULT.ok
        ? BRANCH_RESULT.branches.map((branch) => ({
            ...branch,
            current: branch.name === 'codemaker/production'
          }))
        : []
    }
    const switchGitBranch = vi.fn(async () => switchedResult)
    installWindow({ switchGitBranch })
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(GitBranchPicker, {
        workspaceRoot: '/workspace/project',
        useWorktreePool: false,
        onToggleWorktreeMode: () => undefined
      }))
    })
    await act(async () => {
      renderer!.root.findByProps({
        'data-composer-launch-settings-trigger': true
      }).props.onClick()
    })

    try {
      const branch = renderer!.root.findByProps({
        'data-composer-launch-branch': 'codemaker/production'
      })
      await act(async () => {
        branch.props.onClick()
      })
      expect(switchGitBranch).toHaveBeenCalledWith('/workspace/project', 'codemaker/production')
    } finally {
      await act(async () => {
        renderer!.unmount()
      })
    }
  })

  it('removes the worktree toggle from the composer plus menu', async () => {
    installWindow()
    useChatStore.setState({
      blocks: [{ kind: 'user', id: 'started', text: 'Conversation already started' }]
    })
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(FloatingComposer, floatingComposerProps({
        onToggleWorktreeMode: vi.fn(),
        useWorktreePool: false
      })))
    })

    try {
      const plusButton = renderer!.root.findAllByType('button').find(
        (button) => String(button.props.className).includes('ds-composer-menu-button')
      )
      expect(plusButton).toBeDefined()
      await act(async () => {
        plusButton!.props.onClick()
      })
      const menuSnapshot = JSON.stringify(renderer!.toJSON())
      expect(menuSnapshot).not.toContain('Local environment')
      expect(menuSnapshot).not.toContain('Worktree mode')
      expect(renderer!.root.findAllByProps({
        'data-composer-worktree-mode-toggle': true
      })).toHaveLength(0)
    } finally {
      await act(async () => {
        renderer!.unmount()
      })
    }
  })
})
