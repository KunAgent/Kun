import { stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import type { LocalTool } from './local-tool-host.js'

export type FsStats = NonNullable<Awaited<ReturnType<typeof stat>>>

/** Runtime-owned ceiling for synchronous foreground shell commands. */
export const DEFAULT_BASH_TIMEOUT_SECONDS = 15 * 60
/** Runtime-owned ceiling for explicitly detached shell commands. */
export const DEFAULT_BACKGROUND_BASH_TIMEOUT_SECONDS = 24 * 60 * 60
export const DEFAULT_SEARCH_LIMIT = 100
export const DEFAULT_LIST_LIMIT = 500
export const DEFAULT_FIND_LIMIT = 1000
/** Hard input cap before the read tool creates a full in-memory buffer. */
export const DEFAULT_READ_MAX_FILE_BYTES = 4 * 1024 * 1024
/** Per-file and per-call budgets for the grep fallback/context reader. */
export const DEFAULT_GREP_MAX_FILE_BYTES = 2 * 1024 * 1024
export const DEFAULT_GREP_MAX_TOTAL_BYTES = 8 * 1024 * 1024
export const DEFAULT_GREP_MAX_CONTEXT_LINES = 20
export const DEFAULT_GREP_MAX_MATCHES = 1_000
/** Fast Context is deliberately much smaller than normal source-tool pages. */
export const FAST_CONTEXT_GREP_MAX_MATCHES = 30
export const FAST_CONTEXT_GLOB_MAX_MATCHES = 100
export const FAST_CONTEXT_GREP_MAX_TEXT_CHARACTERS = 300
export const FAST_CONTEXT_READ_MAX_LINES = 200
export const FAST_CONTEXT_SEARCH_MAX_OUTPUT_BYTES = 512 * 1024
/** Read input is capped too, so line paging never scans a giant file. */
export const FAST_CONTEXT_READ_MAX_FILE_BYTES = FAST_CONTEXT_SEARCH_MAX_OUTPUT_BYTES
/** Reserve ample space for JSON escaping and read metadata around content. */
export const FAST_CONTEXT_READ_MAX_CONTENT_BYTES = 64 * 1024
export const FAST_CONTEXT_SEARCH_TIMEOUT_MS = 8_000
/** Basenames excluded from Fast Context recursive source discovery. */
export const FAST_CONTEXT_EXCLUDED_DIRECTORY_NAMES = [
  '.git',
  '.cache',
  '.next',
  '.turbo',
  '.venv',
  '.yarn',
  '__pycache__',
  'bower_components',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor'
] as const
/**
 * Basenames pruned only while Fast Context walks recursively from a parent
 * directory. An explicit path inside one of these (for example
 * `.vscode/settings.json` or `.claude/skills`) remains searchable and readable.
 */
export const FAST_CONTEXT_DISCOVERY_EXCLUDED_DIRECTORY_NAMES = [
  '.angular',
  '.cargo',
  '.claude',
  '.dart_tool',
  '.gradle',
  '.idea',
  '.m2',
  '.mypy_cache',
  '.nx',
  '.parcel-cache',
  '.pnpm-store',
  '.pytest_cache',
  '.svelte-kit',
  '.terraform',
  '.tox',
  '.vscode',
  'DerivedData',
  'Pods',
  'logs',
  'tmp'
] as const
/** Binary, media, and generated bundles Fast Context never opens while searching. */
export const FAST_CONTEXT_EXCLUDED_FILE_GLOBS = [
  '!*.{png,jpg,jpeg,gif,webp,ico,icns,bmp,tif,tiff,psd,heic,avif}',
  '!*.{pdf,zip,gz,tgz,bz2,xz,7z,rar,jar,war,dmg,iso}',
  '!*.{woff,woff2,ttf,otf,eot}',
  '!*.{mp3,mp4,m4a,mov,avi,mkv,wav,flac,ogg,webm}',
  '!*.{wasm,so,dylib,dll,exe,bin,dat,db,sqlite,sqlite3,pyc,class,o,a,lib,node}',
  '!*.{min.js,min.css,map}'
] as const
/** rg `--max-filesize` for Fast Context scans; larger files are almost never source. */
export const FAST_CONTEXT_MAX_SCAN_FILE_SIZE = '1M'
/** Per-file match ceiling while ranking candidate files across a directory. */
export const FAST_CONTEXT_CANDIDATE_MAX_COUNT_PER_FILE = 50
/** Candidate files collected before a ranked scan stops walking the tree. */
export const FAST_CONTEXT_CANDIDATE_FILE_LIMIT = 2_000
/** Files whose matching lines are returned after relevance ranking. */
export const FAST_CONTEXT_RANKED_FILE_LIMIT = 12
/** Process-wide ceiling on concurrent Fast Context rg/git helpers. */
export const FAST_CONTEXT_DEFAULT_PROCESS_SLOTS = 4
/** Above this many indexed files, unscoped root greps must name a path or glob. */
export const FAST_CONTEXT_LARGE_WORKSPACE_FILE_COUNT = 50_000
/** Timed-out source commands in one run before unscoped root greps are refused. */
export const FAST_CONTEXT_TIMEOUTS_BEFORE_SCOPE_REQUIRED = 2
/** Optional workspace file (gitignore syntax) with extra Fast Context exclusions. */
export const FAST_CONTEXT_IGNORE_FILE_NAME = '.kunignore'
export const DEFAULT_IMAGE_MAX_DIMENSION = 2000
export const DEFAULT_IMAGE_MAX_BASE64_BYTES = 4.5 * 1024 * 1024
export const FD_EXECUTABLE_CANDIDATES = [
  '/Applications/Codex.app/Contents/Resources/fd',
  'fd'
]
export const RG_EXECUTABLE_CANDIDATES = [
  '/Applications/Codex.app/Contents/Resources/rg',
  'rg'
]

export type TruncateMode = 'head' | 'tail'

export type TextSlice = {
  text: string
  truncated: boolean
  totalLines: number
  shownLines: number
  totalBytes: number
  shownBytes: number
  firstLineExceedsLimit?: boolean
  truncatedBy?: 'lines' | 'bytes'
  lastLinePartial?: boolean
}

export type ShellConfig = {
  shell: string
  args: string[]
}

export type ListEntry = {
  path: string
  relative_path: string
  name: string
  kind: 'file' | 'directory' | 'symlink' | 'other'
  size: number
}

export type GrepMatch = {
  path: string
  relative_path: string
  line: number
  column: number
  text: string
  /** True when Fast Context clipped the matching text to its hard ceiling. */
  text_truncated?: boolean
  context_before?: string[]
  context_after?: string[]
}

export type EditInstruction = {
  oldText: string
  newText: string
}

export type ImageDetection = {
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  width?: number
  height?: number
}

export interface ResizedImageResult {
  dataBase64: string
  mimeType: string
  width: number
  height: number
  originalWidth?: number
  originalHeight?: number
  wasResized?: boolean
}

export interface ResizeImageOptions {
  maxWidth?: number
  maxHeight?: number
  maxBytes?: number
}

export type ReadClassification = {
  kind: 'docs' | 'resource' | 'skill'
  label: string
}

export const COMPACT_RESOURCE_FILE_NAMES = new Set(['AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'])

export type BuiltinToolName =
  | 'read'
  | 'bash'
  | 'edit'
  | 'write'
  | 'grep'
  | 'glob'
  | 'find'
  | 'ls'
  | 'lsp'
  | 'repo_map'
  | 'git_inspect'
  | 'verify_changes'
  | 'send_im_attachment'
export const allBuiltinToolNames: Set<BuiltinToolName> = new Set([
  'read',
  'bash',
  'edit',
  'write',
  'grep',
  'glob',
  'find',
  'ls',
  'lsp',
  'repo_map',
  'git_inspect',
  'verify_changes',
  'send_im_attachment'
])
export type ToolName = BuiltinToolName
export const allToolNames: Set<ToolName> = allBuiltinToolNames

export type ReadLocalToolOptions = {
  maxLines?: number
  maxBytes?: number
  /** Maximum file size accepted before allocating a full read buffer. */
  maxFileBytes?: number
  autoResizeImages?: boolean
  operations?: ReadLocalToolOperations
}

/**
 * Optional host-side tuning for a Fast Context child. Every value can only
 * make the hard Fast Context ceilings stricter; it cannot expand them.
 */
export type FastContextSearchOptions = {
  maxMatches?: number
  maxTextCharacters?: number
  maxOutputBytes?: number
  timeoutMs?: number
  /** Extra directory basenames to skip in addition to the default exclusions. */
  excludedDirectoryNames?: readonly string[]
}

export type BackgroundShellRecordInput = {
  id: string
  threadId: string
  turnId: string
  command: string
  cwd: string
  shell: string
  status: 'running' | 'completed' | 'stopped' | 'failed'
  startedAt: string
  finishedAt?: string
  exitCode: number | null
  output: string
  outputTruncated?: boolean
  outputFilePath?: string
  error?: string
  detached: boolean
}

export type BackgroundShellHooks = {
  onSessionStarted?: (record: BackgroundShellRecordInput) => void | Promise<void>
  onSessionUpdated?: (record: BackgroundShellRecordInput) => void | Promise<void>
  onSessionSettled?: (record: BackgroundShellRecordInput) => void | Promise<void>
  isDetachedSession?: (sessionId: string) => boolean
}

export type BashLocalToolOptions = {
  /** Foreground timeout. Also remains the compatibility fallback for background calls when explicitly configured. */
  defaultTimeoutSeconds?: number
  /** Background timeout. Defaults to 24 hours independently of the foreground ceiling. */
  defaultBackgroundTimeoutSeconds?: number
  /** Test/composition seam; production defaults to one non-durable liveness update every 30 seconds. */
  foregroundLivenessIntervalMs?: number
  maxLines?: number
  maxBytes?: number
  /** Process-wide cap for concurrently running detached shell sessions. */
  maxBackgroundSessions?: number
  /** Per-thread cap for concurrently running detached shell sessions. */
  maxBackgroundSessionsPerThread?: number
  /** Maximum accepted timeout for a detached shell session. */
  maxBackgroundTimeoutSeconds?: number
  operations?: BashLocalToolOperations
  backgroundShell?: BackgroundShellHooks
  backgroundShellDataDir?: string
}

export type WriteLocalToolOptions = {
  operations?: WriteLocalToolOperations
}
export type EditLocalToolOptions = {
  operations?: EditLocalToolOperations
}

export type GrepLocalToolOptions = {
  defaultLimit?: number
  /** Maximum size of one file read for scan fallback or context lines. */
  maxFileBytes?: number
  /** Total bytes grep may read itself while scanning/contextualizing results. */
  maxTotalBytes?: number
  rgExecutableCandidates?: string[]
  fastContext?: FastContextSearchOptions
  operations?: GrepLocalToolOperations
}

export type FindLocalToolOptions = {
  defaultLimit?: number
  fdExecutableCandidates?: string[]
  rgExecutableCandidates?: string[]
  fastContext?: FastContextSearchOptions
  operations?: FindLocalToolOperations
}

export type LsLocalToolOptions = {
  defaultLimit?: number
  operations?: LsLocalToolOperations
}

export type BuiltinLocalToolsOptions = {
  read?: ReadLocalToolOptions
  bash?: BashLocalToolOptions
  write?: WriteLocalToolOptions
  edit?: EditLocalToolOptions
  grep?: GrepLocalToolOptions
  glob?: FindLocalToolOptions
  find?: FindLocalToolOptions
  ls?: LsLocalToolOptions
}
export type ToolsOptions = BuiltinLocalToolsOptions

/**
 * Construction-time companion to the per-call `ToolHostContext.fastContext`
 * marker. A dedicated child host can use this while the marker keeps shared
 * hosts from applying these limits to ordinary agent source tools.
 */
export const FAST_CONTEXT_SOURCE_TOOL_OPTIONS = {
  read: {
    maxLines: FAST_CONTEXT_READ_MAX_LINES,
    maxBytes: FAST_CONTEXT_READ_MAX_CONTENT_BYTES,
    maxFileBytes: FAST_CONTEXT_READ_MAX_FILE_BYTES
  },
  grep: { fastContext: {} },
  glob: { fastContext: {} },
  find: { fastContext: {} }
} satisfies Pick<BuiltinLocalToolsOptions, 'read' | 'grep' | 'glob' | 'find'>

export interface ReadLocalToolOperations {
  stat?: (path: string) => Promise<FsStats>
  readFile?: (path: string) => Promise<Buffer>
  detectImageMimeType?: (buffer: Buffer) => ImageDetection | null
  resizeImage?: (
    buffer: Buffer,
    mimeType: string,
    options?: ResizeImageOptions
  ) => Promise<ResizedImageResult | null>
}

export interface BashLocalToolOperations {
  exec?: (
    command: string,
    cwd: string,
    options: { signal: AbortSignal; timeoutSeconds: number; onData?: (data: Buffer) => void }
  ) => Promise<{ exitCode: number | null; shell?: string }>
}

export interface WriteLocalToolOperations {
  mkdir?: (path: string) => Promise<void>
  writeFile?: (path: string, content: string) => Promise<void>
  /** Test/composition seam; the returned handle is always identity-verified before use. */
  openExternal?: (path: string, flags: number) => Promise<FileHandle>
}

export interface EditLocalToolOperations {
  readFile?: (path: string) => Promise<string>
  writeFile?: (path: string, content: string) => Promise<void>
  /** Test/composition seam; the returned handle is always identity-verified before use. */
  openExternal?: (path: string, flags: number) => Promise<FileHandle>
}

export interface GrepLocalToolOperations {
  search?: (
    input: {
      pattern: string
      path: string
      glob: string | null
      ignoreCase: boolean
      literal: boolean
      context: number
      limit: number
    }
  ) => Promise<GrepMatch[]>
  /** Test/composition seam for rg source command execution. */
  spawnCapture?: SourceCommandCapture
}

export interface FindLocalToolOperations {
  glob?: (
    input: { pattern: string; path: string; limit: number }
  ) => Promise<Array<{ path: string; relative_path: string }>>
  /** Test/composition seam for fd/rg source command execution. */
  spawnCapture?: SourceCommandCapture
}

/** Injectable source-command runner shared by grep, glob, and Fast Context indexes. */
export type SourceCommandCapture = (
  file: string,
  args: string[],
  options: {
    cwd: string
    signal?: AbortSignal
    maxOutputBytes?: number
    timeoutMs?: number
    maxLines?: number
    lowPriority?: boolean
  }
) => Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
  outputTruncated: boolean
  timedOut: boolean
  lineLimitReached?: boolean
}>

export interface LsLocalToolOperations {
  stat?: (path: string) => Promise<FsStats>
  readdir?: (path: string) => Promise<Array<{ name: string }>>
}

export type Tool = LocalTool
export type ToolDef = LocalTool
