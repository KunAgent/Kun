import { describe, expect, it } from 'vitest'
import type { SkillRootListItem } from '@shared/kun-gui-api'
import {
  buildMcpConfig,
  buildRemoteMcpConfig,
  customMcpConfigFragment,
  isAllowedDocsUrl,
  isHttpsUrl,
  mcpConfigHasServer,
  mcpConfigHasServers,
  mcpMarketplaceItemsFromConfigAndDiagnostics,
  mergeMcpJsonConfig,
  recommendedMarketplaceItemIds,
  setMcpServerEnabled,
  skillMarketplaceItemsFromDiscoveredSkills,
  skillRootOptionsFromRoots
} from './PluginMarketplaceView'

describe('PluginMarketplaceView MCP config helpers', () => {
  it('does not recommend the filesystem MCP server because Kun has built-in file tools', () => {
    expect(recommendedMarketplaceItemIds()).not.toContain('filesystem')
  })

  it('recommends mainstream MCP servers for reasoning, memory, and web search', () => {
    expect(recommendedMarketplaceItemIds()).toEqual(expect.arrayContaining([
      'sequential-thinking',
      'memory',
      'brave-search',
      'vercel',
      'google-workspace'
    ]))
  })

  it('builds remote OAuth MCP server config using Kun-supported transport fields', () => {
    const config = buildRemoteMcpConfig({
      vercel: 'https://mcp.vercel.com',
      google_drive: 'https://drivemcp.googleapis.com/mcp/v1',
      google_calendar: 'https://calendarmcp.googleapis.com/mcp/v1'
    })

    expect(config).toEqual({
      servers: {
        vercel: expect.objectContaining({
          enabled: true,
          transport: 'streamable-http',
          url: 'https://mcp.vercel.com',
          trustScope: 'user'
        }),
        google_drive: expect.objectContaining({
          enabled: true,
          transport: 'streamable-http',
          url: 'https://drivemcp.googleapis.com/mcp/v1',
          trustScope: 'user'
        }),
        google_calendar: expect.objectContaining({
          enabled: true,
          transport: 'streamable-http',
          url: 'https://calendarmcp.googleapis.com/mcp/v1',
          trustScope: 'user'
        })
      }
    })
  })

  it('rejects non-https remote MCP server URLs', () => {
    expect(() => buildRemoteMcpConfig({ evil: 'http://mcp.vercel.com' })).toThrow(/https/i)
    expect(() => buildRemoteMcpConfig({ evil: 'file:///etc/passwd' })).toThrow(/https/i)
    expect(() => buildRemoteMcpConfig({ evil: 'javascript:alert(1)' })).toThrow(/https/i)
    expect(() => buildRemoteMcpConfig({ evil: 'not a url' })).toThrow(/https/i)
    expect(() => buildRemoteMcpConfig({ evil: '' })).toThrow(/https/i)
  })

  it('still accepts valid https remote MCP server URLs', () => {
    expect(() => buildRemoteMcpConfig({ vercel: 'https://mcp.vercel.com' })).not.toThrow()
  })

  it('merges recommended MCP servers into JSON config without dropping existing fields', () => {
    const existing = JSON.stringify({
      timeouts: { read_timeout: 120 },
      servers: {
        gui_schedule: { command: '/Applications/DeepSeek GUI.app' }
      }
    })

    const merged = mergeMcpJsonConfig(
      existing,
      buildMcpConfig('playwright', 'npx', ['-y', '@playwright/mcp@latest'])
    )
    const parsed = JSON.parse(merged.text) as Record<string, any>

    expect(merged.alreadyExists).toBe(false)
    expect(parsed.timeouts).toEqual({ read_timeout: 120 })
    expect(parsed.servers.gui_schedule).toEqual({ command: '/Applications/DeepSeek GUI.app' })
    expect(parsed.servers.playwright).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      trustScope: 'user'
    })
    expect(mcpConfigHasServer(merged.text, 'playwright')).toBe(true)
  })

  it('detects duplicate MCP servers instead of appending old-style snippets', () => {
    const fragment = buildMcpConfig('context7', 'npx', ['-y', '@upstash/context7-mcp@latest'])
    const first = mergeMcpJsonConfig('', fragment)
    const second = mergeMcpJsonConfig(first.text, fragment)

    expect(first.alreadyExists).toBe(false)
    expect(second.alreadyExists).toBe(true)
    expect(JSON.parse(second.text).servers.context7).toMatchObject({ command: 'npx' })
  })

  it('accepts custom JSON as either a single server or a Kun config fragment', () => {
    expect(customMcpConfigFragment(
      'docs',
      '{"transport":"stdio","command":"npx","args":["-y","docs-mcp"]}',
      {}
    )).toEqual({
      servers: {
        docs: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'docs-mcp']
        }
      }
    })

    expect(customMcpConfigFragment(
      'github',
      '{"capabilities":{"mcp":{"servers":{"github":{"transport":"stdio","command":"github-mcp"}}}}}',
      {}
    )).toEqual({
      servers: {
        github: {
          transport: 'stdio',
          command: 'github-mcp'
        }
      }
    })
  })

  it('detects MCP servers from full Kun capability config', () => {
    const content = JSON.stringify({
      capabilities: {
        mcp: {
          servers: {
            github: {
              transport: 'stdio',
              command: 'github-mcp'
            }
          }
        }
      }
    })

    expect(mcpConfigHasServer(content, 'github')).toBe(true)
  })

  it('detects all servers required by a multi-server connector', () => {
    const content = JSON.stringify({
      servers: {
        google_gmail: { transport: 'streamable-http', url: 'https://gmailmcp.googleapis.com/mcp/v1' },
        google_drive: { transport: 'streamable-http', url: 'https://drivemcp.googleapis.com/mcp/v1' },
        google_calendar: { transport: 'streamable-http', url: 'https://calendarmcp.googleapis.com/mcp/v1' },
        google_people: { transport: 'streamable-http', url: 'https://people.googleapis.com/mcp/v1' },
        google_chat: { transport: 'streamable-http', url: 'https://chatmcp.googleapis.com/mcp/v1' }
      }
    })

    expect(mcpConfigHasServers(content, [
      'google_gmail',
      'google_drive',
      'google_calendar',
      'google_people',
      'google_chat'
    ])).toBe(true)
    expect(mcpConfigHasServers(content, ['google_gmail', 'google_drive', 'google_tasks'])).toBe(false)
  })

  it('turns configured MCP servers into personal marketplace items', () => {
    const items = mcpMarketplaceItemsFromConfigAndDiagnostics(
      '{"servers":{"docs":{"transport":"stdio","command":"docs-mcp"}}}',
      null,
      {
        configured: 'Configured',
        connected: 'Connected',
        error: 'Error',
        disabled: 'Disabled'
      }
    )

    expect(items).toEqual([
      expect.objectContaining({
        id: 'docs',
        kind: 'mcp',
        group: 'personal',
        title: 'docs',
        description: expect.stringContaining('docs-mcp'),
        sourceLabel: 'Configured',
        statusTone: 'default'
      })
    ])
  })

  it('overlays MCP runtime diagnostics onto configured marketplace items', () => {
    const items = mcpMarketplaceItemsFromConfigAndDiagnostics(
      JSON.stringify({
        servers: {
          github: {
            transport: 'stdio',
            command: 'github-mcp'
          },
          disabled_docs: {
            transport: 'stdio',
            command: 'docs-mcp',
            enabled: false
          }
        }
      }),
      {
        mcpServers: [
          { id: 'github', status: 'connected', toolCount: 12 },
          { id: 'bad', status: 'error', lastError: 'missing token' }
        ]
      },
      {
        configured: 'Configured',
        connected: 'Connected',
        error: 'Error',
        disabled: 'Disabled'
      }
    )

    expect(items).toEqual([
      expect.objectContaining({
        id: 'bad',
        sourceLabel: 'Error',
        statusTone: 'error',
        description: expect.stringContaining('missing token')
      }),
      expect.objectContaining({
        id: 'disabled_docs',
        sourceLabel: 'Disabled',
        statusTone: 'warning'
      }),
      expect.objectContaining({
        id: 'github',
        sourceLabel: 'Connected',
        statusTone: 'success',
        descriptionKey: 'pluginMcpGithubDesc',
        detail: expect.stringContaining('github-mcp')
      })
    ])
  })

  it('toggles top-level MCP servers without dropping config fields', () => {
    const disabled = setMcpServerEnabled(JSON.stringify({
      timeouts: { read_timeout: 120 },
      servers: {
        docs: {
          transport: 'stdio',
          command: 'docs-mcp',
          args: ['--stdio']
        }
      }
    }), 'docs', false)
    const disabledParsed = JSON.parse(disabled) as Record<string, any>

    expect(disabledParsed.timeouts).toEqual({ read_timeout: 120 })
    expect(disabledParsed.servers.docs).toMatchObject({
      transport: 'stdio',
      command: 'docs-mcp',
      args: ['--stdio'],
      enabled: false
    })

    const enabled = setMcpServerEnabled(disabled, 'docs', true)
    const enabledParsed = JSON.parse(enabled) as Record<string, any>
    expect(enabledParsed.servers.docs.enabled).toBe(true)
    expect(enabledParsed.servers.docs.command).toBe('docs-mcp')
  })

  it('toggles nested Kun capability MCP servers', () => {
    const text = setMcpServerEnabled(JSON.stringify({
      capabilities: {
        mcp: {
          enabled: true,
          servers: {
            github: {
              transport: 'stdio',
              command: 'github-mcp',
              disabled: true
            }
          }
        }
      }
    }), 'github', true)
    const parsed = JSON.parse(text) as Record<string, any>

    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers.github).toMatchObject({
      transport: 'stdio',
      command: 'github-mcp',
      enabled: true
    })
    expect(parsed.capabilities.mcp.servers.github).not.toHaveProperty('disabled')
  })
})

