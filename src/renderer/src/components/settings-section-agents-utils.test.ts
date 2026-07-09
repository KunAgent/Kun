import { describe, expect, it } from 'vitest'
import type { SkillRootListItem } from '@shared/kun-gui-api'
import {
  compactList,
  modelContextProfileSummary,
  skillRootShortLabel,
  summarizeMcpPermissionSources,
  summarizeSkillPermissionSources
} from './settings-section-agents-utils'

describe('settings-section-agents-utils', () => {
  it('summarizes skill permission sources by enabled root scope and disabled ids', () => {
    const roots: SkillRootListItem[] = [
      root({ id: 'workspace', scope: 'project', enabled: true }),
      root({ id: 'global', scope: 'global', enabled: true }),
      root({ id: 'disabled', scope: 'project', enabled: false })
    ]

    expect(summarizeSkillPermissionSources(roots, ['a', 'b'])).toEqual({
      enabledRoots: 2,
      disabledRoots: 1,
      workspaceRoots: 1,
      globalRoots: 1,
      disabledSkillIds: 2
    })
  })

  it('summarizes MCP permission sources from the editable config text', () => {
    const summary = summarizeMcpPermissionSources(JSON.stringify({
      servers: {
        local: {
          transport: 'stdio',
          command: 'node',
          env: { TOKEN: 'secret' },
          trustScope: 'workspace',
          workspaceRoots: ['/repo']
        },
        remote: {
          transport: 'streamable-http',
          url: 'https://example.test/mcp',
          headers: { Authorization: 'Bearer secret' },
          trustScope: 'user'
        },
        off: { enabled: false, transport: 'stdio', command: 'node' }
      }
    }))

    expect(summary).toMatchObject({
      parseError: null,
      enabledServers: 2,
      disabledServers: 1,
      userScopeServers: 1,
      workspaceScopeServers: 1,
      workspaceVisibleServers: 1,
      localServers: 1,
      remoteServers: 1,
      envServers: 1,
      headerServers: 1
    })
  })

  it('returns parse errors without reporting stale MCP counts', () => {
    expect(summarizeMcpPermissionSources('{broken')).toMatchObject({
      parseError: expect.any(String),
      enabledServers: 0,
      remoteServers: 0
    })
  })

  it('uses built-in DeepSeek context labels only for known model ids', () => {
    expect(modelContextProfileSummary({
      model: 'provider/deepseek-v4-pro',
      fallbackSoftThreshold: 10,
      fallbackHardThreshold: 20
    })).toMatchObject({
      modelLabel: 'deepseek-v4-pro',
      contextWindowLabel: '1,000,000',
      sourceLabelKey: 'kunModelContextSourceBuiltIn'
    })

    expect(modelContextProfileSummary({
      model: 'custom-model',
      fallbackSoftThreshold: 10,
      fallbackHardThreshold: 20
    })).toEqual({
      modelLabel: 'custom-model',
      contextWindowLabel: 'models.profiles',
      softThresholdLabel: '10',
      hardThresholdLabel: '20',
      sourceLabelKey: 'kunModelContextSourceFallback'
    })
  })

  it('formats compact labels without leaking long lists into settings cards', () => {
    expect(skillRootShortLabel('C:\\Users\\me\\.kun\\skills')).toBe('.kun/skills')
    expect(compactList(['one', 'two', 'three', 'four', 'five'], 'empty')).toBe('one, two, three, four')
    expect(compactList([], 'empty')).toBe('empty')
  })
})

function root(patch: Partial<SkillRootListItem>): SkillRootListItem {
  return {
    id: patch.id ?? 'root',
    disableKey: `${patch.id ?? 'root'}:disable`,
    path: patch.path ?? '/repo/.kun/skills',
    scope: patch.scope ?? 'project',
    source: patch.source ?? 'extra',
    exists: patch.exists ?? true,
    enabled: patch.enabled ?? true,
    skillCount: patch.skillCount ?? 0
  }
}
