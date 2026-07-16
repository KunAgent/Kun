import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveExpertPlugins } from './expert-plugin-resolver.js'

let tempRoot: string | undefined

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'expert-plugin-resolver-'))
})

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  }
})

describe('resolveExpertPlugins', () => {
  it('loads expert manifests and agent definitions from experts/plugins', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const pluginDir = join(tempRoot, 'zhihu-strategist')
    await mkdir(join(pluginDir, '.codebuddy-plugin'), { recursive: true })
    await mkdir(join(pluginDir, 'agents'), { recursive: true })
    await writeFile(join(pluginDir, '.codebuddy-plugin', 'plugin.json'), JSON.stringify({
      name: 'zhihu-strategist',
      version: '1.0.0',
      description: 'Zhihu strategy expert',
      expertType: 'agent',
      agentName: 'zhihu-strategist',
      displayName: { zh: '答有道', en: 'Gia' },
      profession: { zh: '知乎策略师', en: 'Zhihu Strategist' },
      displayDescription: { zh: '精通知乎推荐机制', en: 'Expert in Zhihu recommendation' },
      defaultInitPrompt: { zh: '制定知乎内容策略', en: 'Develop Zhihu content strategy' },
      tags: [],
      quickPrompts: []
    }), 'utf8')
    await writeFile(join(pluginDir, 'agents', 'zhihu-strategist.md'), '你是知乎策略专家', 'utf8')

    const result = await resolveExpertPlugins([tempRoot])

    expect(result.validationErrors).toEqual([])
    expect(result.experts).toHaveLength(1)
    expect(result.experts[0]).toMatchObject({
      id: 'zhihu-strategist',
      displayName: '答有道',
      roleDefinition: '你是知乎策略专家'
    })
  })

  it('loads team manifests that include marketplace metadata', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const pluginDir = join(tempRoot, 'research-team')
    await mkdir(join(pluginDir, '.codebuddy-plugin'), { recursive: true })
    await mkdir(join(pluginDir, 'agents'), { recursive: true })
    await writeFile(join(pluginDir, '.codebuddy-plugin', 'plugin.json'), JSON.stringify({
      name: 'research-team',
      version: '1.0.0',
      description: 'Research team',
      author: { name: 'Marketplace' },
      license: 'MIT',
      expertType: 'team',
      agentName: 'research-lead',
      teamInfo: {
        leadAgent: 'research-lead',
        memberAgents: ['analyst']
      },
      agents: [
        './agents/research-lead.md',
        './agents/analyst.md'
      ],
      skills: ['./skills/research'],
      displayName: { zh: 'Research Team', en: 'Research Team' },
      profession: { zh: 'Research Team', en: 'Research Team' },
      displayDescription: { zh: 'Team description', en: 'Team description' },
      defaultInitPrompt: { zh: 'Start research', en: 'Start research' },
      tags: [{ zh: 'Research', en: 'Research' }],
      quickPrompts: [],
      members: [
        { id: 'research-lead', role: 'lead' },
        { id: 'analyst', role: 'member' }
      ]
    }), 'utf8')
    await writeFile(join(pluginDir, 'agents', 'research-lead.md'), 'Lead role', 'utf8')
    await writeFile(join(pluginDir, 'agents', 'analyst.md'), 'Analyst role', 'utf8')

    const result = await resolveExpertPlugins([tempRoot])

    expect(result.validationErrors).toEqual([])
    expect(result.teams).toHaveLength(1)
    expect(result.teams[0]).toMatchObject({
      id: 'research-team',
      displayName: 'Research Team',
      members: [
        { agentName: 'research-lead', roleDefinition: 'Lead role' },
        { agentName: 'analyst', roleDefinition: 'Analyst role' }
      ]
    })
  })
})
