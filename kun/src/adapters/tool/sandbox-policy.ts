import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
  DEFAULT_SANDBOX_MODE,
  SandboxModeSchema,
  type SandboxMode
} from '../../contracts/policy.js'
import type { ToolCallLike, ToolHostContext } from '../../ports/tool-host.js'
import type { LocalTool } from './local-tool-host.js'
import { workspaceRoot } from './builtin-tool-utils.js'

export type SandboxBlock = {
  code: 'sandbox_read_only' | 'sandbox_command_blocked' | 'sandbox_write_blocked'
  message: string
}

const PATH_ARGUMENT_NAMES = [
  'path',
  'filePath',
  'sourcePath',
  'targetPath',
  'outputPath',
  'destinationPath',
  'projectPath',
  'root'
] as const

/**
 * Returns the first lexical path that escapes the workspace for a file
 * mutation call. Symlink escapes remain fail-closed in resolveWorkspacePath;
 * this helper only decides whether an approval prompt is needed before the
 * tool is executed.
 */
export function externalPathForApproval(
  tool: Pick<LocalTool, 'toolKind'>,
  call: Pick<ToolCallLike, 'arguments'>,
  context: Pick<ToolHostContext, 'workspace' | 'sandboxMode'>
): string[] {
  if (tool.toolKind !== 'file_change' || effectiveSandboxMode(context) !== 'workspace-write') {
    return []
  }
  const root = workspaceRoot(context.workspace)
  const externalPaths: string[] = []
  for (const name of PATH_ARGUMENT_NAMES) {
    const value = call.arguments[name]
    if (typeof value !== 'string' || !value.trim()) continue
    const candidate = isAbsolute(value) ? resolve(value) : resolve(root, value)
    if (!isPathInsideOrEqual(root, candidate) && !externalPaths.some((path) => samePath(path, candidate))) {
      externalPaths.push(candidate)
    }
  }
  return externalPaths
}

export function effectiveSandboxMode(
  context?: Pick<ToolHostContext, 'sandboxMode'>
): SandboxMode {
  const parsed = SandboxModeSchema.safeParse(context?.sandboxMode)
  return parsed.success ? parsed.data : DEFAULT_SANDBOX_MODE
}

export function isToolAdvertisedInSandbox(
  tool: Pick<LocalTool, 'toolKind' | 'name'>,
  context?: Pick<ToolHostContext, 'sandboxMode'>
): boolean {
  if (!context) return true
  return sandboxBlockForTool(tool, context) === null
}

export function sandboxBlockForTool(
  tool: Pick<LocalTool, 'toolKind' | 'name'>,
  context: Pick<ToolHostContext, 'sandboxMode'>
): SandboxBlock | null {
  const mode = effectiveSandboxMode(context)
  if (mode === 'danger-full-access') return null
  if (isInteractiveGuiGateTool(tool.name)) return null

  if (tool.toolKind === 'file_change') {
    if (mode === 'workspace-write') return null
    return {
      code: mode === 'read-only' ? 'sandbox_read_only' : 'sandbox_write_blocked',
      message:
        mode === 'read-only'
          ? `tool ${tool.name} is blocked by the read-only sandbox`
          : `tool ${tool.name} is blocked because ${mode} does not allow in-process file mutation`
    }
  }

  if (tool.toolKind === 'command_execution') {
    return {
      code: 'sandbox_command_blocked',
      message:
        mode === 'read-only'
          ? `tool ${tool.name} is blocked by the read-only sandbox. To run terminal commands, set the sandbox mode to "danger-full-access" (Full access) in Settings → Agents.`
          : `tool ${tool.name} is blocked because the "${mode}" sandbox mode does not run host shell commands. To enable terminal commands, set the sandbox mode to "danger-full-access" (Full access) in Settings → Agents.`
    }
  }

  return null
}

export function canWritePath(
  absolutePath: string,
  context: Pick<ToolHostContext, 'workspace' | 'sandboxMode' | 'approvedExternalPaths'>
): { ok: true } | { ok: false; block: SandboxBlock } {
  const mode = effectiveSandboxMode(context)
  if (mode === 'danger-full-access') return { ok: true }
  if (mode === 'read-only') {
    return {
      ok: false,
      block: {
        code: 'sandbox_read_only',
        message: `writing is blocked by the read-only sandbox: ${absolutePath}`
      }
    }
  }
  if (mode === 'external-sandbox') {
    return {
      ok: false,
      block: {
        code: 'sandbox_write_blocked',
        message: `writing is blocked because external-sandbox is not enforced by in-process file tools: ${absolutePath}`
      }
    }
  }

  const root = workspaceRoot(context.workspace)
  const resolvedPath = isAbsolute(absolutePath) ? resolve(absolutePath) : resolve(root, absolutePath)
  if (isPathInsideOrEqual(root, resolvedPath)) return { ok: true }
  if (context.approvedExternalPaths?.some((path) => samePath(path, resolvedPath))) return { ok: true }
  return {
    ok: false,
    block: {
      code: 'sandbox_write_blocked',
      message: `writing is limited to the workspace sandbox: ${absolutePath}`
    }
  }
}

export function assertCanWritePath(
  absolutePath: string,
  context: Pick<ToolHostContext, 'workspace' | 'sandboxMode' | 'approvedExternalPaths'>
): void {
  const decision = canWritePath(absolutePath, context)
  if (!decision.ok) throw new Error(decision.block.message)
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => resolve(value).replace(/[\\/]+$/, '')
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function isPathInsideOrEqual(root: string, candidate: string): boolean {
  const rootPath = resolve(root)
  const candidatePath = resolve(candidate)
  const rel = relative(rootPath, candidatePath)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function isInteractiveGuiGateTool(toolName: string): boolean {
  return toolName === 'user_input' || toolName === 'request_user_input'
}
