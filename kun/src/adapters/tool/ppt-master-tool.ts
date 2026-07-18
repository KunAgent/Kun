import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'
import { assertCanWritePath } from './sandbox-policy.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

export const PPT_MASTER_RUN_TOOL_NAME = 'ppt_master_run'
export const PPT_MASTER_READ_GUIDE_TOOL_NAME = 'ppt_master_read_guide'
export const PPT_MASTER_CONFIRM_DESIGN_TOOL_NAME = 'ppt_master_confirm_design'

const MAX_OUTPUT_CHARS = 32_000
const DEFAULT_TIMEOUT_SECONDS = 10 * 60
const MAX_GUIDE_BYTES = 512 * 1024
const MAX_GUIDE_OUTPUT_BYTES = 24_000
const DEFAULT_GUIDE_LINES = 180
const MAX_GUIDE_LINES = 400
const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const MANAGED_SKILL_DIR = join(homedir(), '.kun', 'skills', 'ppt-master')
const INSTALL_METADATA_FILE = '.kun-ppt-master.json'
const MANAGED_BY = 'kun-gui'
// Keep synchronized with src/main/services/ppt-master-service.ts. This marker
// prevents a workspace-provided skill with the same id from becoming executable.
const MANAGED_VERSION = '3.1.0'
const MANAGED_ARCHIVE_SHA256 = 'b5ecfc7bf2a2682087c05786eb146ffa3a11edcadda77c810770730b6e82ddf2'
const APPROVAL_TOKEN_TTL_MS = 60 * 60 * 1_000
const MAX_REMEMBERED_APPROVALS = 256
const approvedPresentationTurns = new Map<string, { token: string; expiresAt: number }>()

type PptMasterAction = 'init_project' | 'import_markdown' | 'validate' | 'check_svg' | 'split_notes' | 'finalize' | 'export'

type ProcessResult = {
  exitCode: number
  output: string
}

type PptMasterRunner = (
  python: string,
  args: string[],
  cwd: string,
  abortSignal: AbortSignal
) => Promise<ProcessResult>

type PptMasterToolDependencies = {
  /** Test seam; production always uses the managed local venv. */
  pythonPath?: string
  isReady?: (pythonPath: string) => boolean
  run?: PptMasterRunner
}

/**
 * Runs the small, fixed set of PPT Master scripts needed by the Write flow.
 * It deliberately is not a shell escape hatch: every executable, argument
 * shape, and mutable path is pinned or workspace-confined here.
 */
export function buildPptMasterLocalTools(): LocalTool[] {
  const skillDir = resolveManagedPptMasterSkillDir()
  if (!skillDir) return []
  return [
    createPptMasterConfirmDesignTool(),
    createPptMasterReadGuideTool(skillDir),
    createPptMasterRunTool(skillDir)
  ]
}

/**
 * Opens Kun's native structured-input card and issues a short-lived token only
 * when the user chooses to proceed. ppt_master_run requires that token, so a
 * model cannot skip the outline-confirmation boundary.
 */
export function createPptMasterConfirmDesignTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: PPT_MASTER_CONFIRM_DESIGN_TOOL_NAME,
    description: 'Show the user the proposed PPT outline and ask for native confirmation before any PPT Master project files are generated.',
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: isPptMasterActive,
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Concise slide-by-slide outline to show in the confirmation card.' },
        audience: { type: 'string', description: 'Intended audience.' },
        slide_count: { type: 'integer', minimum: 1, maximum: 60, description: 'Proposed number of slides.' },
        visual_direction: { type: 'string', description: 'Proposed visual direction.' },
        output_path: { type: 'string', description: 'Workspace-relative PPTX output path under presentations/.' }
      },
      required: ['summary', 'audience', 'slide_count', 'visual_direction', 'output_path'],
      additionalProperties: false
    },
    execute: async (args, context) => withToolBoundary(async () => {
      if (!context.awaitUserInput) {
        return { output: { error: 'PPT Master confirmation is unavailable in this runtime context.' }, isError: true }
      }
      const summary = stringArg(args.summary)
      const audience = stringArg(args.audience)
      const visualDirection = stringArg(args.visual_direction)
      const outputPath = stringArg(args.output_path)
      const slideCount = args.slide_count
      if (!summary || summary.length > 4_000) return { output: { error: 'summary is required and must be at most 4,000 characters' }, isError: true }
      if (!audience || audience.length > 400) return { output: { error: 'audience is required and must be at most 400 characters' }, isError: true }
      if (!visualDirection || visualDirection.length > 1_200) return { output: { error: 'visual_direction is required and must be at most 1,200 characters' }, isError: true }
      if (typeof slideCount !== 'number' || !Number.isInteger(slideCount) || slideCount < 1 || slideCount > 60) {
        return { output: { error: 'slide_count must be an integer between 1 and 60' }, isError: true }
      }
      if (!isPresentationOutputPath(outputPath) || extname(outputPath).toLowerCase() !== '.pptx') {
        return { output: { error: 'output_path must be a .pptx inside presentations/' }, isError: true }
      }

      const inputId = `ppt_confirm_${randomUUID()}`
      const resolution = await context.awaitUserInput({
        id: inputId,
        itemId: `item_${inputId}`,
        prompt: 'PPT Master design confirmation',
        questions: [{
          id: 'ppt-generation',
          header: 'Generate PPT',
          question: `${slideCount} slides for ${audience}\n\nVisual direction: ${visualDirection}\n\n${summary}`,
          options: [
            { label: 'Generate PPT', description: 'Approve this outline and create the editable PPTX.' },
            { label: 'Cancel', description: 'Do not create project files or a PPTX.' }
          ]
        }]
      })
      const selected = resolution.status === 'submitted'
        ? resolution.answers.find((answer) => answer.id === 'ppt-generation')?.label
        : undefined
      if (selected !== 'Generate PPT') {
        return { output: { error: 'PPT Master generation was cancelled by the user.' }, isError: true }
      }

      const approvalToken = randomUUID()
      rememberPresentationApproval(context, approvalToken)
      return {
        output: {
          approved_design: true,
          approval_token: approvalToken,
          summary,
          audience,
          slide_count: slideCount,
          visual_direction: visualDirection,
          output_path: outputPath
        }
      }
    })
  })
}

/**
 * The full upstream guide belongs outside the workspace. This read-only tool
 * exposes a bounded slice of that already verified package without turning
 * arbitrary user paths into a capability.
 */
export function createPptMasterReadGuideTool(skillDir: string): LocalTool {
  return LocalToolHost.defineTool({
    name: PPT_MASTER_READ_GUIDE_TOOL_NAME,
    description: 'Read a bounded section of the installed PPT Master Markdown or text guide documentation.',
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: isPptMasterActive,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative guide path inside the managed PPT Master package, such as PPT_MASTER_UPSTREAM.md or workflows/routing.md.'
        },
        start_line: {
          type: 'integer',
          minimum: 1,
          description: 'One-based first line to read. Defaults to 1.'
        },
        max_lines: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_GUIDE_LINES,
          description: `Maximum number of lines to return. Defaults to ${DEFAULT_GUIDE_LINES}.`
        }
      },
      required: ['path'],
      additionalProperties: false
    },
    execute: async (args) => withToolBoundary(async () => {
      const requestedPath = stringArg(args.path)
      if (!requestedPath) return { output: { error: 'path is required' }, isError: true }
      const document = await readPptMasterGuide(skillDir, requestedPath)
      const startLine = positiveIntegerArg(args.start_line, 1, Number.MAX_SAFE_INTEGER)
      const maxLines = positiveIntegerArg(args.max_lines, DEFAULT_GUIDE_LINES, MAX_GUIDE_LINES)
      const lines = document.content.split(/\r?\n/)
      const startIndex = Math.min(startLine - 1, lines.length)
      const selected = selectGuideLines(lines, startIndex, maxLines)
      return {
        output: {
          path: document.relativePath,
          start_line: startIndex + 1,
          end_line: startIndex + selected.lines.length,
          total_lines: lines.length,
          content: selected.lines.join('\n'),
          truncated: selected.truncated,
          ...(selected.truncated ? { next_line: startIndex + selected.lines.length + 1 } : {})
        }
      }
    })
  })
}

