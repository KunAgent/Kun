import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KunCapabilitiesConfig } from '../contracts/capabilities.js'
import { SkillRuntime } from './skill-runtime.js'

describe('SkillRuntime project config', () => {
  let root = ''
  let workspace = ''
  let globalRoot = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-project-skills-'))
    workspace = join(root, 'workspace')
    globalRoot = join(root, 'global-skills')
    await mkdir(join(workspace, '.kun'), { recursive: true })
    await mkdir(globalRoot)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('gives an explicit project root precedence over conventional and global duplicates', async () => {
    await writeSkill(join(workspace, 'custom-skills'), 'duplicate', 'explicit instructions')
    await writeSkill(join(workspace, '.kun', 'skills'), 'duplicate', 'conventional instructions')
    await writeSkill(globalRoot, 'duplicate', 'global instructions')
    await writeProjectConfig({ skills: { roots: ['custom-skills'] } })
    const runtime = await createRuntime()

    const loaded = await runtime.loadSkillById('duplicate', workspace)

    expect(loaded).toMatchObject({ skillId: 'duplicate' })
    expect('instruction' in loaded ? loaded.instruction : '').toContain('explicit instructions')
  })

  it('can suppress conventional roots while retaining explicit and global Skills', async () => {
    await writeSkill(join(workspace, 'custom-skills'), 'explicit', 'explicit instructions')
    await writeSkill(join(workspace, '.kun', 'skills'), 'conventional', 'conventional instructions')
    await writeSkill(globalRoot, 'global', 'global instructions')
    await writeProjectConfig({
      skills: { roots: ['custom-skills'], includeConventional: false }
    })
    const runtime = await createRuntime()

    await expect(runtime.availableSkillIdsForWorkspace(workspace)).resolves.toEqual(['explicit', 'global'])
  })

  it('does not mistake an explicitly configured workspace root for a conventional root', async () => {
    const configuredRoot = join(workspace, 'tools', 'skills')
    await writeSkill(configuredRoot, 'configured', 'configured instructions')
    await writeSkill(join(workspace, 'skills'), 'conventional', 'conventional instructions')
    await writeSkill(globalRoot, 'global', 'global instructions')
    await writeProjectConfig({ skills: { includeConventional: false } })
    const config = KunCapabilitiesConfig.parse({
      skills: {
        enabled: true,
        projectConfigEnabled: true,
        roots: [configuredRoot],
        workspaceRoots: [workspace],
        globalRoots: [globalRoot]
      }
    })
    const runtime = await SkillRuntime.create(config.skills)

    await expect(runtime.availableSkillIdsForWorkspace(workspace)).resolves.toEqual([
      'configured',
      'global'
    ])
  })

  it('applies project disabledIds to both project and global Skills', async () => {
    await writeSkill(join(workspace, '.kun', 'skills'), 'local-blocked', 'local instructions')
    await writeSkill(globalRoot, 'global-blocked', 'global instructions')
    await writeProjectConfig({
      skills: { disabledIds: ['LOCAL-BLOCKED', 'skill:global-blocked'] }
    })
    const runtime = await createRuntime()

    await expect(runtime.availableSkillIdsForWorkspace(workspace)).resolves.toEqual(['global'])
    await expect(runtime.loadSkillById('global-blocked', workspace)).resolves.toMatchObject({
      error: expect.stringContaining('unknown skill id')
    })
  })

  it('applies runtime disabledIds to workspace-discovered Skills', async () => {
    await writeSkill(join(workspace, '.kun', 'skills'), 'ppt-master', 'retired instructions')
    await writeSkill(join(workspace, '.kun', 'skills'), 'available', 'available instructions')
    await writeSkill(globalRoot, 'global', 'global instructions')
    const config = KunCapabilitiesConfig.parse({
      skills: {
        enabled: true,
        projectConfigEnabled: true,
        roots: [],
        workspaceRoots: [],
        globalRoots: [globalRoot],
        disabledIds: ['ppt-master']
      }
    })
    const runtime = await SkillRuntime.create(config.skills)

    await expect(runtime.availableSkillIdsForWorkspace(workspace)).resolves.toEqual([
      'available',
      'global'
    ])
    await expect(runtime.loadSkillById('ppt-master', workspace)).resolves.toMatchObject({
      error: expect.stringContaining('unknown skill id')
    })
  })

  it('keeps global Skills when project-local Skills are disabled', async () => {
    await writeSkill(join(workspace, '.kun', 'skills'), 'local', 'local instructions')
    await writeSkill(globalRoot, 'global', 'global instructions')
    await writeProjectConfig({ skills: { enabled: false } })
    const runtime = await createRuntime()

    await expect(runtime.availableSkillIdsForWorkspace(workspace)).resolves.toEqual(['global'])
  })

  it('returns the workspace-visible catalog used by TUI skill browsing and autocomplete', async () => {
    await writeSkill(join(workspace, '.kun', 'skills'), 'local', 'local instructions')
    await writeProjectConfig({ skills: {} })
    const runtime = await createRuntime()

    const diagnostics = await runtime.diagnosticsForWorkspace(workspace)

    expect(diagnostics.skills.map((skill) => skill.id)).toEqual(['global', 'local'])
    expect(diagnostics.roots).toContain(join(workspace, '.kun', 'skills', 'local'))
    expect(diagnostics.globalRoots).toContain(join(globalRoot, 'global'))
  })

  it('invalidates the workspace cache when project policy changes', async () => {
    await writeSkill(join(workspace, 'first-skills'), 'first', 'first instructions')
    await writeSkill(join(workspace, 'second-skills'), 'second', 'second instructions')
    await writeProjectConfig({ skills: { roots: ['first-skills'], includeConventional: false } })
    const runtime = await createRuntime()

    await expect(runtime.availableSkillIdsForWorkspace(workspace)).resolves.toEqual(['first', 'global'])

    await writeProjectConfig({ skills: { roots: ['second-skills'], includeConventional: false } })

    await expect(runtime.availableSkillIdsForWorkspace(workspace)).resolves.toEqual(['global', 'second'])
  })

  it('surfaces invalid project config without breaking existing conventional discovery', async () => {
    await writeSkill(join(workspace, '.kun', 'skills'), 'local', 'local instructions')
    await writeFile(join(workspace, '.kun', 'project.json'), JSON.stringify({
      version: 1,
      skills: { roots: ['../escape'] }
    }))
    const runtime = await createRuntime()

    await expect(runtime.availableSkillIdsForWorkspace(workspace)).resolves.toEqual(['global', 'local'])
    const realWorkspace = await realpath(workspace)
    expect(runtime.diagnostics().validationErrors).toEqual([
      expect.objectContaining({
        root: join(realWorkspace, '.kun', 'project.json'),
        message: expect.stringContaining('escapes the workspace')
      })
    ])
  })

  it('loads configured project Skills even when the global Skill capability has no roots', async () => {
    await writeSkill(join(workspace, '.kun', 'skills'), 'project-only', 'project instructions')
    await writeProjectConfig({ skills: {} })
    const config = KunCapabilitiesConfig.parse({
      skills: {
        enabled: false,
        projectConfigEnabled: true,
        roots: [],
        workspaceRoots: [],
        globalRoots: []
      }
    })
    const runtime = await SkillRuntime.create(config.skills)

    await expect(runtime.availableSkillIdsForWorkspace(workspace)).resolves.toEqual(['project-only'])
  })

  it('loads only declared Skill assets with bounded line pagination', async () => {
    const skillRoot = join(workspace, '.kun', 'skills')
    const skillDir = join(skillRoot, 'diagram')
    await mkdir(join(skillDir, 'references'), { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), 'diagram instructions')
    await writeFile(join(skillDir, 'references', 'flow.md'), 'one\ntwo\nthree\nfour')
    await writeFile(join(skillDir, 'skill.json'), JSON.stringify({
      id: 'diagram',
      name: 'diagram',
      assets: ['references/flow.md'],
      triggers: { commands: ['/diagram'] }
    }))
    const runtime = await createRuntime()

    await expect(runtime.loadSkillAsset('diagram', 'references/flow.md', workspace, { limit: 2 }))
      .resolves.toEqual({
        skillId: 'diagram',
        path: 'references/flow.md',
        content: 'one\ntwo',
        offset: 0,
        nextOffset: 2,
        truncated: true
      })
    await expect(runtime.loadSkillAsset('diagram', 'references/missing.md', workspace))
      .resolves.toMatchObject({ error: expect.stringContaining('not declared') })
    await expect(runtime.loadSkillAsset('diagram', '../SKILL.md', workspace))
      .resolves.toMatchObject({ error: expect.stringContaining('without traversal') })
    await expect(runtime.loadSkillAsset('diagram', 'references/flow.md', workspace, {}, undefined, ['global']))
      .resolves.toMatchObject({ error: expect.stringContaining('unknown skill') })
  })

  it('enforces a delegated skill allow-list for discovery, activation, and load_skill', async () => {
    await writeSkill(join(workspace, '.kun', 'skills'), 'allowed', 'allowed instructions')
    await writeSkill(join(workspace, '.kun', 'skills'), 'later-added', 'must stay hidden')
    const runtime = await createRuntime()

    await expect(runtime.availableSkillIdsForWorkspace(
      workspace,
      undefined,
      ['allowed']
    )).resolves.toEqual(['allowed'])
    await expect(runtime.resolveTurn({
      prompt: '/later-added',
      workspace,
      allowedSkillIds: ['allowed']
    })).resolves.toMatchObject({ activeSkillIds: [] })
    await expect(runtime.loadSkillById(
      'later-added',
      workspace,
      undefined,
      undefined,
      ['allowed']
    )).resolves.toMatchObject({ error: expect.stringContaining('unknown skill id') })
  })

  async function createRuntime(): Promise<SkillRuntime> {
    await writeSkill(globalRoot, 'global', 'global instructions')
    const config = KunCapabilitiesConfig.parse({
      skills: {
        enabled: true,
        projectConfigEnabled: true,
        roots: [],
        workspaceRoots: [],
        globalRoots: [globalRoot],
        legacySkillMd: true
      }
    })
    return SkillRuntime.create(config.skills)
  }

  async function writeProjectConfig(value: Record<string, unknown>): Promise<void> {
    await writeFile(join(workspace, '.kun', 'project.json'), JSON.stringify({
      version: 1,
      ...value
    }))
  }
})

async function writeSkill(root: string, id: string, instruction: string): Promise<void> {
  const skillDir = join(root, id)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'skill.json'), JSON.stringify({
    id,
    name: id,
    triggers: { commands: [`/${id}`] }
  }))
  await writeFile(join(skillDir, 'SKILL.md'), instruction)
}
