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
let mockRoute = 'chat'

vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    composerModelGroups: [{
      providerId: 'provider-a',
      label: 'Provider A',
      modelIds: ['model-a'],
      modelProfiles: {}
    }],
    route: mockRoute,
    loadComposerModels
  })
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => ({
      subagentsRuntimePolicy: 'Runtime policy',
      subagentsUseExistingAgents: 'Use existing agents',
      subagentsUseExistingAgentsDesc: 'Choose configured profiles or parent-defined one-run roles.',
      subagentsMaxParallel: 'Maximum parallel subagents',
      subagentsDelegatable: 'Delegatable subagents',
      subagentsAutomaticRoles: 'Automatic model roles',
      'agentsView.followDefault': 'Follow default',
      'agentsView.fModel': 'Model',
      composerReasoningAuto: 'Adaptive',
      composerReasoningOff: 'Off',
      composerReasoningLow: 'Low',
      composerReasoningMedium: 'Med',
      composerReasoningHigh: 'High',
      composerReasoningMax: 'Ultra',
      'subagentsPanel.mixedModels': 'Mixed models',
      'subagentsPanel.mixedConfiguration': 'Multiple configurations',
      'subagentsPanel.categoryConfiguration': 'Category default configuration',
      'subagentsPanel.categoryConfigurationDesc': 'Apply the same defaults to every agent in this category',
      'subagentsPanel.resetCategoryConfiguration': 'Reset defaults',
      'subagentsPanel.effectiveModel': 'Effective model',
      'subagentsPanel.mixedReasoning': 'Mixed reasoning',
      'subagentsPanel.reasoning': 'Reasoning',
      'subagentsPanel.batchModelAria': 'Set the same model for all {{count}} agents in {{category}}',
      'subagentsPanel.batchReasoningAria': 'Set the same reasoning effort for all {{count}} agents in {{category}}',
      'subagentsPanel.category.review': 'Review',
      'subagentsPanel.role.general.name': 'General',
      'subagentsPanel.role.explore.name': 'Explore',
      'subagentsPanel.role.design-reviewer.name': 'Design review',
      'subagentsPanel.role.over-engineering-reviewer.name': 'Over-engineering review',
      'subagentsPanel.role.code-reviewer.name': 'Code reviewer',
      'subagentsPanel.role.test-engineer.name': 'Test engineer',
      'subagentsPanel.role.security-auditor.name': 'Security auditor',
      'subagentsPanel.role.web-performance-auditor.name': 'Web performance auditor'
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

function buttonWithText(renderer: ReactTestRenderer, text: string) {
  return renderer.root.findAllByType('button').find((button) =>
    button.findAllByType('span').some((span) => span.children.includes(text))
  )
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
    mockRoute = 'chat'
  })

  it('batch-applies one model to every agent in a category, overwriting mixed overrides', async () => {
    const onPatch = vi.fn<(patch: KunRuntimeSettingsPatchV1) => void>()
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        profiles: [
          {
            id: 'design-reviewer',
            enabled: true,
            name: 'Design Reviewer',
            mode: 'subagent' as const,
            toolPolicy: 'readOnly' as const,
            model: 'old-model',
            providerId: 'provider-a'
          },
          {
            id: 'code-reviewer',
            enabled: true,
            name: 'Code Reviewer',
            mode: 'subagent' as const,
            toolPolicy: 'readOnly' as const,
            model: 'other-model',
            providerId: 'provider-b'
          }
        ]
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

    const reviewChip = buttonWithText(renderer, 'Review')
    expect(reviewChip).toBeDefined()
    await act(async () => {
      reviewChip!.props.onClick()
    })

    expect(JSON.stringify(renderer.toJSON())).toContain('Mixed models')

    const batchTrigger = renderer.root.findAllByType('button').find((button) =>
      button.props['aria-label'] === 'Set the same model for all {{count}} agents in {{category}}')
    expect(batchTrigger).toBeDefined()

    await act(async () => {
      batchTrigger!.props.onClick()
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

    const patch = onPatch.mock.calls.at(-1)?.[0] as KunRuntimeSettingsPatchV1
    const profiles = patch.subagents?.profiles ?? []
    expect(profiles.find((profile) => profile.id === 'design-reviewer')).toMatchObject({
      model: 'model-a',
      providerId: 'provider-a'
    })
    expect(profiles.find((profile) => profile.id === 'code-reviewer')).toMatchObject({
      model: 'model-a',
      providerId: 'provider-a'
    })
    expect(profiles.length).toBeGreaterThan(2)
    expect(profiles.every((profile) =>
      profile.model === 'model-a' && profile.providerId === 'provider-a')).toBe(true)
  })

  it('keeps category controls inside the expanded section and shows a passive collapsed summary', async () => {
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        profiles: [
          {
            id: 'general',
            enabled: true,
            name: 'General',
            mode: 'subagent' as const,
            toolPolicy: 'inherit' as const,
            model: 'model-a',
            providerId: 'provider-a',
            reasoningEffort: 'low' as const
          },
          {
            id: 'component-designer',
            enabled: true,
            name: 'Component Designer',
            mode: 'subagent' as const,
            toolPolicy: 'inherit' as const,
            reasoningEffort: 'high' as const
          }
        ]
      }
    }
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(SubagentSettingsEditor, {
        kun,
        onPatch: vi.fn(),
        variant: 'settings'
      }))
    })

    const developmentSection = renderer.root.findByProps({ 'data-agent-category': 'development' })
    expect(developmentSection.findAllByProps({
      'data-testid': 'subagent-category-configuration'
    })).toHaveLength(1)
    expect(developmentSection.findAllByType('span').some((span) =>
      span.children.includes('Multiple configurations'))).toBe(false)

    await act(async () => {
      developmentSection.findAllByType('button')[0]!.props.onClick()
    })

    expect(developmentSection.findAllByType('span').some((span) =>
      span.children.includes('Multiple configurations'))).toBe(true)
    expect(developmentSection.findAllByProps({
      'data-testid': 'subagent-category-configuration'
    })).toHaveLength(0)
  })

  it('resets model, provider, and reasoning overrides for a category in one update', async () => {
    const onPatch = vi.fn<(patch: KunRuntimeSettingsPatchV1) => void>()
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        profiles: [
          {
            id: 'design-reviewer',
            enabled: true,
            name: 'Design Reviewer',
            mode: 'subagent' as const,
            toolPolicy: 'readOnly' as const,
            model: 'model-a',
            providerId: 'provider-a',
            reasoningEffort: 'low' as const
          },
          {
            id: 'code-reviewer',
            enabled: true,
            name: 'Code Reviewer',
            mode: 'subagent' as const,
            toolPolicy: 'readOnly' as const,
            model: 'model-a',
            providerId: 'provider-a',
            reasoningEffort: 'high' as const
          }
        ]
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

    const reviewChip = buttonWithText(renderer, 'Review')
    expect(reviewChip).toBeDefined()
    await act(async () => {
      reviewChip!.props.onClick()
    })

    const reviewSection = renderer.root.findByProps({ 'data-agent-category': 'review' })
    const reset = reviewSection.findAllByType('button').find((button) =>
      button.children.length === 1 && button.children[0] === 'Reset defaults')
    expect(reset).toBeDefined()

    await act(async () => {
      reset!.props.onClick()
    })

    const patch = onPatch.mock.calls.at(-1)?.[0] as KunRuntimeSettingsPatchV1
    for (const id of ['design-reviewer', 'code-reviewer']) {
      expect(patch.subagents?.profiles?.find((profile) => profile.id === id)).toMatchObject({
        model: undefined,
        providerId: undefined,
        reasoningEffort: undefined
      })
    }
  })

  it('batch-clears category models back to follow-default', async () => {
    const onPatch = vi.fn<(patch: KunRuntimeSettingsPatchV1) => void>()
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        profiles: [
          {
            id: 'design-reviewer',
            enabled: true,
            name: 'Design Reviewer',
            mode: 'subagent' as const,
            toolPolicy: 'readOnly' as const,
            model: 'model-a',
            providerId: 'provider-a'
          },
          {
            id: 'code-reviewer',
            enabled: true,
            name: 'Code Reviewer',
            mode: 'subagent' as const,
            toolPolicy: 'readOnly' as const,
            model: 'model-a',
            providerId: 'provider-a'
          }
        ]
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

    const reviewChip = buttonWithText(renderer, 'Review')
    expect(reviewChip).toBeDefined()
    await act(async () => {
      reviewChip!.props.onClick()
    })

    const batchTrigger = renderer.root.findAllByType('button').find((button) =>
      button.props['aria-label'] === 'Set the same model for all {{count}} agents in {{category}}')
    expect(batchTrigger).toBeDefined()
    await act(async () => {
      batchTrigger!.props.onClick()
    })

    const followDefault = renderer.root.findAllByType('span')
      .find((node) => node.children.includes('Follow default'))
    expect(followDefault?.parent?.type).toBe('button')
    await act(async () => {
      followDefault!.parent!.props.onClick()
    })

    const patch = onPatch.mock.calls.at(-1)?.[0] as KunRuntimeSettingsPatchV1
    const profiles = patch.subagents?.profiles ?? []
    expect(profiles.find((profile) => profile.id === 'design-reviewer')).toMatchObject({
      model: undefined,
      providerId: undefined
    })
    expect(profiles.find((profile) => profile.id === 'code-reviewer')).toMatchObject({
      model: undefined,
      providerId: undefined
    })
    expect(profiles.every((profile) => !profile.model && !profile.providerId)).toBe(true)
  })

  it('lets a follow-default agent set reasoning effort without picking a model', async () => {
    const onPatch = vi.fn<(patch: KunRuntimeSettingsPatchV1) => void>()
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
        onPatch,
        variant: 'settings'
      }))
    })

    const customChip = buttonWithText(renderer, 'Custom')
    expect(customChip).toBeDefined()
    await act(async () => {
      customChip!.props.onClick()
    })

    const details = renderer.root.findByProps({ 'data-testid': 'subagent-details-panel' })
    const highChip = details.findAllByType('button').find((button) =>
      button.children.length === 1 && button.children[0] === 'High')
    expect(highChip).toBeDefined()
    await act(async () => {
      highChip!.props.onClick()
    })

    const patch = onPatch.mock.calls.at(-1)?.[0] as KunRuntimeSettingsPatchV1
    expect(patch.subagents?.profiles?.find((profile) => profile.id === 'researcher')).toMatchObject({
      reasoningEffort: 'high'
    })
  })

  it('batch-applies reasoning effort across a category and can clear it to off', async () => {
    const onPatch = vi.fn<(patch: KunRuntimeSettingsPatchV1) => void>()
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        profiles: [
          {
            id: 'design-reviewer',
            enabled: true,
            name: 'Design Reviewer',
            mode: 'subagent' as const,
            toolPolicy: 'readOnly' as const,
            reasoningEffort: 'low' as const
          },
          {
            id: 'code-reviewer',
            enabled: true,
            name: 'Code Reviewer',
            mode: 'subagent' as const,
            toolPolicy: 'readOnly' as const,
            reasoningEffort: 'high' as const
          }
        ]
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

    const reviewChip = buttonWithText(renderer, 'Review')
    expect(reviewChip).toBeDefined()
    await act(async () => {
      reviewChip!.props.onClick()
    })

    expect(JSON.stringify(renderer.toJSON())).toContain('Mixed reasoning')

    const batchGroup = renderer.root.findAllByProps({
      'aria-label': 'Set the same reasoning effort for all {{count}} agents in {{category}}'
    })[0]
    expect(batchGroup).toBeDefined()
    const medium = batchGroup.findAllByType('button').find((button) =>
      button.children.length === 1 && button.children[0] === 'Med')
    expect(medium).toBeDefined()
    await act(async () => {
      medium!.props.onClick()
    })

    let patch = onPatch.mock.calls.at(-1)?.[0] as KunRuntimeSettingsPatchV1
    let profiles = patch.subagents?.profiles ?? []
    expect(profiles.find((profile) => profile.id === 'design-reviewer')).toMatchObject({
      reasoningEffort: 'medium'
    })
    expect(profiles.find((profile) => profile.id === 'code-reviewer')).toMatchObject({
      reasoningEffort: 'medium'
    })
    expect(profiles.every((profile) => profile.reasoningEffort === 'medium')).toBe(true)

    const off = batchGroup.findAllByType('button').find((button) =>
      button.children.length === 1 && button.children[0] === 'Off')
    expect(off).toBeDefined()
    await act(async () => {
      off!.props.onClick()
    })

    patch = onPatch.mock.calls.at(-1)?.[0] as KunRuntimeSettingsPatchV1
    profiles = patch.subagents?.profiles ?? []
    expect(profiles.find((profile) => profile.id === 'design-reviewer')).toMatchObject({
      reasoningEffort: undefined
    })
    expect(profiles.find((profile) => profile.id === 'code-reviewer')).toMatchObject({
      reasoningEffort: undefined
    })
    expect(profiles.every((profile) => !profile.reasoningEffort)).toBe(true)
  })
})
