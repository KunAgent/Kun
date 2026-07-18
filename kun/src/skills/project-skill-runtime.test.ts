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

  it('keeps global Skills when project-local Skills are disabled', async () => {
    await writeSkill(join(workspace, '.kun', 'skills'), 'local', 'local instructions')
    await writeSkill(globalRoot, 'global', 'global instructions')
    await writeProjectConfig({ skills: { enabled: false } })
    const runtime = await createRuntime()

    await expect(runtime.availableSkillIdsForWorkspace(workspace)).resolves.toEqual(['global'])
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
