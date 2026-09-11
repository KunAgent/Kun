import { lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  DEFAULT_INSTRUCTION_MAX_FILE_BYTES,
  DEFAULT_INSTRUCTION_MAX_TOTAL_BYTES,
  KUN_AGENTS_FILENAME
} from './instruction-runtime.js'

export const MAX_IMPORT_DEPTH = 4

export type ImportScope = 'workspace' | 'global'

export type SourceToolId =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'gemini'
  | 'copilot'
  | 'windsurf'
  | 'cline'
  | 'zed'
  | 'opencode'
  | 'kiro'

/**
 * One source location declared by an adapter. `relFile` is read directly;
 * `relDir` reads every file in that directory whose extension is in `exts`.
 * Paths are relative to the workspace root (workspace scope) or the home
 * directory (global scope).
 */
export type SourceFileSpec = {
  kind: string
  relFile?: string
  relDir?: string
  exts?: string[]
  resolveImports?: boolean
  stripFrontmatter?: boolean
}

export type SourceAdapter = {
  tool: SourceToolId
  label: string
  workspace: SourceFileSpec[]
  global: SourceFileSpec[]
}

export type DetectedSourceFile = {
  tool: SourceToolId
  scope: ImportScope
  kind: string
  path: string
  bytes: number
  spec: SourceFileSpec
}

export type ImportWarning =
  | { code: 'unresolved-import'; path: string; detail: string }
  | { code: 'import-cycle'; path: string }
  | { code: 'oversized-import'; path: string; bytes: number }
  | { code: 'identity-skip'; tool: SourceToolId; path: string }
  | { code: 'budget-exceeded'; target: string; bytes: number; limit: number }

export type ImportTargetPlan = {
  scope: ImportScope
  target: string
  tools: SourceToolId[]
  mergedText: string
  existingText: string
  changed: boolean
  finalBytes: number
}

export type ImportPlan = {
  targets: ImportTargetPlan[]
  warnings: ImportWarning[]
}

export type BuildImportPlanInput = {
  workspace: string
  homeDir: string
  adapters: SourceAdapter[]
  scopes: ImportScope[]
  /** Restrict to these tools; empty/undefined means every adapter. */
  tools?: SourceToolId[]
  maxFileBytes?: number
  maxTotalBytes?: number
}

const BEGIN = 'kun:import:begin'
const END = 'kun:import:end'

export function globalAgentsPath(homeDir: string): string {
  return join(homeDir, '.kun', KUN_AGENTS_FILENAME)
}

export function workspaceAgentsPath(workspace: string): string {
  return join(workspace, KUN_AGENTS_FILENAME)
}

function beginMarker(tool: SourceToolId): string {
  return `<!-- ${BEGIN} tool=${tool} -->`
}

function endMarker(tool: SourceToolId): string {
  return `<!-- ${END} tool=${tool} -->`
}

async function statSafe(path: string): Promise<{ isFile: boolean; bytes: number } | null> {
  try {
    const info = await stat(path)
    return { isFile: info.isFile(), bytes: info.size }
  } catch {
    return null
  }
}

function baseForScope(scope: ImportScope, workspace: string, homeDir: string): string {
  return scope === 'workspace' ? workspace : homeDir
}

/** Detect which declared source files exist, per tool and scope. Reads nothing beyond declared locations and mutates nothing. */
export async function detectImportSources(input: {
  workspace: string
  homeDir: string
  adapters: SourceAdapter[]
  scopes: ImportScope[]
  tools?: SourceToolId[]
}): Promise<DetectedSourceFile[]> {
  const { workspace, homeDir, adapters, scopes } = input
  const toolFilter = input.tools && input.tools.length > 0 ? new Set(input.tools) : null
  const found: DetectedSourceFile[] = []

  for (const adapter of adapters) {
    if (toolFilter && !toolFilter.has(adapter.tool)) continue
    for (const scope of scopes) {
      const base = baseForScope(scope, workspace, homeDir)
      const specs = scope === 'workspace' ? adapter.workspace : adapter.global
      for (const spec of specs) {
        for (const path of await expandSpec(base, spec)) {
          const info = await statSafe(path)
          if (!info || !info.isFile) continue
          found.push({ tool: adapter.tool, scope, kind: spec.kind, path, bytes: info.bytes, spec })
        }
      }
    }
  }
  return found
}

async function expandSpec(base: string, spec: SourceFileSpec): Promise<string[]> {
  if (spec.relFile) return [resolve(base, spec.relFile)]
  if (spec.relDir) {
    const dir = resolve(base, spec.relDir)
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return []
    }
    const exts = spec.exts ?? ['.md']
    return entries
      .filter((name) => exts.some((ext) => name.toLowerCase().endsWith(ext)))
      .sort()
      .map((name) => join(dir, name))
  }
  return []
}

