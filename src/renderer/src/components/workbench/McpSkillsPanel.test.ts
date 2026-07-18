import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '@shared/app-settings'
import type { KunGuiApi, KunProjectConfigFileResult } from '@shared/kun-gui-api'
import i18n from '../../i18n'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { McpSkillsPanel } from './McpSkillsPanel'

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('')
}

function buttonWithText(root: ReactTestInstance, text: string): ReactTestInstance {
  return root.find((node) => node.type === 'button' && textContent(node) === text)
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('McpSkillsPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('saves project MCP drafts, switches to global Skills, and opens detailed settings', async () => {
    const projectContent = JSON.stringify({
      version: 1,
      mcp: { servers: { 'project-server': { transport: 'stdio', command: 'project-mcp', enabled: true } } },
      skills: { enabled: true, includeConventional: true, roots: [], disabledIds: [] }
    }, null, 2)
    const projectResult: KunProjectConfigFileResult = {
      workspaceRoot: '/workspace/project',
      path: '/workspace/project/.kun/project.json',
      content: projectContent,
      exists: true,
      status: 'valid',
      trust: 'trusted',
      digest: 'a'.repeat(64),
      serverSummaries: [{ id: 'project-server', transport: 'stdio', target: 'project-mcp', enabled: true }],
      skillRootCount: 0,
      disabledSkillCount: 0
    }
    const setProjectConfig = vi.fn(async (_workspaceRoot: string, content: string) => ({
      ...projectResult,
      content,
      trust: 'stale' as const
    }))
    const setGlobalConfig = vi.fn(async () => ({ ok: true as const, path: '/home/user/.kun/mcp.json' }))
    const setSettings = vi.spyOn(rendererRuntimeClient, 'setSettings').mockResolvedValue({
      disabledSkillIds: ['global-skill']
    } as unknown as AppSettingsV1)
    vi.spyOn(rendererRuntimeClient, 'getSettings').mockResolvedValue({
      disabledSkillIds: []
    } as unknown as AppSettingsV1)

    const kunGui = {
      getKunConfigFile: vi.fn(async () => ({
        path: '/home/user/.kun/mcp.json',
        content: '{"servers":{"global-server":{"command":"global-mcp"}}}',
        exists: true
      })),
      setKunConfigFile: setGlobalConfig,
      listSkills: vi.fn(async () => ({
        ok: true as const,
        skills: [{
          id: 'global-skill',
          name: 'Global Skill',
          description: 'Global helper',
          root: '/home/user/.codex/skills/global-skill',
          entryPath: '/home/user/.codex/skills/global-skill/SKILL.md',
          scope: 'global' as const,
          legacy: true
        }],
        validationErrors: []
      })),
      getKunProjectConfigFile: vi.fn(async () => projectResult),
      setKunProjectConfigFile: setProjectConfig,
      openKunProjectConfigDir: vi.fn(async () => ({ ok: true as const })),
      openKunConfigDir: vi.fn(async () => ({ ok: true as const }))
    } as unknown as KunGuiApi
    vi.stubGlobal('window', { kunGui })

    const onOpenSettings = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(McpSkillsPanel, {
        workspaceRoot: '/workspace/project',
        onOpenSettings
      }))
    })
    await flushEffects()

    const projectSwitch = renderer.root.findByProps({ 'aria-label': 'Toggle project-server' })
    expect(projectSwitch.props['aria-checked']).toBe(true)
    act(() => projectSwitch.props.onClick())
    act(() => buttonWithText(renderer.root, 'Save changes').props.onClick())
    await vi.waitFor(() => expect(setProjectConfig).toHaveBeenCalledTimes(1))
    const savedProject = JSON.parse(setProjectConfig.mock.calls[0]![1]) as {
      mcp: { servers: Record<string, { enabled: boolean }> }
    }
    expect(savedProject.mcp.servers['project-server']?.enabled).toBe(false)
    expect(setGlobalConfig).not.toHaveBeenCalled()

    act(() => buttonWithText(renderer.root, 'Global').props.onClick())
    act(() => buttonWithText(renderer.root, 'Skills1').props.onClick())
    const globalSkillSwitch = renderer.root.findByProps({ 'aria-label': 'Toggle Global Skill' })
    act(() => globalSkillSwitch.props.onClick())
    act(() => buttonWithText(renderer.root, 'Save changes').props.onClick())
    await vi.waitFor(() => expect(setSettings).toHaveBeenCalledWith({ disabledSkillIds: ['global-skill'] }))

    act(() => buttonWithText(renderer.root, 'Manage Skills').props.onClick())
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    act(() => renderer.unmount())
  })
})
