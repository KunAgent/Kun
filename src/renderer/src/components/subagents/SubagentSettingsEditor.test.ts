import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultKunRuntimeSettings,
  type KunRuntimeSettingsPatchV1,
  type KunSubagentProfileV1
} from '@shared/app-settings'
import { SubagentSettingsEditor } from './SubagentSettingsEditor'

const loadComposerModels = vi.fn(async () => undefined)

vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    composerModelGroups: [{
      providerId: 'provider-a',
      label: 'Provider A',
      modelIds: ['model-a'],
      modelProfiles: {}
    }],
    loadComposerModels
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => ({
      subagentsRuntimePolicy: 'Runtime policy',
      subagentsMaxParallel: 'Maximum parallel subagents',
      subagentsMaxChildRuns: 'Child runs per session',
      subagentsDelegatable: 'Delegatable subagents',
      subagentsAutomaticRoles: 'Automatic model roles',
      'subagentsPanel.role.general.name': 'General',
      'subagentsPanel.role.explore.name': 'Explore',
      'subagentsPanel.role.design-reviewer.name': 'Design review',
      'subagentsPanel.role.over-engineering-reviewer.name': 'Over-engineering review'
    }[key] ?? fallback ?? key)
  })
}))

vi.mock('../../lib/confirm-dialog', () => ({
  confirmDialog: vi.fn(async () => true)
}))

vi.mock('./AgentKun', () => ({
  AgentKun: ({ id }: { id: string }) => createElement('span', { 'data-agent-id': id })
}))

function customProfile(patch: Partial<KunSubagentProfileV1> = {}): KunSubagentProfileV1 {
  return {
    id: 'researcher',
    enabled: true,
    name: 'Researcher',
    description: 'Investigates hard questions',
    mode: 'subagent',
    toolPolicy: 'readOnly',
    blockedSkills: ['unsafe-skill'],
    ...patch
  }
}

describe('SubagentSettingsEditor', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    if (typeof document === 'undefined') {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn()
        }
      })
    }
    loadComposerModels.mockClear()
  })

  it('renders the settings policy, built-in roster, custom profiles, and automatic roles', async () => {
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        maxParallel: 5,
        maxChildRuns: 20,
        defaultToolPolicy: 'inherit' as const,
        profiles: [customProfile()]
      }
    }
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(SubagentSettingsEditor, {
        kun,
        onPatch: () => undefined,
        variant: 'settings'
      }))
    })

    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('Runtime policy')
    expect(text).toContain('General')
    expect(text).toContain('Explore')
    expect(text).toContain('Design review')
    expect(text).toContain('Over-engineering review')
    expect(text).toContain('Researcher')
    expect(text).toContain('Code review')
    expect(text).toContain('Plan mode')
    expect(text).toContain('Small model')
    expect(loadComposerModels).toHaveBeenCalledOnce()
  })

  it('keeps the compact side-panel surface on the same shared editor', async () => {
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        profiles: [customProfile()]
      }
    }
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(SubagentSettingsEditor, {
        kun,
        onPatch: () => undefined,
        variant: 'panel'
      }))
    })

    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('Researcher')
    expect(text).toContain('New subagent')
    expect(text).toContain('System · internal')
    expect(text).not.toContain('Runtime policy')
  })

  it('patches runtime policy without dropping the roster or sibling limits', async () => {
    const onPatch = vi.fn<(patch: KunRuntimeSettingsPatchV1) => void>()
    const profile = customProfile()
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        maxParallel: 3,
        maxChildRuns: 12,
        defaultToolPolicy: 'inherit' as const,
        profiles: [profile]
      }
    }
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(SubagentSettingsEditor, {
        kun,
        onPatch,
        variant: 'settings'
      }))
    })

    const maxParallelInput = renderer.root.findAllByType('input')
      .find((input) => input.props.type === 'number' && input.props.max === 64)
    expect(maxParallelInput).toBeDefined()
    await act(async () => {
      maxParallelInput!.props.onChange({ target: { value: '7' } })
    })
    await act(async () => {
      maxParallelInput!.props.onBlur()
    })
    expect(onPatch).toHaveBeenLastCalledWith({
      subagents: {
        enabled: true,
        maxParallel: 7,
        maxChildRuns: 12,
        defaultToolPolicy: 'inherit',
        profiles: [profile]
      }
    })
  })

  it('disables a custom profile while keeping its complete configuration', async () => {
    const onPatch = vi.fn<(patch: KunRuntimeSettingsPatchV1) => void>()
    const profile = customProfile({ model: 'reasoner', providerId: 'provider-a' })
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        maxParallel: 4,
        maxChildRuns: 18,
        defaultToolPolicy: 'inherit' as const,
        profiles: [profile]
      }
    }
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(SubagentSettingsEditor, {
        kun,
        onPatch,
        variant: 'settings'
      }))
    })

    const disableButtons = renderer.root.findAllByType('button')
      .filter((button) => button.props.title === 'Disable')
    // Built-ins are always installed by Kun and therefore do not expose a
    // misleading power switch. Only the custom profile is toggleable here.
    expect(disableButtons).toHaveLength(1)

    await act(async () => {
      disableButtons[0].props.onClick()
    })

    expect(onPatch).toHaveBeenCalledWith({
      subagents: {
        enabled: true,
        maxParallel: 4,
        maxChildRuns: 18,
        defaultToolPolicy: 'inherit',
        profiles: [{ ...profile, enabled: false }]
      }
    })
  })

  it('saves a profile model and provider as one coherent pair', async () => {
    const onPatch = vi.fn<(patch: KunRuntimeSettingsPatchV1) => void>()
    const profile = customProfile()
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        maxParallel: 3,
        maxChildRuns: 12,
        profiles: [profile]
      }
    }
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(SubagentSettingsEditor, {
        kun,
        onPatch,
        variant: 'settings'
      }))
    })

    const description = renderer.root.findAllByType('div')
      .find((node) => node.children.includes('Investigates hard questions'))
    const row = description?.parent?.parent
    const trigger = row?.findAllByType('button')
      .find((button) => String(button.props.className).includes('h-9 w-full'))
    expect(trigger).toBeDefined()

    await act(async () => {
      trigger!.props.onClick()
    })
    const provider = renderer.root.findAllByType('span')
      .find((node) => node.children.includes('Provider A'))
    expect(provider?.parent?.type).toBe('button')
    await act(async () => {
      provider!.parent!.props.onClick()
    })
    const model = renderer.root.findAllByType('span')
      .find((node) => node.children.includes('model-a'))
    expect(model?.parent?.type).toBe('button')
    await act(async () => {
      model!.parent!.props.onClick()
    })

    expect(onPatch).toHaveBeenCalledWith({
      subagents: {
        enabled: true,
        maxParallel: 3,
        maxChildRuns: 12,
        profiles: [{ ...profile, model: 'model-a', providerId: 'provider-a' }]
      }
    })
  })
})
