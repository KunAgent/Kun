import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ToolApprovalDecision } from './sdk-options-builder.js'
import type { SdkTurnContext } from './agent-sdk-runtime-contracts.js'

const SDK_COMMAND_TOOLS = new Set(['Bash'])
const SDK_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const SDK_READ_PATH_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead'])
const SDK_NON_PATH_TOOLS = new Set(['WebSearch', 'WebFetch', 'TodoWrite'])
const KUN_BRIDGED_TOOL_PREFIX = 'mcp__kun__'

export function decideSdkBuiltinSandbox(
  toolName: string,
  input: Record<string, unknown>,
  context: Pick<SdkTurnContext, 'workspace' | 'additionalWorkspaces' | 'sandboxMode' | 'planMode' | 'allowSdkBuiltins'>
): ToolApprovalDecision | null {
  if (context.planMode && !toolName.startsWith(KUN_BRIDGED_TOOL_PREFIX)) {
    return denySandbox(`tool ${toolName} is blocked because Plan mode only allows Kun-gated read-only tools and create_plan`)
  }
  if (context.allowSdkBuiltins === false && !toolName.startsWith(KUN_BRIDGED_TOOL_PREFIX)) {
    return denySandbox(`tool ${toolName} is blocked; this turn only allows Kun-gated tools`)
  }
  const mode = context.sandboxMode ?? 'danger-full-access'
  if (!isKnownSdkTool(toolName)) {
    return denySandbox(`tool ${toolName} is blocked because it is not in kun's SDK tool allowlist`)
  }
  if (mode === 'danger-full-access') return null

  if (SDK_COMMAND_TOOLS.has(toolName)) {
    if (mode === 'workspace-write') return null
    return denySandbox(`tool ${toolName} is blocked because the "${mode}" sandbox mode does not run host shell commands`)
  }

  if (SDK_WRITE_TOOLS.has(toolName)) {
    if (mode === 'read-only') return denySandbox(`tool ${toolName} is blocked by the read-only sandbox`)
    if (mode === 'external-sandbox') {
      return denySandbox(`tool ${toolName} is blocked because external-sandbox does not allow SDK file mutation`)
    }
    const path = sdkInputPath(input)
    if (!path) return denySandbox(`tool ${toolName} is blocked because no workspace path was provided`)
    if (!isPathInsideAnyWorkspace(path, context.workspace, context.additionalWorkspaces)) {
      return denySandbox(`tool ${toolName} is limited to the workspace sandbox: ${path}`)
    }
  }

  if (SDK_READ_PATH_TOOLS.has(toolName)) {
    // Glob defaults `path` to the SDK cwd, but its required `pattern` can
    // itself carry an absolute path or `..` traversal. Treat it as a path
    // selector before accepting the otherwise cwd-scoped request.
    if (toolName === 'Glob' && !isWorkspaceGlobPattern(input.pattern)) {
      return denySandbox(`tool ${toolName} is limited to workspace glob patterns`)
    }
    const path = sdkInputPath(input)
    if (!path && toolName === 'Read') {
      return denySandbox(`tool ${toolName} is blocked because no workspace path was provided`)
    }
    if (path && !isPathInsideAnyWorkspace(path, context.workspace, context.additionalWorkspaces)) {
      return denySandbox(`tool ${toolName} is limited to workspace paths: ${path}`)
    }
  }

  return null
}

function isPathInsideAnyWorkspace(
  path: string,
  workspace: string,
  additionalWorkspaces: readonly string[] | undefined
): boolean {
  if (isPathInsideWorkspace(path, workspace)) return true
  return (additionalWorkspaces ?? []).some((root) => existsSync(workspaceAbsoluteRoot(root)) && isPathInsideWorkspace(path, root))
}

function workspaceAbsoluteRoot(workspace: string): string {
  return isAbsolute(workspace) ? resolve(workspace) : resolve(process.cwd(), workspace)
}

function denySandbox(message: string): ToolApprovalDecision {
  return { allow: false, message }
}

function isKnownSdkTool(toolName: string): boolean {
  return SDK_COMMAND_TOOLS.has(toolName) ||
    SDK_WRITE_TOOLS.has(toolName) ||
    SDK_READ_PATH_TOOLS.has(toolName) ||
    SDK_NON_PATH_TOOLS.has(toolName) ||
    toolName.startsWith(KUN_BRIDGED_TOOL_PREFIX)
}

function sdkInputPath(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'path', 'notebook_path']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function isWorkspaceGlobPattern(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  const pattern = value.trim()
  // Check both host-native and Windows/UNC absolute forms. A persisted SDK
  // transcript can be replayed on another platform, so native isAbsolute()
  // alone is not sufficient for rejecting a dangerous path selector.
  if (isAbsolute(pattern) || /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(pattern)) return false
  // Glob supports braces, so reject traversal segments both as path components
  // and as alternatives such as `{src,..}`. A literal `foo..bar` remains valid.
  return !/(^|[\\/{,])\.\.(?=$|[\\/},])/.test(pattern)
}

function isPathInsideWorkspace(inputPath: string, workspace: string): boolean {
  const configuredRoot = workspace.trim()
  if (!configuredRoot) return false

  try {
    const lexicalRoot = isAbsolute(configuredRoot)
      ? resolve(configuredRoot)
      : resolve(process.cwd(), configuredRoot)
    const lexicalCandidate = isAbsolute(inputPath) ? resolve(inputPath) : resolve(lexicalRoot, inputPath)
    if (!isDescendantOrSame(lexicalRoot, lexicalCandidate)) return false

    // A missing cwd will be rejected by the SDK before any tool executes. Keep
    // the lexical check for that invalid configuration, while requiring real
    // filesystem containment whenever the workspace exists.
    if (!existsSync(lexicalRoot)) return true

    const root = realpathSync(lexicalRoot)
    const candidate = isAbsolute(inputPath) ? resolve(inputPath) : resolve(root, inputPath)
    if (!isDescendantOrSame(root, candidate)) return false

    // `resolve` only proves lexical containment. Resolve the deepest existing
    // parent too, so `/workspace/link/outside.txt` cannot escape through a
    // symlink when the final file does not exist yet.
    const existingParent = deepestExistingParent(candidate)
    return existingParent !== null && isDescendantOrSame(root, existingParent)
  } catch {
    return false
  }
}

function deepestExistingParent(path: string): string | null {
  let probe = path
  const missing: string[] = []
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) return null
    missing.unshift(basename(probe))
    probe = parent
  }
  const realParent = realpathSync(probe)
  return missing.length > 0 ? join(realParent, ...missing) : realParent
}

function isDescendantOrSame(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}
