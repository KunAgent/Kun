import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultKunRuntimeSettings,
  type KunRuntimeSettingsPatchV1,
  type KunSubagentProfileV1
} from '@shared/app-settings'
import { SubagentSettingsEditor } from './SubagentSettingsEditor'
import { workspaceProfileToKun } from './subagent-settings-support'

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
  useTranslation: () => ({
    t: (key: string, fallback?: string) => ({
      subagentsRuntimePolicy: 'Runtime policy',
      subagentsUseExistingAgents: 'Use existing agents',
      subagentsUseExistingAgentsDesc: 'Choose configured profiles or parent-defined one-run roles.',
      subagentsMaxParallel: 'Maximum parallel subagents',
      subagentsProactiveRetry: 'Main agent retries failed subagents',
      subagentsProactiveRetryDesc: 'Continue eligible failed children.',
      subagentsProactiveRetryAttempts: 'Maximum proactive retries',
      subagentsProactiveRetryAttemptsDesc: 'One to three retries.',
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

  it('keeps runtime workspace surface visibility in the settings roster', () => {
    expect(workspaceProfileToKun({
      id: 'writer', source: 'workspace', filePath: '/tmp/writer.md',
      mode: 'subagent', toolPolicy: 'readOnly', surfaces: ['write']
    }).surfaces).toEqual(['write'])
    expect(workspaceProfileToKun({
      id: 'legacy', source: 'workspace', filePath: '/tmp/legacy.md',
      mode: 'subagent', toolPolicy: 'readOnly'
    }).surfaces).toEqual(['code'])
  })

  it('renders the settings policy, built-in roster, custom profiles, and automatic roles', async () => {
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        maxParallel: 5,
        proactiveRetry: { enabled: true, maxAttempts: 3 },
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
    expect(text).toContain('Maximum parallel subagents')
    expect(text).toContain('Main agent retries failed subagents')
    expect(text).toContain('Maximum proactive retries')
    expect(text).not.toContain('subagentsMaxChildRuns')
    expect(text).not.toContain('Child runs per session')
    expect(text).toContain('General')
    expect(text).toContain('Search names, capabilities, or scenarios')
    expect(text).toContain('Development')
    expect(text).toContain('Review')
    expect(text).toContain('Quality')
    expect(text).toContain('Planning')
    expect(text).toContain('Operations')
    expect(text).toContain('Research')
    expect(text).toContain('Custom')
    expect(text).toContain('Base agents')
    expect(text).toContain('Code review')
    expect(text).toContain('Plan mode')
    expect(text).toContain('Small model')
    expect(loadComposerModels).toHaveBeenCalledOnce()

    const settingsTabs = renderer.root.findAllByProps({ role: 'tab' })
      .filter((tab) => String(tab.props.id).startsWith('subagent-settings-tab-'))
    expect(settingsTabs).toHaveLength(3)
    expect(settingsTabs.map((tab) => tab.props.id)).toEqual([
      'subagent-settings-tab-policy',
      'subagent-settings-tab-profiles',
      'subagent-settings-tab-automatic'
    ])
    const policyPanel = renderer.root.findByProps({ id: 'subagent-settings-panel-policy' })
    expect(policyPanel.props.hidden).toBe(false)
    expect(policyPanel.findAllByType('input').filter((input) => input.props.type === 'number')).toHaveLength(2)
    expect(renderer.root.findByProps({ id: 'subagent-settings-panel-profiles' }).props.hidden).toBe(true)
    expect(renderer.root.findByProps({ id: 'subagent-settings-panel-automatic' }).props.hidden).toBe(true)

    await act(async () => {
      renderer.root.findByProps({ id: 'subagent-settings-tab-profiles' }).props.onClick()
    })
    expect(renderer.root.findByProps({ id: 'subagent-settings-panel-policy' }).props.hidden).toBe(true)
    expect(renderer.root.findByProps({ id: 'subagent-settings-panel-profiles' }).props.hidden).toBe(false)
    expect(renderer.root.findByProps({ id: 'subagent-settings-panel-automatic' }).props.hidden).toBe(true)

    const researchChip = buttonWithText(renderer, 'Research')
    expect(researchChip).toBeDefined()
    await act(async () => {
      researchChip!.props.onClick()
    })
    expect(JSON.stringify(renderer.toJSON())).toContain('Explore')
  })

  it('keeps the compact side-panel surface on the same shared editor', async () => {
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        profiles: [customProfile()]
      }
    }
    const onPatch = vi.fn()
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(SubagentSettingsEditor, {
        kun,
        onPatch,
        variant: 'panel'
      }))
    })

    let text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('Custom')
    expect(text).toContain('New subagent')
    expect(text).toContain('Extension agents')
    expect(text).toContain('Base agents are always available')
    expect(text).toContain('Enable extension agents')
    expect(text).toContain('System · internal')
    expect(text).not.toContain('Runtime policy')
    expect(renderer.root.findByProps({
      'data-testid': 'subagent-delegation-mode-control'
    })).toBeDefined()
    expect(renderer.root.findAll((node) => typeof node.props.className === 'string'
      && node.props.className.includes('touch-pan-y')
      && node.props.className.includes('overflow-y-auto'))).toHaveLength(1)

    const baseChip = buttonWithText(renderer, 'Base agents')
    expect(baseChip).toBeDefined()
    expect(baseChip!.findAllByType('span').some((span) => span.children.includes('8'))).toBe(true)

    const modeSwitch = renderer.root.findByProps({
      role: 'switch',
      'aria-label': 'Use existing agents'
    })
    expect(modeSwitch.props['aria-checked']).toBe(true)
    await act(async () => {
      modeSwitch.props.onClick()
    })
    expect((onPatch.mock.calls.at(-1)?.[0] as KunRuntimeSettingsPatchV1).subagents)
      .toMatchObject({ useExistingAgents: false })

    const extensionSwitch = renderer.root.findByProps({
      role: 'switch',
      'aria-label': 'Toggle extension agents'
    })
    expect(extensionSwitch.props['aria-checked']).toBe(false)
    await act(async () => {
      extensionSwitch.props.onClick()
    })
    const patch = onPatch.mock.calls.at(-1)?.[0] as KunRuntimeSettingsPatchV1
    const extensionProfiles = (patch.subagents?.profiles ?? []).filter((profile) => profile.id !== 'researcher')
    expect(extensionProfiles).toHaveLength(38)
    expect(extensionProfiles.every((profile) => (profile.surfaces?.length ?? 0) > 0)).toBe(true)
    expect(extensionProfiles.filter((profile) => profile.id.startsWith('write-'))
      .every((profile) => profile.surfaces?.join() === 'write')).toBe(true)
    expect(extensionProfiles.filter((profile) => profile.id.startsWith('design-'))
      .every((profile) => profile.surfaces?.join() === 'design')).toBe(true)
    expect(extensionProfiles.some((profile) => profile.id === 'general')).toBe(false)

    const customChip = buttonWithText(renderer, 'Custom')
    expect(customChip).toBeDefined()
    await act(async () => {
      customChip!.props.onClick()
    })
    text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('Researcher')
  })

  it('persists proactive retry enablement and the bounded attempt count', async () => {
    const onPatch = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(SubagentSettingsEditor, {
        kun: {
          ...defaultKunRuntimeSettings(),
          subagents: {
            enabled: true,
            proactiveRetry: { enabled: true, maxAttempts: 3 },
            profiles: []
          }
        },
        onPatch,
        variant: 'settings'
      }))
    })

    await act(async () => {
      renderer.root.findByProps({
        role: 'switch',
        'aria-label': 'Main agent retries failed subagents'
      }).props.onClick()
    })
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({
      subagents: expect.objectContaining({
        proactiveRetry: { enabled: false, maxAttempts: 3 }
      })
    }))

    const attempts = renderer.root.findAllByType('input').find((input) => input.props.max === 3)
    expect(attempts).toBeDefined()
    await act(async () => {
      attempts!.props.onChange({ target: { value: '2' } })
    })
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({
      subagents: expect.objectContaining({
        proactiveRetry: { enabled: true, maxAttempts: 2 }
      })
    }))
  })

  it('defaults to existing-agent reuse and persists delegation mode changes', async () => {
    const onPatch = vi.fn()
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

    const modeSwitch = renderer.root.findByProps({
      role: 'switch',
      'aria-label': 'Use existing agents'
    })
    expect(modeSwitch.props['aria-checked']).toBe(true)
    await act(async () => {
      modeSwitch.props.onClick()
    })

    expect(onPatch).toHaveBeenLastCalledWith({
      subagents: {
        enabled: true,
        useExistingAgents: false,
        profiles: [expect.objectContaining({ id: 'researcher' })]
      }
    })
  })

  it('shows a partial extension state and enables every extension agent in one action', async () => {
    const onPatch = vi.fn()
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        profiles: [{
          id: 'write-copy-editor',
          enabled: true,
          name: 'Copy Editor',
          mode: 'subagent' as const,
          toolPolicy: 'inherit' as const,
          surfaces: ['write' as const]
        }]
      }
    }
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(SubagentSettingsEditor, { kun, onPatch, variant: 'panel' }))
    })

    const extensionSwitch = renderer.root.findByProps({
      role: 'switch',
      'aria-label': 'Toggle extension agents'
    })
    expect(extensionSwitch.props['aria-checked']).toBe(false)
    expect(extensionSwitch.props['data-state']).toBe('partial')
    const enableAllExtensions = buttonWithText(renderer, 'Enable all extension agents')
    expect(enableAllExtensions).toBeDefined()
    await act(async () => {
      enableAllExtensions!.props.onClick()
    })
    const patch = onPatch.mock.calls.at(-1)?.[0] as KunRuntimeSettingsPatchV1
    const profiles = patch.subagents?.profiles ?? []
    const extensionProfiles = profiles.filter((profile) => ![
      'general',
      'explore',
      'design-reviewer',
      'over-engineering-reviewer',
      'code-reviewer',
      'test-engineer',
      'security-auditor',
      'web-performance-auditor'
    ].includes(profile.id))
    expect(extensionProfiles).toHaveLength(38)
    expect(extensionProfiles.every((profile) => (profile.surfaces?.length ?? 0) > 0)).toBe(true)
    expect(profiles.some((profile) => profile.id === 'general')).toBe(false)
  })

  it('searches across collapsed categories and routing vocabulary', async () => {
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        profiles: []
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

    const search = renderer.root.findAllByType('input')
      .find((input) => input.props.type === 'search')
    expect(search).toBeDefined()
    await act(async () => {
      search!.props.onChange({ target: { value: 'OWASP' } })
    })

    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('Security auditor')
    expect(text).not.toContain('General')

    const securityAgent = buttonWithText(renderer, 'Security auditor')
    expect(securityAgent).toBeDefined()
    await act(async () => {
      securityAgent!.props.onClick()
    })
    const clearSearch = renderer.root.findAllByType('button')
      .find((button) => button.props['aria-label'] === 'Clear search')
    expect(clearSearch).toBeDefined()
    await act(async () => {
      clearSearch!.props.onClick()
    })

    const reviewSection = renderer.root.findByProps({ 'data-agent-category': 'review' })
    const reviewToggle = reviewSection.findAllByType('button')
      .find((button) => button.props['aria-expanded'] !== undefined)
    expect(reviewToggle?.props['aria-expanded']).toBe(true)
    expect(JSON.stringify(renderer.toJSON())).toContain('Security auditor')
  })

  it('paginates settings by twelve and exposes mode assignment state', async () => {
    const onPatch = vi.fn<(patch: KunRuntimeSettingsPatchV1) => void>()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(SubagentSettingsEditor, {
        kun: { ...defaultKunRuntimeSettings(), subagents: { enabled: true, profiles: [] } },
        onPatch,
        variant: 'settings'
      }))
    })

    expect(JSON.stringify(renderer.toJSON())).toContain('"1","/","4"')
    const workTab = renderer.root.findAllByProps({ role: 'tab' })
      .find((button) => button.children.includes('Work'))
    expect(workTab).toBeDefined()
    await act(async () => workTab!.props.onClick())
    const general = buttonWithText(renderer, 'General')
    expect(general).toBeDefined()
    await act(async () => general!.props.onClick())
    const inheritedSwitch = renderer.root.findAllByProps({ role: 'switch' })
      .find((candidate) => candidate.props.disabled === true)!
    expect(inheritedSwitch.props['aria-checked']).toBe(true)
    expect(inheritedSwitch.props.disabled).toBe(true)

    const search = renderer.root.findAllByType('input').find((input) => input.props.type === 'search')
    await act(async () => search!.props.onChange({ target: { value: 'copy edit' } }))
    expect(JSON.stringify(renderer.toJSON())).toContain('Copy Editor')
    expect(JSON.stringify(renderer.toJSON())).toContain('"1","/","1"')
  })

  it('filters the compact panel to the active product surface', async () => {
    mockRoute = 'design'
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(SubagentSettingsEditor, {
        kun: {
          ...defaultKunRuntimeSettings(),
          subagents: {
            enabled: true,
            profiles: [{
              id: 'design-screen-designer',
              enabled: true,
              name: 'Screen Designer',
              mode: 'subagent',
              toolPolicy: 'inherit',
              surfaces: ['design']
            }]
          }
        },
        onPatch: () => undefined,
        variant: 'panel'
      }))
    })
    const allChip = buttonWithText(renderer, 'All')
    expect(allChip).toBeDefined()
    await act(async () => allChip!.props.onClick())
    const search = renderer.root.findAllByType('input').find((input) => input.props.type === 'search')
    await act(async () => search!.props.onChange({ target: { value: 'screen design' } }))
    expect(JSON.stringify(renderer.toJSON())).toContain('Screen Designer')
    await act(async () => search!.props.onChange({ target: { value: 'copy edit' } }))
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Copy Editor')
  })

  it('patches runtime concurrency without dropping the roster or sibling settings', async () => {
    const onPatch = vi.fn<(patch: KunRuntimeSettingsPatchV1) => void>()
    const profile = customProfile()
    const kun = {
      ...defaultKunRuntimeSettings(),
      subagents: {
        enabled: true,
        maxParallel: 3,
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
      .find((input) => input.props.type === 'number' && input.props.max === 256)
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

    const customChip = buttonWithText(renderer, 'Custom')
    expect(customChip).toBeDefined()
    await act(async () => {
      customChip!.props.onClick()
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

    const customChip = buttonWithText(renderer, 'Custom')
    expect(customChip).toBeDefined()
    await act(async () => {
      customChip!.props.onClick()
    })

    const details = renderer.root.findByProps({ 'data-testid': 'subagent-details-panel' })
    const trigger = details.findAllByType('button')
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
        profiles: [{ ...profile, model: 'model-a', providerId: 'provider-a' }]
      }
    })
  })

})