export function createPptMasterRunTool(
  skillDir: string,
  dependencies: PptMasterToolDependencies = {}
): LocalTool {
  const python = dependencies.pythonPath ?? pptMasterPython(skillDir)
  const isReady = dependencies.isReady ?? existsSync
  const run = dependencies.run ?? runPython
  return LocalToolHost.defineTool({
    name: PPT_MASTER_RUN_TOOL_NAME,
    description: [
      'Run a safe, fixed PPT Master pipeline step for the active PPT Master skill.',
      'Use init_project, import_markdown, validate, check_svg, split_notes, finalize, or export.',
      'This tool always copies the Markdown source, requires the confirmation-card token, and only writes inside the workspace.'
    ].join(' '),
    toolKind: 'file_change',
    policy: 'auto',
    shouldAdvertise: isPptMasterActive,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['init_project', 'import_markdown', 'validate', 'check_svg', 'split_notes', 'finalize', 'export']
        },
        confirmation_token: {
          type: 'string',
          description: 'The approval_token returned by ppt_master_confirm_design in this same turn.'
        },
        project_name: {
          type: 'string',
          description: 'For init_project: a short filesystem-safe project name.'
        },
        projects_root: {
          type: 'string',
          description: 'For init_project: workspace-relative project parent. Defaults to .kun-presentations.'
        },
        project_path: {
          type: 'string',
          description: 'For all non-init actions: workspace-relative PPT Master project directory.'
        },
        source_path: {
          type: 'string',
          description: 'For import_markdown: the workspace-relative Markdown source file.'
        },
        output_path: {
          type: 'string',
          description: 'For export: workspace-relative .pptx destination, normally under presentations/.'
        }
      },
      required: ['action', 'confirmation_token'],
      additionalProperties: false
    },
    execute: async (args, context) => withToolBoundary(async () => {
      if (!isPptMasterAction(args.action)) {
        return { output: { error: 'action must be a supported PPT Master action' }, isError: true }
      }
      if (!hasPresentationApproval(context, stringArg(args.confirmation_token))) {
        return {
          output: { error: 'PPT Master design approval is required before generating project files.' },
          isError: true
        }
      }
      if (!isReady(python)) {
        return {
          output: { error: 'PPT Master is not ready. Use the Write “Generate PPT” button to finish installation first.' },
          isError: true
        }
      }
      const action = args.action
      const command = await commandForAction(action, args, context, skillDir)
      if ('error' in command) return { output: { error: command.error }, isError: true }
      const result = await run(python, command.args, skillDir, context.abortSignal)
      if (action === 'export' && command.outputPath && command.temporaryOutputPath) {
        if (result.exitCode !== 0) {
          await rm(command.temporaryOutputPath, { force: true }).catch(() => undefined)
        } else if (!await isNonEmptyFile(command.temporaryOutputPath)) {
          await rm(command.temporaryOutputPath, { force: true }).catch(() => undefined)
          return {
            output: {
              action,
              error: `PPT Master export completed but did not create a new ${command.outputPath}.`,
              output: result.output
            },
            isError: true
          }
        } else {
          try {
            await publishPresentation(command.temporaryOutputPath, command.outputPath)
          } finally {
            await rm(command.temporaryOutputPath, { force: true }).catch(() => undefined)
          }
          if (!await isNonEmptyFile(command.outputPath)) {
            return {
              output: {
                action,
                error: `PPT Master could not publish ${command.outputPath}.`,
                output: result.output
              },
              isError: true
            }
          }
        }
      }
      const createdProjectPath = action === 'init_project'
        ? projectPathFromOutput(result.output)
        : undefined
      if (result.exitCode === 0 && action === 'init_project' && !createdProjectPath) {
        return {
          output: {
            action,
            error: 'PPT Master created a project but did not report its path.',
            output: result.output
          },
          isError: true
        }
      }
      const generatedPresentation =
        result.exitCode === 0 && action === 'export' && command.outputPath && command.outputRelativePath
          ? {
              name: basename(command.outputPath),
              relativePath: command.outputRelativePath,
              mimeType: PPTX_MIME_TYPE,
              byteSize: (await stat(command.outputPath)).size
            }
          : undefined
      return result.exitCode === 0
        ? {
            output: {
              action,
              ...(createdProjectPath
                ? { project_path: createdProjectPath }
                : command.projectPath ? { project_path: command.projectPath } : {}),
              ...(command.outputPath ? { output_path: command.outputPath } : {}),
              ...(generatedPresentation ? { generatedFiles: [generatedPresentation] } : {}),
              output: result.output
            }
          }
        : {
            output: {
              action,
              error: `PPT Master ${action} failed`,
              output: result.output
            },
            isError: true
          }
    })
  })
}

