import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expandHomePath, normalizeSkillFolderName } from './workspace-paths'

export type SaveGuiSkillPackageInput = {
  rootPath: string
  skillName: string
  content: string
  manifestContent?: string
}

export async function saveGuiSkillPackage(input: SaveGuiSkillPackageInput): Promise<{ path: string }> {
  const rootPath = expandHomePath(input.rootPath)
  if (!rootPath) throw new Error('Skill directory is required.')
  const skillName = normalizeSkillFolderName(input.skillName)
  const skillDir = join(rootPath, skillName)
  const entryPath = join(skillDir, 'SKILL.md')
  await mkdir(skillDir, { recursive: true })
  if (input.manifestContent?.trim()) {
    await writeFile(join(skillDir, 'skill.json'), input.manifestContent, 'utf8')
  }
  await writeFile(entryPath, input.content, 'utf8')
  return { path: entryPath }
}
