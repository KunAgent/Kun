import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, readdir } from 'node:fs/promises'
import { basename, delimiter, dirname, extname, join, relative, resolve } from 'node:path'
import type { LatexBuild, LatexEdit, LatexPdf, LatexProject, LatexTarget } from '../../../shared/latex-project'
import { atomicWrite, MAX_SOURCE_BYTES, projectFile, readLatexProject, readLatexSource } from './project'
import { detectLatexTools } from './detect'
import { parseLatexLog } from './log-parse'
import { snapshotProject } from './snapshot'
import { runLatexProcess } from './process'

export type LatexArtifact = { buildId: string; sourceHash: string; outputPath: string; snapshotPath: string; pdfPath: string; mtimeMs: number }
export class LatexBuildService {
  private running = new Map<string, { id: string; controller: AbortController }>()
  private queues = new Map<string, Promise<unknown>>()
  private closing = false
  private cancelled = new Set<string>()
  constructor(readonly cacheRoot: string) {}

  projectCache(project: LatexProject): string {
    return join(this.cacheRoot, createHash('sha256').update(project.rootPath).digest('hex').slice(0, 32))
  }

  async serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(key) ?? Promise.resolve()
    const task = prior.catch(() => {}).then(operation)
    this.queues.set(key, task)
    try { return await task } finally { if (this.queues.get(key) === task) this.queues.delete(key) }
  }

  async save(input: LatexTarget, edits: LatexEdit[]): Promise<void> {
    const project = await readLatexProject(input)
    await this.serialized(project.rootPath, async () => {
      const targets = new Set<string>()
      for (const edit of edits) {
        if (Buffer.byteLength(edit.after, 'utf8') > MAX_SOURCE_BYTES) throw new Error('Source file exceeds the 1.5 MB editing limit.')
        const path = await projectFile(project.rootPath, edit.file)
        if (targets.has(path)) throw new Error('A source file occurs more than once in the save request.')
        targets.add(path)
        const current = await readLatexSource(project.rootPath, edit.file).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT' && edit.before === '') return ''
          throw error
        })
        if (current !== edit.before) throw new Error(`Source changed on disk: ${edit.file}. Review the external changes before saving.`)
      }
      const committed: LatexEdit[] = []
      try {
        for (const edit of edits) {
          await atomicWrite(await projectFile(project.rootPath, edit.file), edit.after)
          committed.push(edit)
        }
      } catch (error) {
        for (const edit of committed.reverse()) await atomicWrite(await projectFile(project.rootPath, edit.file), edit.before)
        throw error
      }
    })
  }

  async artifact(project: LatexProject): Promise<LatexArtifact | null> {
    try {
      const value = JSON.parse(await readFile(join(this.projectCache(project), 'latest.json'), 'utf8')) as LatexArtifact
      // Cache metadata never grants arbitrary filesystem access.
      if (!/^[\w-]{1,100}$/.test(value.buildId)) return null
      const directory = join(this.projectCache(project), value.buildId)
      return { ...value, snapshotPath: join(directory, 'source'), outputPath: join(directory, 'output'),
        pdfPath: join(directory, 'output', basename(project.config.mainFile, extname(project.config.mainFile)) + '.pdf') }
    } catch { return null }
  }

  async readPdf(project: LatexProject): Promise<LatexPdf | null> {
    const artifact = await this.artifact(project)
    if (!artifact) return null
    try {
      const info = await stat(artifact.pdfPath)
      if (info.size > 32 * 1024 * 1024) throw new Error('Compiled PDF exceeds the 32 MB preview limit.')
      return { buildId: artifact.buildId, sourceHash: artifact.sourceHash, mtimeMs: info.mtimeMs,
        size: info.size, dataBase64: (await readFile(artifact.pdfPath)).toString('base64') }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async build(input: LatexTarget & { buildId: string; sourceRevision: number }, onLog?: (text: string) => void): Promise<LatexBuild> {
    if (!/^[\w-]{1,100}$/.test(input.buildId)) throw new Error('Invalid build identifier.')
    if (this.closing) throw new Error('Kun is shutting down.')
    const project = await readLatexProject(input)
    if (this.closing) throw new Error('Kun is shutting down.')
    if (this.running.has(project.rootPath)) throw new Error('This project is already compiling.')
    const controller = new AbortController()
    if (this.cancelled.delete(input.buildId)) controller.abort()
    this.running.set(project.rootPath, { id: input.buildId, controller })
    const start = Date.now()
    const directory = join(this.projectCache(project), input.buildId)
    const snapshotPath = join(directory, 'source')
    const outputPath = join(directory, 'output')
    let succeeded = false
    try {
      const tools = await detectLatexTools(project.config.engine, project.config.toolDirectory)
      const base = { buildId: input.buildId, sourceRevision: input.sourceRevision, sourceHash: '', durationMs: 0, completedAt: Date.now(),
        diagnostics: [], log: '', pdf: null, tools } satisfies Omit<LatexBuild, 'status'>
      if (!tools.latexmk || !tools.engine) return { ...base, status: 'missing-tools' }
      await mkdir(outputPath, { recursive: true })
      const sourceHash = await this.serialized(project.rootPath, () => snapshotProject(project, snapshotPath))
      const mode = { xelatex: '-xelatex', pdflatex: '-pdf', lualatex: '-lualatex' }[project.config.engine]
      const result = await runLatexProcess(tools.latexmk, ['-norc', mode, '-no-shell-escape', '-interaction=nonstopmode',
        '-halt-on-error', '-file-line-error', '-synctex=1', `-outdir=${outputPath}`, '-cd', `./${project.config.mainFile}`], {
        cwd: snapshotPath, signal: controller.signal, onLog,
        env: { ...process.env, PATH: [dirname(tools.engine), dirname(tools.latexmk), process.env.PATH ?? ''].join(delimiter),
          openin_any: 'p', openout_any: 'p', TEXMFOUTPUT: outputPath }
      })
      const diagnostics = parseLatexLog(result.log, project.config.mainFile).map((diagnostic) => {
        if (!diagnostic.file) return diagnostic
        const file = relative(snapshotPath, resolve(dirname(join(snapshotPath, project.config.mainFile)), diagnostic.file)).replaceAll('\\', '/')
        return project.files.includes(file) ? { ...diagnostic, file } : diagnostic
      })
      const pdfPath = join(outputPath, basename(project.config.mainFile, extname(project.config.mainFile)) + '.pdf')
      const hasPdf = await stat(pdfPath).then((s) => s.isFile() && s.size <= 32 * 1024 * 1024).catch(() => false)
      succeeded = result.code === 0 && hasPdf && !result.cancelled
      if (!succeeded && !result.cancelled && !diagnostics.some((d) => d.level === 'error')) {
        diagnostics.push({ level: 'error', code: 'tex', file: project.config.mainFile,
          message: hasPdf ? 'TeX compilation failed. See the build log.' : 'TeX did not produce a PDF within the 32 MB limit. See the build log.' })
      }
      if (succeeded) {
        const artifact: LatexArtifact = { buildId: input.buildId, sourceHash, outputPath, snapshotPath, pdfPath, mtimeMs: Date.now() }
        await atomicWrite(join(this.projectCache(project), 'latest.json'), JSON.stringify(artifact))
        for (const entry of await readdir(this.projectCache(project), { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name !== input.buildId) await rm(join(this.projectCache(project), entry.name), { recursive: true, force: true })
        }
      }
      return { ...base, sourceHash, status: result.cancelled ? 'cancelled' : succeeded ? 'succeeded' : 'failed',
        durationMs: Date.now() - start, completedAt: Date.now(), diagnostics, log: result.log, pdf: succeeded ? await this.readPdf(project) : null }
    } finally {
      this.running.delete(project.rootPath)
      if (!succeeded) await rm(directory, { recursive: true, force: true })
    }
  }

  async abort(input: LatexTarget & { buildId: string }): Promise<void> {
    const running = [...this.running.values()].find((running) => running.id === input.buildId)
    if (running) running.controller.abort()
    else {
      this.cancelled.add(input.buildId)
      if (this.cancelled.size > 100) this.cancelled.delete(this.cancelled.values().next().value!)
    }
  }

  stop(): void {
    this.closing = true
    for (const running of this.running.values()) running.controller.abort()
  }
}
