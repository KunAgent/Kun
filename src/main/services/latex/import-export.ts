import JSZip from 'jszip'
import { Readable } from 'node:stream'
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { basename, join, extname } from 'node:path'
import type { LatexProject } from '../../../shared/latex-project'
import { LATEX_MANIFEST, MAX_PROJECT_BYTES, listProjectFiles, projectFile, readLatexProject } from './project'
import { snapshotProject } from './snapshot'
import type { LatexBuildService } from './build'
import { resolveTargetPathWithinWorkspace } from '../workspace-paths'

export async function importLatexProject(workspaceRoot: string, source: string, kind: 'folder' | 'zip'): Promise<LatexProject> {
  const name = basename(source, kind === 'zip' ? extname(source) : undefined)
  const destination = await resolveTargetPathWithinWorkspace(name, workspaceRoot)
  await mkdir(destination)
  try {
    if (kind === 'folder') {
      for (const file of await listProjectFiles(source)) {
        const target = await projectFile(destination, file)
        await mkdir(join(target, '..'), { recursive: true })
        await writeFile(target, await readFile(await projectFile(source, file)))
      }
    } else {
      if ((await stat(source)).size > MAX_PROJECT_BYTES) throw new Error('ZIP exceeds the 100 MB import limit.')
      const zip = await JSZip.loadAsync(await readFile(source))
      const entries = Object.values(zip.files)
      if (entries.length > 5000) throw new Error('ZIP contains too many entries.')
      let total = 0
      for (const entry of entries) {
        // unsafeOriginalName is essential: JSZip sanitizes ../ before exposing name.
        const raw = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name
        if (/^(?:[\\/]|[A-Za-z]:)/.test(raw) || raw.split(/[\\/]/).some((s) => s === '..') || raw.includes('\\') || raw.includes('\0')) throw new Error('ZIP contains an unsafe path.')
        if ((Number(entry.unixPermissions) & 0xf000) === 0xa000) throw new Error('ZIP symbolic links are not supported.')
        const target = await projectFile(destination, entry.name)
        if (entry.dir) { await mkdir(target, { recursive: true }); continue }
        const chunks: Buffer[] = []
        for await (const chunk of new Readable().wrap(entry.nodeStream())) {
          const buffer = Buffer.from(chunk)
          total += buffer.length
          if (total > MAX_PROJECT_BYTES) throw new Error('Unpacked ZIP exceeds the 100 MB import limit.')
          chunks.push(buffer)
        }
        await mkdir(join(target, '..'), { recursive: true })
        await writeFile(target, Buffer.concat(chunks))
      }
    }
    return await readLatexProject({ workspaceRoot, path: destination })
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}

export async function latexSourceZip(project: LatexProject): Promise<Buffer> {
  const zip = new JSZip()
  const outputName = join(join(project.config.mainFile, '..'), basename(project.config.mainFile, extname(project.config.mainFile)) + '.pdf').replaceAll('\\', '/')
  for (const file of await listProjectFiles(project.rootPath)) {
    if (file === LATEX_MANIFEST || file === outputName) continue
    zip.file(file, await readFile(await projectFile(project.rootPath, file)))
  }
  zip.file(LATEX_MANIFEST, JSON.stringify({ ...project.config, toolDirectory: '' }, null, 2) + '\n')
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export async function currentLatexPdf(service: LatexBuildService, project: LatexProject, expectedHash?: string): Promise<Buffer> {
  const artifact = await service.artifact(project)
  const currentHash = await service.serialized(project.rootPath, () => snapshotProject(project))
  if (!artifact || !expectedHash || artifact.sourceHash !== currentHash || expectedHash !== currentHash) {
    throw new Error('The PDF is older than the source. Compile successfully before exporting.')
  }
  return readFile(artifact.pdfPath)
}
