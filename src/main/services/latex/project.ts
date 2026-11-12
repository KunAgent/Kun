import { readFile, readdir, stat, writeFile, mkdir, rename, unlink, open } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { isLatexFilePath, type LatexConfig, type LatexProject, type LatexTarget, type WriteLatexSettings } from '../../../shared/latex-project'
import { resolveOpenTargetPath, resolveTargetPathWithinWorkspace } from '../workspace-paths'

export const LATEX_MANIFEST = '.kun-latex.json'
export const MAX_PROJECT_BYTES = 100 * 1024 * 1024
export const MAX_SOURCE_BYTES = 1536 * 1024
const excluded = new Set(['.git', '.kun', '.kun-latex', '.cache', '.kun-design', '.codex', '.agents', 'node_modules', 'build', 'out', 'dist', 'coverage', '.DS_Store'])
const generated = /\.(?:aux|log|fls|fdb_latexmk|synctex(?:\.gz)?|toc|lof|lot|out|bbl|blg|bcf|run\.xml|nav|snm|vrb|xdv|dvi)$/i
export const latexConfigSchema = z.object({
  version: z.literal(1), title: z.string().min(1).max(200), mainFile: z.string().min(1).max(1024),
  engine: z.enum(['xelatex', 'pdflatex', 'lualatex']), autoBuild: z.boolean(),
  toolDirectory: z.string().max(4096), bibFile: z.string().min(1).max(1024)
}).strict()

export async function projectFile(root: string, file: string): Promise<string> {
  return resolveTargetPathWithinWorkspace(file, root)
}

