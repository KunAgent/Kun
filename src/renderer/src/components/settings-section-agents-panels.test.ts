import {
  AgentsSettingsSection,
  FastContextSettingsPanel,
  LaboratorySettingsSection,
  PptSkillSettingsPanel,
  act,
  baseCtx,
  createElement,
  createRenderer,
  defaultKunRuntimeSettings,
  describe, expect,
  getModelProviderPreset,
  instanceText,
  it,
  modelProviderPresetProfile,
  renderToStaticMarkup,
  t,
  vi,
  type KunFastContextSettingsV1,
  type KunLabSettingsV1,
  type ModelProviderModelProfileV1, type ModelProviderProfileV1,
  type ReactTestRenderer
} from './settings-section-agents.test-support'
import { defaultKunLabSettings } from '@shared/app-settings'

/** Every Kun Agent settings page as one string; each panel is its own settings page now. */
function allAgentPanels(ctx: Record<string, unknown>): string {
  return (['assistant', 'permissions', 'skills', 'tools', 'project', 'runtime'] as const)
    .map((panel) => renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx, panel })))
    .join('\n')
}


describe('AgentsSettingsSection Kun diagnostics smoke', () => {
  it('keeps advanced agent controls behind collapsed disclosures', () => {
    const html = allAgentPanels(baseCtx())

    expect(html).toContain('settingsIaServiceCard')
    expect(html).toContain('settingsIaRuntimeTuningCard')
    expect(html).toContain('Maximum concurrent turns')
    expect(html).toContain('value="256"')
    expect(html).toContain('Maximum turn duration')
    expect(html).toContain('value="86400000"')
    expect(html).not.toContain('Windowed context')
    expect(html).toContain('MCP advanced settings')
    expect(html).not.toContain('<details open')
  })

  it('does not render image generation settings inside the agent section', () => {
    const html = allAgentPanels(baseCtx())

    expect(html).not.toContain('imageGen')
  })

  it('renders exactly three unified permission controls with full access as the default', () => {
    const html = allAgentPanels(baseCtx())

    expect(html).toContain('Choose who reviews approval-worthy actions or grant full access')
    expect(html).toContain('Tool permission mode')
    expect(html).toContain('role="radiogroup"')
    expect(html.match(/role="radio"/g)).toHaveLength(3)
    expect(html).toContain('Ask for approval')
    expect(html).toContain('Approval-worthy actions ask you first')
    expect(html).toContain('Approve for me')
    expect(html).toContain('Your selected model reviews approval-worthy actions')
    expect(html).toContain('Full access')
    expect(html).toContain('Unrestricted files, host commands, and network-capable tools')
    expect(html).toContain('lucide-hand')
    expect(html).toContain('lucide-bot')
    expect(html).toContain('lucide-lock-keyhole-open')
    expect(html).not.toContain('Approval policy')
    expect(html).not.toContain('Sandbox mode')
  })

  it('applies the complete full-access mapping only from trusted activation', () => {
    const updateKun = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = createRenderer(createElement(AgentsSettingsSection, {
        panel: 'permissions',
        ctx: {
          ...baseCtx(),
          kun: {
            ...defaultKunRuntimeSettings(),
            approvalPolicy: 'on-request',
            sandboxMode: 'workspace-write',
            approvalReviewer: 'user'
          },
          updateKun
        }
      }))
    })
    const fullAccess = renderer.root
      .findAllByProps({ role: 'radio' })
      .find((button) => instanceText(button).includes('Full access'))
    expect(fullAccess).toBeDefined()

    act(() => {
      fullAccess?.props.onClick({ isTrusted: false })
    })
    expect(updateKun).not.toHaveBeenCalled()

    act(() => {
      fullAccess?.props.onClick({ isTrusted: true })
    })
    expect(updateKun).toHaveBeenCalledWith({
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      approvalReviewer: 'user'
    })
  })

  it('gives permissions their own page and lists experimental features without tabs', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = createRenderer(createElement(AgentsSettingsSection, {
        ctx: baseCtx(),
        panel: 'permissions'
      }))
    })

    const permissionsPage = renderer.root.findByProps({ id: 'agents-settings-panel-permissions' })
    expect(renderer.root.findAllByProps({ role: 'tab' })).toHaveLength(0)
    expect(permissionsPage.findAllByProps({ role: 'radiogroup' })).toHaveLength(1)
    expect(instanceText(permissionsPage)).toContain('Design quality')

    act(() => {
      renderer = createRenderer(createElement(LaboratorySettingsSection, {
        ctx: {
          ...baseCtx(),
          t: (key: string) => key === 'labAutoPlanBuildTitle' ? 'Automatic plan and build'
            : key === 'labCodexReferenceBranchesTitle' ? 'Codex history branches' : t(key)
        }
      }))
    })

    expect(renderer.root.findAllByProps({ role: 'tab' })).toHaveLength(0)
    const groups = renderer.root.findAll((node) =>
      node.type === 'section' && node.props.className === 'ds-settings-feature-group')
    expect(groups.map((group) => group.props['aria-label'])).toEqual([
      'settingsIaLabsGroupConversation',
      'settingsIaLabsGroupAutomation',
      'settingsIaLabsGroupControl'
    ])
    const features = renderer.root.findAll((node) =>
      node.type === 'section' && node.props.className === 'ds-settings-feature')
    expect(features.map((feature) => feature.props['aria-label'])).toEqual([
      'Context compression',
      'Session display optimization',
      'labGenUiTitle',
      'labMcpAppsTitle',
      'Codex history branches',
      'Automatic plan and build',
      'Graph mode',
      'Project board',
      'labAssistantMailboxTitle',
      'Computer control',
      'Browser'
    ])
  })

  it('shows the PPT skill on the regular Skills page without an experimental master switch', () => {
    const settings = defaultKunRuntimeSettings()
    settings.lab.pptAgent = { enabled: false, imageAssets: false }
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: { ...baseCtx(), kun: settings }, panel: 'skills'
    }))
    expect(html).toContain('PPT skill')
    expect(html).toContain('labPptImageAssetsOffHint')
    expect(html).not.toContain('Enable PPT tools')
  })

  it('excludes legacy PPT enabled state from the Laboratory count', () => {
    const renderCount = (enabled: boolean): string => {
      const settings = defaultKunRuntimeSettings()
      settings.lab.pptAgent.enabled = enabled
      return renderToStaticMarkup(createElement(LaboratorySettingsSection, {
        ctx: {
          ...baseCtx(),
          kun: settings,
          t: (key: string, params?: { count: number; total: number }) =>
            key === 'settingsIaLabsEnabledCount' ? `${params?.count}/${params?.total}` : t(key)
        }
      }))
    }
    expect(renderCount(false)).toContain('1/11')
    expect(renderCount(true)).toContain('1/11')
  })

  it('passes the runtime Browser Use capability into its settings panel', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = createRenderer(createElement(LaboratorySettingsSection, {
        ctx: {
          ...baseCtx(),
          runtimeInfo: {
            capabilities: {
              browserUse: {
                status: 'interaction-required',
                enabled: true,
                available: false,
                reason: 'visible GUI is required'
              }
            }
          }
        }
      }))
    })

    const browserFeature = renderer.root.findByProps({ className: 'ds-settings-feature', 'aria-label': 'Browser' })
    expect(instanceText(browserFeature)).toContain(
      'browserUseRuntimeStatusInteractionRequired: visible GUI is required'
    )
  })

  it('updates contextCompaction flags from the laboratory feature list', () => {
    const updateKun = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = createRenderer(createElement(LaboratorySettingsSection, {
        ctx: { ...baseCtx(), updateKun }
      }))
    })
    const panel = renderer.root.findByProps({ className: 'ds-settings-feature', 'aria-label': 'Context compression' })
    const parentToggle = panel.findByProps({
      role: 'switch',
      'aria-label': 'Model-initiated context compression'
    })
    expect(panel.findByProps({
      role: 'switch',
      'aria-label': 'Enable windowed context'
    }).props.disabled).toBe(true)
    act(() => parentToggle.props.onClick())
    expect(updateKun).toHaveBeenCalledWith(expect.objectContaining({
      contextCompaction: expect.objectContaining({
        modelInitiatedCompactionEnabled: true,
        windowModeEnabled: false
      })
    }))
  })

  it('renders and updates composer personas from the assistant panel', () => {
    const update = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = createRenderer(createElement(AgentsSettingsSection, {
        ctx: { ...baseCtx(), update }
      }))
    })

    const assistantPanel = renderer.root.findByProps({
      id: 'agents-settings-panel-assistant'
    })
    const assistantText = instanceText(assistantPanel)
    expect(assistantText.indexOf('Personas')).toBeGreaterThanOrEqual(0)
    expect(assistantText.indexOf('Personas')).toBeLessThan(assistantText.indexOf('Fast Context'))
    const personaCard = assistantPanel
      .findAllByType('section')
      .find((section) => instanceText(section).startsWith('Personas'))
    expect(personaCard).toBeDefined()
    expect(instanceText(personaCard!)).toContain('Add persona')
    const toggle = personaCard!.findByProps({ role: 'switch' })
    expect(toggle.props['aria-checked']).toBe(true)

    act(() => toggle.props.onClick())
    expect(update).toHaveBeenCalledWith({ codeAgentPersonaEnabled: false })
  })

  it('renders the Fast Context assistant panel and gates fast mode on Codex priority models', () => {
    const renderPanel = (value: KunFastContextSettingsV1) => renderToStaticMarkup(createElement(
      FastContextSettingsPanel,
      {
        t,
        value,
        modelProviders: [],
        leadProviderId: 'deepseek',
        leadModel: 'deepseek-v4-pro',
        selectControlClass: 'select',
        onChange: () => undefined
      }
    ))

    const followMain = renderPanel({
      enabled: true,
      model: '',
      providerId: '',
      fast: false
    })
    expect(followMain).toContain('Enable Fast Context')
    expect(followMain).toContain('Follow main model')
    expect(followMain).not.toContain('Codex Fast mode')

    const fixed = renderPanel({
      enabled: true,
      model: 'deepseek-v4-pro',
      providerId: 'deepseek',
      fast: false
    })
    expect(fixed).toContain('Use fixed model')
    expect(fixed).toContain('Fast Context reasoning effort')
    expect(fixed).not.toContain('Codex Fast mode')

    const disabled = renderPanel({
      enabled: false,
      model: '',
      providerId: '',
      fast: false
    })
    expect(disabled).not.toContain('Follow main model')
  })

  it('renders the PPT skill without a master switch even when old settings disabled it', () => {
    const renderPanel = (value: KunLabSettingsV1) => renderToStaticMarkup(createElement(
      PptSkillSettingsPanel,
      { t, value, onChange: () => undefined }
    ))
    const oldDisabled = renderPanel({
      ...defaultKunLabSettings(),
      pptAgent: { enabled: false, imageAssets: false }
    })
    expect(oldDisabled).toContain('PPT skill')
    expect(oldDisabled).toContain('labPptImageAssetsOffHint')
    expect(oldDisabled).not.toContain('Enable PPT tools')
    expect(oldDisabled).not.toContain('data-open="false"')
    expect(oldDisabled).not.toContain('Follow main model')
  })

  it('enables the fast toggle only when the selected model advertises Codex priority', async () => {
    const codexModelProfile: ModelProviderModelProfileV1 = {
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text'],
      serviceTiers: ['priority']
    }
    const modelProviders: ModelProviderProfileV1[] = [{
      id: 'codex-2',
      name: 'Codex',
      apiKey: '',
      baseUrl: '',
      endpointFormat: 'chat_completions',
      useProxy: false,
      models: ['gpt-5.4'],
      presetSource: { presetId: 'codex', mode: 'api' },
      modelProfiles: { 'gpt-5.4': codexModelProfile }
    }]
    const mount = async (): Promise<ReactTestRenderer> => {
      let renderer: ReactTestRenderer
      await act(async () => {
        renderer = createRenderer(createElement(FastContextSettingsPanel, {
          t,
          value: {
            enabled: true,
            model: 'gpt-5.4',
            providerId: 'codex-2',
            fast: true
          },
          modelProviders,
          leadProviderId: 'codex-2',
          leadModel: 'gpt-5.4',
          selectControlClass: 'select',
          onChange: () => undefined
        }))
      })
      return renderer!
    }

    // Codex model advertising priority: both toggles enabled and checked.
    let renderer = await mount()
    let switches = renderer.root.findAllByProps({ role: 'switch' })
    expect(switches).toHaveLength(2)
    expect(switches.map((node) => node.props['aria-checked'])).toEqual([true, true])
    expect(switches.map((node) => node.props['aria-disabled'])).toEqual([false, false])

    // Model without priority support: the fast toggle is disabled and unchecked.
    modelProviders[0]!.modelProfiles = {}
    renderer = await mount()
    switches = renderer.root.findAllByProps({ role: 'switch' })
    expect(switches.map((node) => node.props['aria-checked'])).toEqual([true, false])
    expect(switches.map((node) => node.props['aria-disabled'])).toEqual([false, true])
  })

  it('renders pure JSONL as a selectable storage backend', () => {
    const html = allAgentPanels(baseCtx())

    expect(html).toContain('Storage backend')
    expect(html).toContain('<option value="hybrid"')
    expect(html).toContain('Hybrid storage')
    expect(html).toContain('<option value="file"')
    expect(html).toContain('Pure JSONL file storage')
  })

  it('shows DeepSeek V4 model compaction thresholds from the model profile', () => {
    const html = allAgentPanels(baseCtx())

    expect(html).toContain('Current model context policy')
    expect(html).toContain('deepseek-v4-pro')
    expect(html).toContain('Built-in model config')
    expect(html).toContain('1,000,000')
    expect(html).toContain('980,000')
    expect(html).toContain('990,000')
    expect(html).toContain('Fallback compaction thresholds')
  })

  it('renders MCP, Skill, web, attachment, and memory diagnostics', () => {
    const ctx = {
      ...baseCtx(),
      runtimeInfo: {
        pid: 123,
        capabilities: {
          model: { id: 'deepseek-chat' },
          mcp: { status: 'available', configuredServers: 2, connectedServers: 2 },
          web: { status: 'available', provider: 'brave-search' },
          instructions: { status: 'available', lastSourceCount: 1 },
          skills: { status: 'available' },
          subagents: { status: 'available', enabled: true, maxParallel: 7 },
          attachments: { status: 'available' },
          memory: { status: 'available' }
        }
      },
      toolDiagnostics: {
        providers: [{ id: 'builtin' }, { id: 'mcp' }, { id: 'web' }, { id: 'memory' }],
        mcpServers: [{ id: 'github' }],
        instructions: { lastInjection: { sources: [{ scope: 'workspace', path: '/tmp/project/AGENTS.md' }] } },
        skills: { skills: [{ id: 'skill_docs' }] },
        attachments: { count: 1 }
      },
      memoryRecords: [
        {
          id: 'mem_1',
          content: 'Prefer pnpm for this workspace',
          scope: 'workspace',
          tags: ['tooling'],
          disabledAt: '2026-06-21T01:00:00.000Z'
        }
      ]
    }

    const html = allAgentPanels(ctx)

    expect(html).toContain('Kun diagnostics')
    expect(html).toContain('MCP')
    expect(html).toContain('available')
    expect(html).toContain('2/2')
    expect(html).toContain('brave-search')
    expect(html).toContain('7∥')
    expect(html).not.toContain('25 max')
    expect(html).toContain('Instructions')
    expect(html).toContain('AGENTS.md instructions')
    expect(html).toContain('Providers')
    expect(html).toContain('MCP servers')
    expect(html).toContain('Discovered Skills')
    expect(html).toContain('Prefer pnpm for this workspace')
    expect(html).toContain('mem_1')
    expect(html).toContain('aria-label="Restore"')
    expect(html).not.toContain('aria-label="Disable memory"')
    expect(html).toContain('Delete memory')
  })

  it('describes MCP config as an external-tool JSON file instead of model credentials', () => {
    const html = allAgentPanels(baseCtx())

    expect(html).toContain('External tool config path')
    expect(html).toContain('/tmp/project/.kun/mcp.json')
    expect(html).toContain('Model and API credentials do not live in this MCP file')
    expect(html).not.toContain('DeepSeek auth')
    expect(html).not.toContain('Base URL are stored in this file')
    expect(html).not.toContain('config.toml')
  })

  it('renders valid untrusted project config with redacted summaries and approval actions', () => {
    const html = allAgentPanels(baseCtx())

    expect(html).toContain('Project MCP &amp; Skills')
    expect(html).toContain('/tmp/project/.kun/project.json')
    expect(html).toContain('Valid configuration')
    expect(html).toContain('MCP not approved')
    expect(html).toContain('sha256:aaaaaaaaaaaa')
    expect(html).toContain('local')
    expect(html).toContain('node')
    expect(html).toContain('Save project config')
    expect(html).toContain('Approve project MCP')
    expect(html).not.toContain('GITHUB_TOKEN')
  })

  it('renders trusted, stale, invalid, and missing-workspace project states', () => {
    const trusted = allAgentPanels({
      ...baseCtx(),
      projectConfig: { ...(baseCtx().projectConfig as object), trust: 'trusted' }
    })
    expect(trusted).toContain('MCP approved')
    expect(trusted).toContain('Revoke project MCP')

    const stale = allAgentPanels({
      ...baseCtx(),
      projectConfig: { ...(baseCtx().projectConfig as object), trust: 'stale' }
    })
    expect(stale).toContain('Approval stale')
    expect(stale).toContain('Reapprove project MCP')
    expect(stale).toContain('Revoke project MCP')

    const staleInvalid = allAgentPanels({
      ...baseCtx(),
      projectConfig: {
        ...(baseCtx().projectConfig as object),
        status: 'invalid',
        trust: 'stale',
        message: 'Project config is invalid'
      }
    })
    expect(staleInvalid).toContain('Revoke project MCP')
    expect(staleInvalid).toMatch(/Reapprove project MCP<\/button>/)
    expect(staleInvalid).toContain('disabled=""')

    const invalid = allAgentPanels({
      ...baseCtx(),
      projectConfig: {
        ...(baseCtx().projectConfig as object),
        status: 'invalid',
        trust: 'untrusted',
        message: 'Skill root escapes the workspace'
      }
    })
    expect(invalid).toContain('Invalid configuration')
    expect(invalid).toContain('Skill root escapes the workspace')
    expect(invalid).toMatch(/Approve project MCP<\/button>/)
    expect(invalid).toContain('disabled=""')

    const missingWorkspace = allAgentPanels({ ...baseCtx(), activeProjectWorkspaceRoot: '' })
    expect(missingWorkspace).toContain('Select a workspace first')
    expect(missingWorkspace).not.toContain('Save project config')
  })

  it('renders Skill and MCP permission-source previews without exposing secret values', () => {
    const ctx = {
      ...baseCtx(),
      form: {
        claw: { skills: { extraDirs: ['/tmp/project/.agents/skills'] } },
        disabledSkillIds: ['legacy-skill']
      },
      skillRoots: [
        {
          id: 'workspace-agents',
          disableKey: 'workspace-agents',
          path: '/repo/.agents/skills',
          scope: 'project',
          source: 'common',
          exists: true,
          enabled: true,
          skillCount: 2
        },
        {
          id: 'global-kun',
          disableKey: 'global-kun',
          path: '/home/me/.kun/skills',
          scope: 'global',
          source: 'common',
          exists: true,
          enabled: true,
          skillCount: 1
        },
        {
          id: 'disabled-extra',
          disableKey: 'disabled-extra',
          path: '/tmp/disabled-skills',
          scope: 'global',
          source: 'extra',
          exists: true,
          enabled: false,
          skillCount: 1
        }
      ],
      mcpConfigText: JSON.stringify({
        servers: {
          github: {
            transport: 'stdio',
            command: 'npx',
            env: { GITHUB_TOKEN: '' },
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/repo']
          },
          docs: {
            transport: 'streamable-http',
            url: 'https://mcp.example.com',
            workspaceRoots: ['/repo/docs'],
            headers: { Authorization: '' },
            trustScope: 'user'
          },
          disabled: {
            transport: 'sse',
            url: 'https://disabled.example.com',
            enabled: false
          }
        }
      })
    }

    const html = allAgentPanels(ctx)

    expect(html).toContain('Skill permission sources')
    expect(html).toContain('Enabled roots')
    expect(html).toContain('Disabled roots')
    expect(html).toContain('Workspace roots')
    expect(html).toContain('Global roots')
    expect(html).toContain('Blocked skills')
    expect(html).toContain('External tool permission sources')
    expect(html).toContain('Enabled servers')
    expect(html).toContain('Disabled servers')
    expect(html).toContain('All-workspace scope')
    expect(html).toContain('Workspace scope')
    expect(html).toContain('Workspace-visible only')
    expect(html).toContain('Local commands')
    expect(html).toContain('HTTP/SSE servers')
    expect(html).toContain('Uses env')
    expect(html).toContain('Uses headers')
    expect(html).toContain('Secret values stay hidden here')
  })

  it('defines the LiteLLM provider preset for the Providers menu', () => {
    const litellm = getModelProviderPreset('litellm')
    expect(litellm && modelProviderPresetProfile(litellm)).toMatchObject({
      id: 'litellm',
      name: 'LiteLLM',
      baseUrl: 'http://localhost:4000',
      endpointFormat: 'chat_completions'
    })
  })

  it('defines OpenAI-compatible provider presets for the Providers menu', () => {
    const expected = [
      ['longcat', 'LongCat', 'https://api.longcat.chat/openai'],
      ['zhipu-coding-plan', 'Zhipu Coding Plan', 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', 'custom_endpoint'],
      ['zai-coding-plan', 'Z.ai Coding Plan', 'https://api.z.ai/api/coding/paas/v4/chat/completions', 'custom_endpoint'],
      ['kimi-code', 'Kimi Code', 'https://api.kimi.com/coding/v1'],
      ['volcengine', 'Volcano Ark API', 'https://ark.cn-beijing.volces.com/api/v3'],
      ['volcengine-agent-plan', 'Volcano Ark Agent Plan', 'https://ark.cn-beijing.volces.com/api/plan/v3'],
      ['volcengine-coding-plan', 'Volcano Ark Coding Plan', 'https://ark.cn-beijing.volces.com/api/coding/v3'],
      ['moonshot-cn', 'Moonshot CN', 'https://api.moonshot.cn/v1'],
      ['moonshot-global', 'Moonshot Global', 'https://api.moonshot.ai/v1']
    ] as const

    for (const [id, name, baseUrl, endpointFormat = 'chat_completions'] of expected) {
      const preset = getModelProviderPreset(id)
      expect(preset && modelProviderPresetProfile(preset)).toMatchObject({
        id,
        name,
        baseUrl,
        endpointFormat
      })
    }
  })
})
