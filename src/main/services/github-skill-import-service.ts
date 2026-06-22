import { importSkillsFromGitHub } from '../../shared/github-skill-import'
import { saveGuiSkillPackage } from './skill-save-service'
import type { SkillGithubImportResult } from '../../shared/kun-gui-api'

export async function importGithubSkillsToRoot(input: {
  rootPath: string
  url: string
}): Promise<SkillGithubImportResult> {
  try {
    const imported = await importSkillsFromGitHub(input.url)
    const paths: string[] = []
    for (const skill of imported) {
      const saved = await saveGuiSkillPackage({
        rootPath: input.rootPath,
        skillName: skill.dirName,
        content: skill.entryContent,
        manifestContent: `${JSON.stringify(skill.manifest, null, 2)}\n`
      })
      paths.push(saved.path)
    }
    return {
      ok: true,
      count: imported.length,
      names: imported.map((skill) => skill.manifest.name),
      paths
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
