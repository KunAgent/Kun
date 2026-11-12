export const LATEX_FILE_EXTENSIONS = new Set(['.tex', '.ltx', '.bib', '.cls', '.sty'])
export type LatexEngine = 'xelatex' | 'pdflatex' | 'lualatex'
export type LatexView = 'source' | 'split' | 'pdf'
export type WriteLatexSettings = { engine: LatexEngine; autoCompile: boolean; texPath: string; outDirPolicy: 'cache' }
export function normalizeLatexSettings(value?: Partial<WriteLatexSettings>): WriteLatexSettings {
  return { engine: value?.engine === 'xelatex' || value?.engine === 'lualatex' ? value.engine : 'pdflatex',
    autoCompile: value?.autoCompile !== false, texPath: typeof value?.texPath === 'string' ? value.texPath.trim() : '', outDirPolicy: 'cache' }
}
export type LatexTarget = { workspaceRoot: string; path: string }
export type LatexConfig = {
  version: 1
  title: string
  mainFile: string
  engine: LatexEngine
  autoBuild: boolean
  toolDirectory: string
  bibFile: string
}
export type LatexProject = {
  rootPath: string
  mainPath: string
  config: LatexConfig
  files: string[]
  mainCandidates: string[]
  requestedFile?: string
  needsMainChoice?: boolean
}
export type LatexFailure = { ok: false; message: string; candidates?: string[] }
export type LatexResult<T> = ({ ok: true } & T) | LatexFailure
export type LatexDiagnostic = {
  level: 'error' | 'warning'
  message: string
  code: 'tex' | 'missing-package' | 'undefined-command' | 'citation' | 'overflow'
  file?: string
  line?: number
}
export type LatexTools = {
  latexmk: string | null
  engine: string | null
  synctex: string | null
  searchedPaths: string[]
}
export type LatexPdf = {
  dataBase64: string
  size: number
  mtimeMs: number
  sourceHash: string
  buildId: string
}
export type LatexBuild = {
  buildId: string
  status: 'succeeded' | 'failed' | 'cancelled' | 'missing-tools'
  sourceHash: string
  sourceRevision: number
  durationMs: number
  completedAt: number
  diagnostics: LatexDiagnostic[]
  log: string
  pdf: LatexPdf | null
  tools: LatexTools
}
export type LatexEdit = { file: string; before: string; after: string }
export type LatexSyncPoint = { file: string; line: number; page: number; x: number; y: number }

export function isLatexFilePath(path: string): boolean {
  return LATEX_FILE_EXTENSIONS.has(/\.[^./\\]+$/.exec(path)?.[0]?.toLowerCase() ?? '')
}

/** Files and native tool execution stay behind the desktop preload boundary. */
export type KunGuiLatexApi = {
  latexReadProject: (input: LatexTarget) => Promise<LatexResult<{ project: LatexProject }>>
  latexConfigure: (input: LatexTarget & { config: LatexConfig }) => Promise<LatexResult<{ project: LatexProject }>>
  latexCreate: (input: { workspaceRoot: string; name: string; template: 'chinese' | 'english' | 'blank'; autoBuild: boolean }) => Promise<LatexResult<{ project: LatexProject }>>
  latexImport: (input: { workspaceRoot: string; kind: 'folder' | 'zip' }) => Promise<LatexResult<{ project?: LatexProject; canceled?: boolean }>>
  latexReadSource: (input: LatexTarget) => Promise<LatexResult<{ content: string; truncated?: boolean }>>
  latexSave: (input: LatexTarget & { edits: LatexEdit[] }) => Promise<LatexResult<Record<never, never>>>
  latexDetectTools: (input: LatexTarget) => Promise<LatexResult<{ tools: LatexTools }>>
  latexPickTools: (input: LatexTarget) => Promise<LatexResult<{ project?: LatexProject; canceled?: boolean }>>
  latexBuild: (input: LatexTarget & { buildId: string; sourceRevision: number }) => Promise<LatexResult<{ build: LatexBuild }>>
  latexAbortBuild: (input: LatexTarget & { buildId: string }) => Promise<LatexResult<Record<never, never>>>
  latexReadPdf: (input: LatexTarget) => Promise<LatexResult<{ pdf: LatexPdf | null; currentSourceHash: string }>>
  onLatexBuildLog: (handler: (event: { buildId: string; text: string }) => void) => () => void
  latexSync: (input: LatexTarget & { buildId: string; direction: 'forward' | 'inverse'; file?: string; line?: number; page?: number; x?: number; y?: number }) => Promise<LatexResult<{ point: LatexSyncPoint | null }>>
  latexProposeFix: (input: LatexTarget & { providerId?: string; model?: string; instruction: string; diagnostics: LatexDiagnostic[]; files: Array<{ file: string; content: string }> }) => Promise<LatexResult<{ edits: LatexEdit[] }>>
  latexExport: (input: LatexTarget & { format: 'pdf' | 'source'; sourceHash?: string }) => Promise<LatexResult<{ path?: string; canceled?: boolean }>>
}