describe('skillMarketplaceItemsFromDiscoveredSkills', () => {
  it('turns discovered project and global skills into personal marketplace items', () => {
    const items = skillMarketplaceItemsFromDiscoveredSkills([
      {
        id: 'openspec-apply-change',
        name: 'Openspec Apply Change',
        description: 'Implement tasks from an OpenSpec change.',
        root: '/workspace/.codex/skills/openspec-apply-change',
        entryPath: '/workspace/.codex/skills/openspec-apply-change/SKILL.md',
        scope: 'project',
        legacy: true
      },
      {
        id: 'remotion-best-practices',
        name: 'Remotion Best Practices',
        description: 'Best practices for Remotion.',
        root: '/Users/demo/.agents/skills/remotion-best-practices',
        entryPath: '/Users/demo/.agents/skills/remotion-best-practices/SKILL.md',
        scope: 'global',
        legacy: true
      }
    ], { project: 'Project', global: 'Global' })

    expect(items).toEqual([
      expect.objectContaining({
        id: 'openspec-apply-change',
        group: 'personal',
        title: 'Openspec Apply Change',
        sourceLabel: 'Project'
      }),
      expect.objectContaining({
        id: 'remotion-best-practices',
        group: 'personal',
        title: 'Remotion Best Practices',
        sourceLabel: 'Global'
      })
    ])
  })
})

