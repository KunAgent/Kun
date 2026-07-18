import { describe, expect, it } from 'vitest'
import type { SkillListItem } from '@shared/kun-gui-api'
import {
  clampPage,
  filterMcpSkillsEntries,
  mcpEntriesFromConfig,
  pageEntries,
  paginationItems,
  projectDisabledSkillIds,
  setMcpEntryEnabled,
  setProjectSkillEnabled,
  skillEntries
} from './mcp-skills-panel-model'

describe('MCP and Skills panel model', () => {
  it('reads and toggles project and global MCP entries without exposing URL credentials', () => {
    const project = JSON.stringify({
      version: 1,
      mcp: {
        servers: {
          filesystem: { transport: 'stdio', command: 'npx', enabled: true },
          remote: { transport: 'streamable-http', url: 'https://user:secret@example.com/mcp?token=hidden' }
        }
      }
    })
    const entries = mcpEntriesFromConfig(project, 'project')

    expect(entries.map((entry) => entry.name)).toEqual(['filesystem', 'remote'])
    expect(entries[1]?.description).toBe('https://example.com/mcp')
    expect(entries[1]?.description).not.toContain('secret')
    expect(entries[1]?.description).not.toContain('hidden')

    const disabledProject = setMcpEntryEnabled(project, 'project', 'filesystem', false)
    expect(mcpEntriesFromConfig(disabledProject, 'project')[0]).toMatchObject({
      id: 'filesystem',
      enabled: false
    })

    const global = JSON.stringify({
      capabilities: { mcp: { servers: { github: { command: 'github-mcp', disabled: true } } } }
    })
    const enabledGlobal = setMcpEntryEnabled(global, 'global', 'github', true)
    expect(mcpEntriesFromConfig(enabledGlobal, 'global')).toEqual([
      expect.objectContaining({ id: 'github', enabled: true })
    ])
  })

  it('uses scoped disabled Skill ids and preserves project Skill policy fields', () => {
    const project = JSON.stringify({
      version: 1,
      skills: {
        enabled: true,
        includeConventional: false,
        roots: ['tools/skills'],
        disabledIds: ['alpha']
      }
    })
    const skills: SkillListItem[] = [
      { id: 'alpha', name: 'Alpha', root: '/project/.agents/skills/alpha', entryPath: '/a', scope: 'project', legacy: true },
      { id: 'beta', name: 'Beta', root: '/home/.codex/skills/beta', entryPath: '/b', scope: 'global', legacy: true }
    ]

    expect(skillEntries(skills, 'project', projectDisabledSkillIds(project))).toEqual([
      expect.objectContaining({ id: 'alpha', enabled: false, sourceScope: 'project' }),
      expect.objectContaining({ id: 'beta', enabled: true, sourceScope: 'global' })
    ])
    expect(skillEntries(skills, 'global', [])).toEqual([
      expect.objectContaining({ id: 'beta', sourceScope: 'global' })
    ])

    const enabled = JSON.parse(setProjectSkillEnabled(project, 'alpha', true)) as {
      skills: { includeConventional: boolean; roots: string[]; disabledIds: string[] }
    }
    expect(enabled.skills).toMatchObject({
      includeConventional: false,
      roots: ['tools/skills'],
      disabledIds: []
    })
  })

  it('searches, filters, and paginates a bounded result set', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      id: `server-${index + 1}`,
      name: index === 7 ? 'Playwright Browser' : `Server ${index + 1}`,
      description: index % 2 === 0 ? 'enabled command' : 'disabled command',
      enabled: index % 2 === 0,
      sourceScope: 'project' as const
    }))

    expect(filterMcpSkillsEntries(entries, 'playwright', 'all').map((entry) => entry.id)).toEqual(['server-8'])
    expect(filterMcpSkillsEntries(entries, '', 'disabled')).toHaveLength(6)
    expect(pageEntries(entries, 2).map((entry) => entry.id)).toEqual([
      'server-6', 'server-7', 'server-8', 'server-9', 'server-10'
    ])
    expect(clampPage(9, entries.length)).toBe(3)
    expect(paginationItems(5, 12)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 12])
  })
})