async function commandForAction(
  action: PptMasterAction,
  args: Record<string, unknown>,
  context: ToolHostContext,
  skillDir: string
): Promise<{
  args: string[]
  projectPath?: string
  outputPath?: string
  outputRelativePath?: string
  temporaryOutputPath?: string
} | { error: string }> {
  const script = (name: string): string => join(skillDir, 'scripts', name)
  if (action === 'init_project') {
    const projectName = safeProjectName(args.project_name)
    if (!projectName) return { error: 'init_project requires a filesystem-safe project_name' }
    const rootInput = stringArg(args.projects_root) || '.kun-presentations'
    const root = await resolveWorkspacePath(rootInput, context, { enforceWorkspaceBoundary: true })
    if (!isManagedProjectRoot(root.relativePath)) {
      return { error: 'projects_root must be .kun-presentations' }
    }
    assertCanWritePath(root.absolutePath, context)
    return {
      args: [script('project_manager.py'), 'init', projectName, '--format', 'ppt169', '--dir', root.absolutePath],
      projectPath: root.absolutePath
    }
  }

  const rawProjectPath = stringArg(args.project_path)
  if (!rawProjectPath) return { error: `${action} requires project_path` }
  const project = await resolveWorkspacePath(rawProjectPath, context, { enforceWorkspaceBoundary: true })
  if (!isManagedProjectPath(project.relativePath)) {
    return { error: 'project_path must be inside .kun-presentations/' }
  }
  assertCanWritePath(project.absolutePath, context)

  if (action === 'import_markdown') {
    const rawSourcePath = stringArg(args.source_path)
    if (!rawSourcePath) return { error: 'import_markdown requires source_path' }
    const source = await resolveWorkspacePath(rawSourcePath, context, { enforceWorkspaceBoundary: true })
    if (!isMarkdownPath(source.absolutePath)) return { error: 'source_path must be a Markdown file' }
    if (!await isFile(source.absolutePath)) return { error: `Markdown source does not exist: ${source.relativePath}` }
    return {
      args: [script('project_manager.py'), 'import-sources', project.absolutePath, source.absolutePath, '--copy'],
      projectPath: project.absolutePath
    }
  }

  if (action === 'validate') {
    return { args: [script('project_manager.py'), 'validate', project.absolutePath], projectPath: project.absolutePath }
  }
  if (action === 'check_svg') {
    return { args: [script('svg_quality_checker.py'), project.absolutePath, '--format', 'ppt169'], projectPath: project.absolutePath }
  }
  if (action === 'split_notes') {
    return { args: [script('total_md_split.py'), project.absolutePath, '--quiet'], projectPath: project.absolutePath }
  }
  if (action === 'finalize') {
    return { args: [script('finalize_svg.py'), project.absolutePath, '--quiet'], projectPath: project.absolutePath }
  }

  const rawOutputPath = stringArg(args.output_path)
  if (!rawOutputPath) return { error: 'export requires output_path' }
  const output = await resolveWorkspacePath(rawOutputPath, context, { enforceWorkspaceBoundary: true })
  if (!isPresentationOutputPath(output.relativePath)) {
    return { error: 'output_path must be inside presentations/' }
  }
  assertCanWritePath(output.absolutePath, context)
  if (extname(output.absolutePath).toLowerCase() !== '.pptx') return { error: 'output_path must end in .pptx' }
  await mkdir(dirname(output.absolutePath), { recursive: true })
  // Export to a unique sibling first. Verifying the final path alone can
  // mistake an older deck for a successful new export when the upstream
  // command exits without writing anything.
  const temporaryOutputPath = join(
    dirname(output.absolutePath),
    `.${basename(output.absolutePath, '.pptx')}.${randomUUID()}.tmp.pptx`
  )
  return {
    args: [script('svg_to_pptx.py'), project.absolutePath, '--output', temporaryOutputPath, '--quiet'],
    projectPath: project.absolutePath,
    outputPath: output.absolutePath,
    outputRelativePath: output.relativePath,
    temporaryOutputPath
  }
}