describe('skillRootOptionsFromRoots', () => {
  const roots: SkillRootListItem[] = [
    {
      id: 'workspace-claude',
      disableKey: 'workspace-claude',
      path: '/ws/.claude/skills',
      scope: 'project',
      source: 'common',
      labelKey: 'pluginSkillRootWorkspaceClaude',
      exists: true,
      enabled: true,
      skillCount: 2
    },
    {
      id: 'global-codex',
      disableKey: 'global-codex',
      path: '/home/me/.codex/skills',
      scope: 'global',
      source: 'common',
      labelKey: 'pluginSkillRootGlobalCodex',
      exists: false,
      enabled: false,
      skillCount: 0
    },
    {
      id: '/opt/team/skills',
      disableKey: '/opt/team/skills',
      path: '/opt/team/skills',
      scope: 'global',
      source: 'extra',
      exists: true,
      enabled: true,
      skillCount: 5
    }
  ]

  it('maps backend roots — common (.claude/.codex) and custom dirs — into picker options synced with settings', () => {
    const options = skillRootOptionsFromRoots(roots, (key) => `t:${key}`)

    expect(options).toEqual([
      { id: 'workspace-claude', label: 't:pluginSkillRootWorkspaceClaude', path: '/ws/.claude/skills', scope: 'project', enabled: true, exists: true, skillCount: 2 },
      { id: 'global-codex', label: 't:pluginSkillRootGlobalCodex', path: '/home/me/.codex/skills', scope: 'global', enabled: false, exists: false, skillCount: 0 },
      // Custom extra dir has no i18n labelKey, so it falls back to a short path label.
      { id: '/opt/team/skills', label: 'team/skills', path: '/opt/team/skills', scope: 'global', enabled: true, exists: true, skillCount: 5 }
    ])
  })

  it('returns an empty list when the backend reports no roots', () => {
    expect(skillRootOptionsFromRoots([], (key) => key)).toEqual([])
  })
})

describe('URL validation guards', () => {
  it('accepts only well-formed https URLs', () => {
    expect(isHttpsUrl('https://mcp.vercel.com')).toBe(true)
    expect(isHttpsUrl('https://developers.google.com/workspace')).toBe(true)
    expect(isHttpsUrl('http://mcp.vercel.com')).toBe(false)
    expect(isHttpsUrl('file:///etc/passwd')).toBe(false)
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpsUrl('ftp://example.com')).toBe(false)
    expect(isHttpsUrl('not a url')).toBe(false)
    expect(isHttpsUrl('')).toBe(false)
    expect(isHttpsUrl(undefined)).toBe(false)
    expect(isHttpsUrl(null)).toBe(false)
    expect(isHttpsUrl(42)).toBe(false)
  })

  it('opens docs only for allowlisted https origins', () => {
    expect(isAllowedDocsUrl('https://vercel.com/docs/agent-resources/vercel-mcp.md')).toBe(true)
    expect(isAllowedDocsUrl('https://developers.google.com/workspace/guides/configure-mcp-servers')).toBe(true)
    // Non-https schemes are rejected even on an allowlisted host.
    expect(isAllowedDocsUrl('http://vercel.com/docs')).toBe(false)
    // Off-allowlist origins are rejected even over https.
    expect(isAllowedDocsUrl('https://evil.example.com/docs')).toBe(false)
    expect(isAllowedDocsUrl('https://vercel.com.evil.example.com/docs')).toBe(false)
    expect(isAllowedDocsUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedDocsUrl('')).toBe(false)
    expect(isAllowedDocsUrl(undefined)).toBe(false)
  })
})
