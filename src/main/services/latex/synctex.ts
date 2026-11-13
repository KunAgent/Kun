import { dirname, join, relative, resolve } from 'node:path'
import type { LatexProject, LatexSyncPoint, KunGuiLatexApi } from '../../../shared/latex-project'
import type { LatexBuildService } from './build'
import { detectLatexTools } from './detect'
import { projectFile } from './project'
import { runLatexProcess } from './process'

export async function syncLatexSource(service: LatexBuildService, project: LatexProject,
  input: Parameters<KunGuiLatexApi['latexSync']>[0]): Promise<LatexSyncPoint | null> {
  const artifact = await service.artifact(project)
  if (!artifact || artifact.buildId !== input.buildId) return null
  const tools = await detectLatexTools(project.config.engine, project.config.toolDirectory, service.managedToolRoot)
  if (!tools.synctex) return null
  const forward = input.direction === 'forward'
  const file = input.file ?? project.config.mainFile
  await projectFile(project.rootPath, file)
  const args = forward
    ? ['view', '-i', `${input.line ?? 1}:1:${resolve(artifact.snapshotPath, file)}`, '-o', artifact.pdfPath]
    : ['edit', '-o', `${input.page ?? 1}:${input.x ?? 0}:${input.y ?? 0}:${artifact.pdfPath}`]
  const result = await runLatexProcess(tools.synctex, args, { cwd: artifact.snapshotPath, timeoutMs: 5000, idleMs: 5000 })
  if (result.code !== 0) return null
  const fields: Record<string, string> = {}
  for (const line of result.log.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon > 0 && fields[line.slice(0, colon)] === undefined) fields[line.slice(0, colon)] = line.slice(colon + 1)
  }
  const relativeFile = forward ? file : relative(artifact.snapshotPath, resolve(dirname(join(artifact.snapshotPath, project.config.mainFile)), fields.Input ?? '')).replaceAll('\\', '/')
  if (!project.files.includes(relativeFile)) return null
  const point = { file: relativeFile, line: Number(fields.Line ?? input.line ?? 1), page: Number(fields.Page ?? input.page ?? 1),
    x: Number(fields.h ?? fields.x ?? 0), y: Number(fields.v ?? fields.y ?? 0) }
  return Object.values(point).some((value) => typeof value === 'number' && !Number.isFinite(value)) ? null : point
}