async function publishPresentation(temporaryPath: string, outputPath: string): Promise<void> {
  if (process.platform === 'win32') {
    // Windows rename does not reliably replace an existing destination.
    await copyFile(temporaryPath, outputPath)
    return
  }
  await rename(temporaryPath, outputPath)
}

function isPptMasterActive(context: ToolHostContext): boolean {
  return context.activeSkillIds?.includes('ppt-master') === true
}

/**
 * Never select a package by scanning workspace/global skill roots. A workspace
 * skill can be user supplied and must not gain an execution route by reusing
 * the PPT Master id. The installer owns this canonical, marker-verified copy.
 */
function resolveManagedPptMasterSkillDir(): string | null {
  const candidate = MANAGED_SKILL_DIR
  if (!existsSync(join(candidate, 'scripts', 'project_manager.py')) || !existsSync(pptMasterPython(candidate))) {
    return null
  }
  try {
    const metadata = JSON.parse(readFileSync(join(candidate, INSTALL_METADATA_FILE), 'utf8')) as {
      managedBy?: unknown
      version?: unknown
      archiveSha256?: unknown
    }
    return metadata.managedBy === MANAGED_BY &&
      metadata.version === MANAGED_VERSION &&
      metadata.archiveSha256 === MANAGED_ARCHIVE_SHA256
      ? candidate
      : null
  } catch {
    return null
  }
}

function pptMasterPython(skillDir: string): string {
  return process.platform === 'win32'
    ? join(skillDir, '.venv', 'Scripts', 'python.exe')
    : join(skillDir, '.venv', 'bin', 'python')
}

function isPptMasterAction(value: unknown): value is PptMasterAction {
  return value === 'init_project' || value === 'import_markdown' || value === 'validate' ||
    value === 'check_svg' || value === 'split_notes' || value === 'finalize' || value === 'export'
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function safeProjectName(value: unknown): string {
  const name = stringArg(value)
  return /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,80}$/u.test(name) ? name : ''
}

function isMarkdownPath(path: string): boolean {
  return ['.md', '.markdown'].includes(extname(path).toLowerCase())
}

function normalizedRelativePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

function isManagedProjectRoot(relativePath: string): boolean {
  return normalizedRelativePath(relativePath) === '.kun-presentations'
}

function isManagedProjectPath(relativePath: string): boolean {
  return normalizedRelativePath(relativePath).startsWith('.kun-presentations/')
}

function isPresentationOutputPath(relativePath: string): boolean {
  return normalizedRelativePath(relativePath).startsWith('presentations/')
}

function presentationApprovalKey(context: Pick<ToolHostContext, 'threadId' | 'turnId'>): string {
  return `${context.threadId}\u0000${context.turnId}`
}

function rememberPresentationApproval(context: ToolHostContext, token: string): void {
  const now = Date.now()
  for (const [key, value] of approvedPresentationTurns) {
    if (value.expiresAt <= now) approvedPresentationTurns.delete(key)
  }
  approvedPresentationTurns.set(presentationApprovalKey(context), {
    token,
    expiresAt: now + APPROVAL_TOKEN_TTL_MS
  })
  while (approvedPresentationTurns.size > MAX_REMEMBERED_APPROVALS) {
    const oldest = approvedPresentationTurns.keys().next().value
    if (oldest === undefined) break
    approvedPresentationTurns.delete(oldest)
  }
}

function hasPresentationApproval(context: ToolHostContext, token: string): boolean {
  const key = presentationApprovalKey(context)
  const approval = approvedPresentationTurns.get(key)
  if (!approval || approval.expiresAt <= Date.now()) {
    approvedPresentationTurns.delete(key)
    return false
  }
  return token.length > 0 && token === approval.token
}

function positiveIntegerArg(value: unknown, fallback: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return fallback
  return Math.min(value, maximum)
}

