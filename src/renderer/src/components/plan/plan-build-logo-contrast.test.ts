import { createElement, type ReactElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIcon } from '../agent-icon'
import { PlanBuildAgentPicker } from './PlanBuildAgentPicker'
import { PlanBuildHandoffRow } from './PlanBuildHandoffRow'

const fixture = vi.hoisted(() => {
  const readyIds = ['kun', 'deepseek-harness', 'cursor', 'antigravity', 'codex', 'opencode', 'devin', 'qoder', 'grok', 'morph', 'custom-agent']
  return {
    readyIds,
    options: {
      rows: [...readyIds, 'setup-agent'].map((id) => ({ definition: { id, displayName: id } })),
      groups: [{ providerId: 'test', label: 'Test', modelIds: ['test-model'] }],
      external: false,
      displayModel: 'test-model',
      selectedGroupId: 'test',
      effortChoices: ['auto'],
      effort: 'auto',
      refresh: vi.fn(),
      selectAgent: vi.fn(),
      selectModel: vi.fn(),
      selectEffort: vi.fn()
    }
  }
})

vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../store/chat-store', () => ({ useChatStore: vi.fn() }))
vi.mock('../../store/harness-store', () => ({ useHarnessStore: vi.fn() }))
vi.mock('../../store/task-workspace-store', () => ({ useTaskWorkspaceStore: vi.fn() }))
vi.mock('../../plan/plan-build-agent-store', () => ({ usePlanBuildAgentStore: () => vi.fn() }))
vi.mock('./use-plan-build-agent-options', () => ({ usePlanBuildAgentOptions: () => fixture.options }))
vi.mock('../../lib/harness-connection-presentation', () => ({
  harnessConnectionPresentation: (row: { definition: { id: string } }) => ({
    code: row.definition.id === 'setup-agent' ? 'not-installed' : null
  })
}))
vi.mock('../chat/use-composer-picker-popover', () => ({
  useComposerPickerPopover: () => ({
    triggerRef: { current: null },
    menuRef: { current: null },
    menuStyle: { maxHeight: 440 }
  })
}))

let renderer: ReactTestRenderer | undefined

async function mount(element: ReactElement): Promise<ReactTestRenderer> {
  await act(async () => { renderer = create(element) })
  return renderer!
}

function expectThemeSurface(icon: ReactTestInstance): void {
  const classes = (icon.parent!.props.className as string).split(/\s+/)
  expect(classes).toContain('bg-ds-card')
  expect(classes).toContain('text-ds-ink')
  expect(classes).not.toContain('bg-white')
}

async function openPicker(view: ReactTestRenderer): Promise<void> {
  await act(async () => {
    view.root.findByProps({ 'aria-haspopup': 'menu' }).props.onClick()
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('document', { body: {} })
  vi.clearAllMocks()
})

afterEach(async () => {
  if (renderer) await act(async () => { renderer!.unmount() })
  renderer = undefined
  vi.unstubAllGlobals()
})

describe('plan build Agent logo contrast', () => {
  it.each(fixture.readyIds)('pairs the %s trigger logo with theme-aware foreground and background', async (agentId) => {
    const view = await mount(createElement(PlanBuildAgentPicker, {
      planId: 'contrast-plan', route: { agentId }, disabled: false
    }))
    expectThemeSurface(view.root.findByType(AgentIcon))
  })

  it('keeps ready and setup menu logos readable without changing Agent selection', async () => {
    const view = await mount(createElement(PlanBuildAgentPicker, {
      planId: 'contrast-plan', route: { agentId: 'kun' }, disabled: false
    }))
    await openPicker(view)
    const icons = view.root.findAllByType(AgentIcon)
    expect(icons).toHaveLength(fixture.readyIds.length + 2)
    icons.forEach(expectThemeSurface)
    await act(async () => {
      view.root.findByProps({ 'data-plan-build-agent-option': 'codex' }).props.onClick()
    })
    expect(fixture.options.selectAgent).toHaveBeenCalledWith('codex')
  })

  it('pairs the setup-pane logo with its own theme foreground and background', async () => {
    const view = await mount(createElement(PlanBuildAgentPicker, {
      planId: 'contrast-plan', route: { agentId: 'kun' }, disabled: false
    }))
    await openPicker(view)
    await act(async () => {
      view.root.findByProps({ 'data-plan-build-agent-setup-option': 'setup-agent' }).props.onClick()
    })
    const pane = view.root.findByProps({ 'data-plan-build-agent-setup': 'setup-agent' })
    expectThemeSurface(pane.findByType(AgentIcon))
  })

  it('keeps the handed-off Agent logo readable and preserves the rebuild action', async () => {
    const onRebuild = vi.fn()
    const view = await mount(createElement(PlanBuildHandoffRow, {
      handoff: { threadId: 'build-thread', route: { agentId: 'codex', model: 'test-model' } },
      onRebuild
    }))
    expectThemeSurface(view.root.findByType(AgentIcon))
    await act(async () => { view.root.findAllByType('button')[0].props.onClick() })
    expect(onRebuild).toHaveBeenCalledOnce()
  })
})
