import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LatexProject } from '../../../shared/latex-project'
import { LATEX_MANIFEST, listProjectFiles, projectFile } from './project'

export async function snapshotProject(project: LatexProject, destination?: string): Promise<string> {
  const hash = createHash('sha256').update(JSON.stringify({ main: project.config.mainFile, engine: project.config.engine }))
  for (const file of await listProjectFiles(project.rootPath)) {
    if (file === LATEX_MANIFEST || file === project.config.mainFile.replace(/\.(tex|ltx)$/i, '.pdf')) continue
    const path = await projectFile(project.rootPath, file)
    const before = await stat(path)
    const data = await readFile(path)
    const after = await stat(path)
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error('Project changed while taking a build snapshot. Please retry.')
    hash.update(file).update('\0').update(data).update('\0')
    if (destination) {
      const target = join(destination, file)
      await mkdir(dirname(target), { recursive: true })
      // Write the bytes that were hashed, avoiding a second read of a changing source.
      await writeFile(target, data)
    }
  }
  const sourceHash = hash.digest('hex')
  if (destination && await snapshotProject(project) !== sourceHash) throw new Error('Project changed while taking a build snapshot. Please retry.')
  return sourceHash
}
