import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveGuiSkillPackage } from './skill-save-service'

describe('saveGuiSkillPackage', () => {
  let tempRoot = ''

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'skill-save-'))
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('writes a legacy skill entry when no manifest is provided', async () => {
    const result = await saveGuiSkillPackage({
      rootPath: tempRoot,
      skillName: 'review',
      content: '# Review\n'
    })

    expect(result.path).toBe(join(tempRoot, 'review', 'SKILL.md'))
    await expect(readFile(result.path, 'utf8')).resolves.toBe('# Review\n')
  })

  it('writes skill.json alongside SKILL.md for modern imported skills', async () => {
    const result = await saveGuiSkillPackage({
      rootPath: tempRoot,
      skillName: 'debug',
      content: '# Debug\n',
      manifestContent: JSON.stringify({ name: 'Debug', entry: 'SKILL.md' }, null, 2)
    })

    await expect(readFile(result.path, 'utf8')).resolves.toBe('# Debug\n')
    await expect(readFile(join(tempRoot, 'debug', 'skill.json'), 'utf8')).resolves.toContain('"name": "Debug"')
  })

  it('rejects path separators in the requested skill name', async () => {
    await mkdir(join(tempRoot, 'skills'), { recursive: true })
    await expect(saveGuiSkillPackage({
      rootPath: tempRoot,
      skillName: '../escape',
      content: '# Nope\n'
    })).rejects.toThrow('Skill name cannot contain path separators.')
  })
})