function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/u.exec(text)
  return match ? text.slice(match[0].length) : text
}

function normalizeBody(text: string): string {
  return text
    .replace(/\r\n/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

type ResolveCtx = {
  homeDir: string
  visited: Set<string>
  warnings: ImportWarning[]
  maxFileBytes: number
}

const IMPORT_TOKEN = /(^|[^\w`@])@([^\s'"()]+)/gu

async function resolveClaudeImports(
  text: string,
  baseDir: string,
  depth: number,
  ctx: ResolveCtx
): Promise<string> {
  if (depth >= MAX_IMPORT_DEPTH) return text
  const matches = [...text.matchAll(IMPORT_TOKEN)]
  if (matches.length === 0) return text

  let out = ''
  let cursor = 0
  for (const match of matches) {
    const full = match[0]
    const lead = match[1] ?? ''
    const rawPath = match[2] ?? ''
    const start = match.index ?? 0
    out += text.slice(cursor, start) + lead
    cursor = start + full.length

    const looksLikePath = rawPath.includes('/') || rawPath.includes('\\')
    const resolved = resolveImportPath(rawPath, baseDir, ctx.homeDir)
    const info = await statSafe(resolved)
    if (!info || !info.isFile) {
      if (looksLikePath) ctx.warnings.push({ code: 'unresolved-import', path: resolved, detail: rawPath })
      out += `@${rawPath}`
      continue
    }
    if (info.bytes > ctx.maxFileBytes) {
      ctx.warnings.push({ code: 'oversized-import', path: resolved, bytes: info.bytes })
      out += `@${rawPath}`
      continue
    }
    let real = resolved
    try {
      real = await realpath(resolved)
    } catch {
      // fall back to resolved path for the cycle key
    }
    if (ctx.visited.has(real)) {
      ctx.warnings.push({ code: 'import-cycle', path: real })
      out += `<!-- kun-import: cycle skipped ${rawPath} -->`
      continue
    }
    ctx.visited.add(real)
    const nested = await resolveClaudeImports(await readFile(resolved, 'utf8'), dirname(resolved), depth + 1, ctx)
    ctx.visited.delete(real)
    out += `\n${normalizeBody(nested)}\n`
  }
  out += text.slice(cursor)
  return out
}

function resolveImportPath(rawPath: string, baseDir: string, homeDir: string): string {
  if (rawPath.startsWith('~/') || rawPath.startsWith('~\\')) return resolve(homeDir, rawPath.slice(2))
  if (isAbsolute(rawPath)) return rawPath
  return resolve(baseDir, rawPath)
}

async function renderSourceFile(source: DetectedSourceFile, ctx: ResolveCtx): Promise<string> {
  let text = await readFile(source.path, 'utf8')
  if (source.spec.stripFrontmatter) text = stripFrontmatter(text)
  if (source.spec.resolveImports) {
    ctx.visited.add(await realpath(source.path).catch(() => source.path))
    text = await resolveClaudeImports(text, dirname(source.path), 0, ctx)
  }
  return normalizeBody(text)
}

/** Replace the managed block for `tool`, appending a fresh block if none exists. Content outside markers is preserved verbatim. */
export function mergeManagedBlock(existing: string, tool: SourceToolId, blockBody: string): string {
  const begin = beginMarker(tool)
  const end = endMarker(tool)
  const block = `${begin}\n${blockBody}\n${end}`
  const pattern = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`, 'u')
  if (pattern.test(existing)) {
    return existing.replace(pattern, block)
  }
  const trimmed = existing.replace(/\s+$/u, '')
  return trimmed.length > 0 ? `${trimmed}\n\n${block}\n` : `${block}\n`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

async function readTargetText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

/** Pure-ish planning step: reads source files and produces the merged target text without writing anything. */
export async function buildImportPlan(input: BuildImportPlanInput): Promise<ImportPlan> {
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_INSTRUCTION_MAX_FILE_BYTES
  const maxTotalBytes = input.maxTotalBytes ?? DEFAULT_INSTRUCTION_MAX_TOTAL_BYTES
  const warnings: ImportWarning[] = []
  const detected = await detectImportSources({
    workspace: input.workspace,
    homeDir: input.homeDir,
    adapters: input.adapters,
    scopes: input.scopes,
    ...(input.tools ? { tools: input.tools } : {})
  })

  const targets: ImportTargetPlan[] = []
  for (const scope of input.scopes) {
    const target = scope === 'workspace'
      ? workspaceAgentsPath(input.workspace)
      : globalAgentsPath(input.homeDir)
    const existingText = await readTargetText(target)
    let mergedText = existingText
    const tools: SourceToolId[] = []

    for (const adapter of input.adapters) {
      const sources = detected.filter((source) => source.scope === scope && source.tool === adapter.tool)
      if (sources.length === 0) continue
      const parts: string[] = []
      for (const source of sources) {
        // A source that resolves to the target file itself is an identity import (e.g. Codex workspace AGENTS.md).
        if (resolve(source.path) === resolve(target)) {
          warnings.push({ code: 'identity-skip', tool: source.tool, path: source.path })
          continue
        }
        const ctx: ResolveCtx = { homeDir: input.homeDir, visited: new Set(), warnings, maxFileBytes }
        const body = await renderSourceFile(source, ctx)
        if (body.length > 0) parts.push(`<!-- from: ${source.kind} -->\n${body}`)
      }
      if (parts.length === 0) continue
      mergedText = mergeManagedBlock(mergedText, adapter.tool, parts.join('\n\n'))
      tools.push(adapter.tool)
    }

    const finalBytes = Buffer.byteLength(mergedText, 'utf8')
    if (finalBytes > maxFileBytes) {
      warnings.push({ code: 'budget-exceeded', target, bytes: finalBytes, limit: maxFileBytes })
    }
    targets.push({
      scope,
      target,
      tools,
      mergedText,
      existingText,
      changed: tools.length > 0 && mergedText !== existingText,
      finalBytes
    })
  }

  const totalBytes = targets.reduce((sum, plan) => sum + plan.finalBytes, 0)
  if (totalBytes > maxTotalBytes) {
    warnings.push({ code: 'budget-exceeded', target: '(all scopes)', bytes: totalBytes, limit: maxTotalBytes })
  }

  return { targets, warnings }
}

async function writeTextAtomically(path: string, content: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`)
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

async function assertSafeWorkspaceTarget(target: string, workspace: string): Promise<void> {
  const info = await lstat(target).catch(() => null)
  if (info?.isSymbolicLink()) throw new Error('workspace AGENTS.md must not be a symbolic link')
  const root = await realpath(workspace).catch(() => resolve(workspace))
  const parent = await realpath(dirname(target)).catch(() => resolve(dirname(target)))
  const rel = relative(root, parent)
  if (rel !== '' && (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    throw new Error('workspace AGENTS.md resolves outside the workspace')
  }
}

export type AppliedTarget = { scope: ImportScope; target: string; bytes: number }

/** Write the changed targets from a plan. Global writes create `~/.kun`; workspace writes refuse symlinks and out-of-root paths. */
export async function applyImportPlan(plan: ImportPlan, input: { workspace: string }): Promise<AppliedTarget[]> {
  const applied: AppliedTarget[] = []
  for (const targetPlan of plan.targets) {
    if (!targetPlan.changed) continue
    if (targetPlan.scope === 'workspace') {
      await assertSafeWorkspaceTarget(targetPlan.target, input.workspace)
    } else {
      await mkdir(dirname(targetPlan.target), { recursive: true })
    }
    await writeTextAtomically(targetPlan.target, targetPlan.mergedText)
    applied.push({ scope: targetPlan.scope, target: targetPlan.target, bytes: targetPlan.finalBytes })
  }
  return applied
}

export function describeWarning(warning: ImportWarning): string {
  switch (warning.code) {
    case 'unresolved-import':
      return `Unresolved @import "${warning.detail}" (${warning.path})`
    case 'import-cycle':
      return `Skipped @import cycle at ${warning.path}`
    case 'oversized-import':
      return `Skipped oversized @import (${warning.bytes} bytes) at ${warning.path}`
    case 'identity-skip':
      return `Skipped ${warning.tool} source identical to the target: ${warning.path}`
    case 'budget-exceeded':
      return `Instruction budget exceeded for ${warning.target}: ${warning.bytes} > ${warning.limit} bytes`
  }
}

export function describeImportPlan(plan: ImportPlan): string[] {
  const lines: string[] = []
  for (const target of plan.targets) {
    const state = target.changed ? `${target.finalBytes} bytes` : 'no change'
    const tools = target.tools.length > 0 ? target.tools.join(', ') : 'none'
    lines.push(`[${target.scope}] ${target.target}`)
    lines.push(`  tools: ${tools} · ${state}`)
  }
  if (plan.warnings.length > 0) {
    lines.push('', 'Warnings:')
    for (const warning of plan.warnings) lines.push(`  - ${describeWarning(warning)}`)
  }
  return lines
}
