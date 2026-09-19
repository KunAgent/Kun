import { runOwnedCommand } from './owned-command'
import { compileFunction, runInNewContext } from 'node:vm'
import {
  resolveWindowsGitBashCandidates,
  type WindowsShellResolverOptions
} from '../../kun/src/adapters/tool/windows-shell-resolver.js'
import type {
  WorkflowCodeCheckResult,
  WorkflowCodeLanguage,
  WorkflowCustomModuleV1,
  WorkflowNodeV1
} from '../shared/app-settings'
import { safeJson, type WorkflowPayload } from './workflow-expression'
import type { WorkflowNodeOutcome } from './workflow-core-node-adapter'

type CodeNode = Extract<WorkflowNodeV1, { type: 'code' }>
type CustomNode = Extract<WorkflowNodeV1, { type: 'custom' }>

const CODE_TIMEOUT_MS = 2_000
/** Python/bash scripts may do real work, so they get longer than the JS sandbox. */
const COMMAND_TIMEOUT_MS = 30_000
const PYTHON_BIN = process.env.WORKFLOW_PYTHON_BIN?.trim() || 'python3'

export function resolveWorkflowBashBin(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  options: Omit<WindowsShellResolverOptions, 'env'> = {}
): string {
  const configured = env.WORKFLOW_BASH_BIN?.trim()
  if (configured) return configured
  if (platform !== 'win32') return 'bash'
  return resolveWindowsGitBashCandidates({ ...options, env })[0]?.file ?? 'bash'
}

const BASH_BIN = resolveWorkflowBashBin()

export function executeCodeWorkflowNode(input: {
  node: CodeNode
  payload: WorkflowPayload
  signal?: AbortSignal
}): Promise<WorkflowNodeOutcome> {
  const { node, payload } = input
  return node.config.language === 'python' || node.config.language === 'bash'
    ? runCommandNode(node.config.language, node.config.code, payload, {}, input.signal)
    : Promise.resolve(runJavascriptNode(node.config.code, payload))
}

export function executeCustomWorkflowNode(input: {
  node: CustomNode
  payload: WorkflowPayload
  modules: readonly WorkflowCustomModuleV1[]
  signal?: AbortSignal
}): Promise<WorkflowNodeOutcome> {
  const module = input.modules.find((item) => item.id === input.node.config.moduleId)
  if (!module) return Promise.reject(new Error('Custom module not found — it may have been deleted.'))
  const fields = coerceModuleFields(module, input.node.config.values)
  return module.language === 'python' || module.language === 'bash'
    ? runCommandNode(module.language, module.code, input.payload, fields, input.signal)
    : Promise.resolve(runJavascriptNode(module.code, input.payload, fields))
}

function runJavascriptNode(
  code: string,
  payload: WorkflowPayload,
  fields: Record<string, unknown> = {}
): WorkflowNodeOutcome {
  const sandbox: Record<string, unknown> = {
    $json: payload.json,
    $text: payload.text,
    $fields: fields,
    __result: undefined
  }
  try {
    runInNewContext(`__result = (function(){\n${code}\n})()`, sandbox, {
      timeout: CODE_TIMEOUT_MS,
      displayErrors: true
    })
  } catch (error) {
    throw new Error(`Code error: ${error instanceof Error ? error.message : String(error)}`)
  }
  const out = sandbox.__result
  if (out === undefined || out === null) return { payload: { json: {}, text: '' }, message: 'ok' }
  if (typeof out === 'string') return { payload: { json: { value: out }, text: out }, message: 'ok' }
  const json = typeof out === 'object' ? out : { value: out }
  return { payload: { json, text: safeJson(json) }, message: 'ok' }
}

async function runCommandNode(
  language: 'python' | 'bash',
  code: string,
  payload: WorkflowPayload,
  fields: Record<string, unknown> = {},
  signal?: AbortSignal
): Promise<WorkflowNodeOutcome> {
  if (signal?.aborted) return Promise.reject(new Error('Workflow canceled.'))
  const bin = language === 'python' ? PYTHON_BIN : BASH_BIN
  const result = await runOwnedCommand(bin, ['-c', code], {
    env: {
      ...process.env,
      ...(process.platform === 'win32' && language === 'bash' ? { CHERE_INVOKING: '1' } : {}),
      WORKFLOW_TEXT: payload.text ?? '', WORKFLOW_JSON: safeJson(payload.json), WORKFLOW_FIELDS: safeJson(fields)
    },
    input: JSON.stringify({ json: payload.json, text: payload.text }), signal, timeoutMs: COMMAND_TIMEOUT_MS,
    messages: { aborted: 'Workflow canceled.', timeout: `${language} script timed out after ${COMMAND_TIMEOUT_MS}ms` }
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new Error(`${language} error: ${bin} was not found on this machine`)
    throw error
  })
  if (result.exitCode !== 0) {
    throw new Error(`${language} exited with code ${result.exitCode}: ${(result.stderr || result.stdout).trim().slice(0, 500)}`)
  }
  const out = result.stdout.trim()
  let parsed: unknown
  try { parsed = out ? JSON.parse(out) : undefined } catch { parsed = undefined }
  return parsed !== null && typeof parsed === 'object'
    ? { payload: { json: parsed, text: out }, message: 'ok' }
    : { payload: { json: out ? { text: out } : {}, text: out }, message: 'ok' }
}

/** Coerce a custom node's stored string values into typed $fields for its module. */
function coerceModuleFields(
  module: WorkflowCustomModuleV1,
  values: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of module.fields) {
    const raw = values[field.key] ?? field.defaultValue ?? ''
    if (field.type === 'number') out[field.key] = raw === '' ? 0 : Number(raw) || 0
    else if (field.type === 'boolean') out[field.key] = raw === 'true' || raw === '1'
    else out[field.key] = raw
  }
  return out
}

/** Syntax-check a Code node without executing user code. */
export async function checkWorkflowCode(
  language: WorkflowCodeLanguage,
  code: string
): Promise<WorkflowCodeCheckResult> {
  if (!code.trim()) return Promise.resolve({ status: 'ok' })
  if (language === 'javascript') {
    try {
      compileFunction(code, ['$json', '$text'])
      return Promise.resolve({ status: 'ok' })
    } catch (error) {
      return Promise.resolve({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }
  const bin = language === 'python' ? PYTHON_BIN : BASH_BIN
  const args = language === 'python' ? ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'] : ['-n']
  try {
    const result = await runOwnedCommand(bin, args, {
      env: { ...process.env, ...(process.platform === 'win32' && language === 'bash' ? { CHERE_INVOKING: '1' } : {}) },
      input: code, timeoutMs: 8000, messages: { timeout: 'Syntax check timed out.' }
    })
    return result.exitCode === 0 ? { status: 'ok' }
      : { status: 'error', message: result.stderr.trim().slice(0, 800) || `Exited with code ${result.exitCode}.` }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { status: 'unavailable', message: `${bin} was not found — cannot check ${language} syntax.` }
      : { status: 'error', message: error instanceof Error ? error.message : String(error) }
  }

}