function selectGuideLines(lines: string[], startIndex: number, maxLines: number): {
  lines: string[]
  truncated: boolean
} {
  const selected: string[] = []
  let bytes = 0
  const endIndex = Math.min(lines.length, startIndex + maxLines)
  for (let index = startIndex; index < endIndex; index += 1) {
    const line = lines[index] ?? ''
    const nextBytes = Buffer.byteLength(`${selected.length > 0 ? '\n' : ''}${line}`, 'utf8')
    if (bytes + nextBytes > MAX_GUIDE_OUTPUT_BYTES) {
      if (selected.length === 0) {
        throw new Error(`requested guide line exceeds the ${MAX_GUIDE_OUTPUT_BYTES} byte output limit`)
      }
      return { lines: selected, truncated: true }
    }
    selected.push(line)
    bytes += nextBytes
  }
  return { lines: selected, truncated: endIndex < lines.length }
}

async function readPptMasterGuide(skillDir: string, requestedPath: string): Promise<{
  relativePath: string
  content: string
}> {
  if (isAbsolute(requestedPath)) throw new Error('guide path must be relative to the PPT Master package')
  const extension = extname(requestedPath).toLowerCase()
  const normalized = normalizedRelativePath(requestedPath)
  if (normalized !== 'PPT_MASTER_UPSTREAM.md' && !['workflows/', 'references/', 'templates/'].some((prefix) => normalized.startsWith(prefix))) {
    throw new Error('guide path must be part of the PPT Master guide, workflow, reference, or template documentation')
  }
  if (!['.md', '.markdown', '.txt'].includes(extension)) {
    throw new Error('only Markdown and text guide files can be read')
  }
  const packageRoot = await realpath(skillDir)
  const lexicalPath = resolve(packageRoot, requestedPath)
  if (!isInside(packageRoot, lexicalPath)) throw new Error('guide path escapes the PPT Master package')
  const guidePath = await realpath(lexicalPath)
  if (!isInside(packageRoot, guidePath)) throw new Error('guide path resolves outside the PPT Master package')
  const details = await stat(guidePath)
  if (!details.isFile()) throw new Error('guide path must be a regular file')
  if (details.size > MAX_GUIDE_BYTES) throw new Error('guide file exceeds the 512 KB read limit')
  return {
    relativePath: normalizedRelativePath(relative(packageRoot, guidePath)),
    content: await readFile(guidePath, 'utf8')
  }
}

function isInside(root: string, target: string): boolean {
  const result = relative(root, target)
  return result === '' || (result !== '..' && !result.startsWith(`..${sep}`) && !isAbsolute(result))
}

function projectPathFromOutput(output: string): string | undefined {
  const match = output.match(/(?:Project created:|Project initialized:)\s*(.+)/i)
  return match?.[1]?.trim()
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function isNonEmptyFile(path: string): Promise<boolean> {
  try {
    const details = await stat(path)
    return details.isFile() && details.size > 0
  } catch {
    return false
  }
}

async function runPython(
  python: string,
  args: string[],
  cwd: string,
  abortSignal: AbortSignal
): Promise<ProcessResult> {
  return new Promise((resolveResult) => {
    let output = ''
    let settled = false
    const append = (chunk: Buffer): void => {
      if (output.length >= MAX_OUTPUT_CHARS) return
      output += chunk.toString('utf8').slice(0, MAX_OUTPUT_CHARS - output.length)
    }
    let child: ChildProcess | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: () => void = () => undefined
    const settle = (exitCode: number, extraOutput = ''): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      abortSignal.removeEventListener('abort', abort)
      resolveResult({ exitCode, output: `${output}${extraOutput}`.trim() })
    }
    abort = (): void => {
      child?.kill()
      settle(-1, '\nPPT Master command was cancelled.')
    }
    if (abortSignal.aborted) {
      settle(-1, 'PPT Master command was cancelled.')
      return
    }
    try {
      const spawned = spawn(python, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      child = spawned
      abortSignal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => {
        child?.kill()
        settle(-1, '\nPPT Master command timed out.')
      }, DEFAULT_TIMEOUT_SECONDS * 1_000)
      spawned.stdout.on('data', append)
      spawned.stderr.on('data', append)
      spawned.once('error', (error) => {
        settle(-1, error.message)
      })
      spawned.once('close', (code) => {
        settle(code ?? -1)
      })
    } catch (error) {
      settle(-1, error instanceof Error ? error.message : String(error))
      return
    }
  })
}