export async function listProjectFiles(root: string): Promise<string[]> {
  const files: string[] = []
  let bytes = 0
  let scanned = 0
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (++scanned > 5000) throw new Error('LaTeX project contains too many files (maximum 5000).')
      if (excluded.has(entry.name) || generated.test(entry.name)) continue
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not supported in LaTeX projects: ${entry.name}`)
      const path = await projectFile(root, join(dir, entry.name))
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) {
        bytes += (await stat(path)).size
        if (bytes > MAX_PROJECT_BYTES) throw new Error('LaTeX project exceeds the 100 MB limit.')
        files.push(relative(root, path).replaceAll('\\', '/'))
      }
    }
  }
  await visit(root)
  return files.sort()
}

export async function readLatexSource(root: string, file: string, preview = false): Promise<string> {
  if (!isLatexFilePath(file)) throw new Error('Only LaTeX source files can be edited here.')
  const target = await projectFile(root, file)
  if ((await stat(target)).size > MAX_SOURCE_BYTES) {
    if (!preview) throw new Error('Source file exceeds the 1.5 MB editing limit.')
    const handle = await open(target, 'r')
    try {
      const bytes = Buffer.alloc(MAX_SOURCE_BYTES)
      const result = await handle.read(bytes, 0, bytes.length, 0)
      return bytes.subarray(0, result.bytesRead).toString('utf8')
    } finally { await handle.close() }
  }
  return readFile(target, 'utf8')
}

export async function readLatexProject(input: LatexTarget): Promise<LatexProject> {
  const requested = await resolveOpenTargetPath(input.path, input.workspaceRoot, { allowBasenameFallback: false })
  const boundary = await resolveOpenTargetPath(input.workspaceRoot, input.workspaceRoot)
  let root = (await stat(requested)).isDirectory() ? requested : dirname(requested)
  let config: LatexConfig | undefined
  let search = root
  while (true) {
    try {
      config = latexConfigSchema.parse(JSON.parse(await readFile(await projectFile(search, LATEX_MANIFEST), 'utf8')))
      root = search
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (search === boundary) break
    const parent = dirname(search)
    if (parent === search) break
    search = parent
  }
  // Without a manifest, walk upwards until a containing main document is found.
  if (!config) {
    search = root
    while (true) {
      const entries = await readdir(search, { withFileTypes: true })
      const mains: string[] = []
      for (const e of entries) {
        if (e.isFile() && /\.(tex|ltx)$/i.test(e.name) &&
          /\\documentclass(?:\s*\[|\s*\{)/.test((await readLatexSource(search, e.name, true)).replace(/(?<!\\)%[^\n]*/g, ''))) mains.push(e.name)
      }
      if (mains.length) { root = search; break }
      if (search === boundary || dirname(search) === search) break
      search = dirname(search)
    }
  }
  const files = await listProjectFiles(root)
  const mainCandidates: string[] = []
  for (const file of files.filter((f) => /\.(tex|ltx)$/i.test(f))) {
    if (/\\documentclass(?:\s*\[|\s*\{)/.test((await readLatexSource(root, file, true)).replace(/(?<!\\)%[^\n]*/g, ''))) mainCandidates.push(file)
  }
  const requestedFile = relative(root, requested).replaceAll('\\', '/')
  const configured = !!config && files.includes(config.mainFile)
  const previousConfig = config
  if (config) {
    await projectFile(root, config.mainFile)
    await projectFile(root, config.bibFile)
    if (!files.includes(config.mainFile)) config = undefined
  }
  const chosen = mainCandidates.includes(requestedFile)
    ? requestedFile : mainCandidates[0] ?? files.find((f) => /\.(tex|ltx)$/i.test(f)) ?? ''
  if (!chosen && !config) throw new Error('No LaTeX main document was found.')
  const text = await readLatexSource(root, config?.mainFile ?? chosen, true)
  const bibliography = /\\(?:bibliography|addbibresource)(?:\[[^\]]*\])?\{([^}]+)\}/.exec(text)?.[1]?.split(',')[0]
  const bibFile = bibliography ? (/\.bib$/i.test(bibliography) ? bibliography : `${bibliography}.bib`) : 'references.bib'
  config ??= {
    version: 1, title: basename(root), engine: /ctex|xeCJK|fontspec/.test(text) ? 'xelatex' : 'pdflatex',
    autoBuild: true, toolDirectory: '', bibFile: join(dirname(chosen), bibFile).replaceAll('\\', '/'),
    ...previousConfig, mainFile: chosen
  }
  const mainPath = await projectFile(root, config.mainFile)
  await projectFile(root, config.bibFile)
  if (!/\.(tex|ltx)$/i.test(mainPath)) throw new Error('The main document must be a .tex or .ltx file.')
  return { rootPath: root, mainPath, config, files, mainCandidates,
    ...(files.includes(requestedFile) ? { requestedFile } : {}),
    needsMainChoice: !configured && mainCandidates.length > 1 && !mainCandidates.includes(requestedFile) }
}

export async function atomicWrite(path: string, content: string | Buffer): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temp, content); await rename(temp, path) }
  finally { await unlink(temp).catch(() => {}) }
}

export async function configureLatexProject(input: LatexTarget, config: LatexConfig): Promise<LatexProject> {
  const project = await readLatexProject(input)
  const parsed = latexConfigSchema.parse(config)
  await readLatexSource(project.rootPath, parsed.mainFile)
  await projectFile(project.rootPath, parsed.bibFile)
  await atomicWrite(await projectFile(project.rootPath, LATEX_MANIFEST), JSON.stringify(parsed, null, 2) + '\n')
  return readLatexProject({ ...input, path: project.rootPath })
}

export async function createLatexProject(input: { workspaceRoot: string; name: string; template: 'chinese' | 'english' | 'blank'; autoBuild: boolean }, defaults?: WriteLatexSettings): Promise<LatexProject> {
  if (!input.name.trim() || /[\\/]/.test(input.name) || [...input.name].some((character) => character.charCodeAt(0) < 32) || input.name === '.' || input.name === '..') throw new Error('Invalid project name.')
  const root = await resolveTargetPathWithinWorkspace(input.name.trim(), input.workspaceRoot)
  await mkdir(root)
  const chinese = input.template === 'chinese'
  const main = input.template === 'blank'
    ? '\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n'
    : `${chinese ? '\\documentclass[UTF8]{ctexart}' : '\\documentclass{article}'}\n\\usepackage{amsmath,amssymb,graphicx}\n\\title{${chinese ? '论文标题' : 'Paper title'}}\n\\author{${chinese ? '作者' : 'Author'}}\n\\date{\\today}\n\\begin{document}\n\\maketitle\n\\begin{abstract}\n${chinese ? '在此撰写摘要。' : 'Write your abstract here.'}\n\\end{abstract}\n\\input{sections/introduction}\n% \\bibliographystyle{plain}\n% \\bibliography{references}\n\\end{document}\n`
  if (input.template !== 'blank') await mkdir(join(root, 'sections'))
  await mkdir(join(root, 'figures'))
  await writeFile(join(root, 'main.tex'), main)
  if (input.template !== 'blank') await writeFile(join(root, 'sections/introduction.tex'), `\\section{${chinese ? '引言' : 'Introduction'}}\n${chinese ? '在此开始撰写正文。' : 'Start writing here.'}\n`)
  await writeFile(join(root, 'references.bib'), '')
  await writeFile(join(root, LATEX_MANIFEST), JSON.stringify({ version: 1, title: input.name.trim(), mainFile: 'main.tex', engine: chinese ? 'xelatex' : defaults?.engine ?? 'pdflatex', autoBuild: input.autoBuild, toolDirectory: defaults?.texPath ?? '', bibFile: 'references.bib' } satisfies LatexConfig, null, 2) + '\n')
  return readLatexProject({ workspaceRoot: input.workspaceRoot, path: root })
}
