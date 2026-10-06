import { constants, type Dirent } from 'node:fs'
import { open, readdir, realpath, type FileHandle } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  SUBAGENT_READ_ONLY_TOOL_NAMES,
  SubagentProfileConfig,
  SubagentSurface,
  type SubagentMode,
  type SubagentToolPolicy
} from '../contracts/capabilities.js'

/**
 * Workspace-level agent overlay.
 *
 * Loads `<workspace>/.kun/agents/*.md` and produces a profile map that
 * the delegation runtime overlays on top of (`internal < GUI < workspace`).
 * Frontmatter format:
 *
 *     ---
 *     id: code-reviewer       # optional, defaults to filename stem
 *     name: Code Reviewer
 *     description: One-line "when to use"
 *     mode: subagent          # subagent | primary | all
 *     surfaces: [code, write] # shared | code | write | design
 *     toolPolicy: readOnly    # default readOnly; set inherit for write tools
 *     allowedTools: [read, grep]
 *     omit_base_prompt: false # when true, role prompt replaces Kun base
 *     color: "#3b82f6"
 *     harness: claude-code    # optional ADE worker binding (10 §3.1)
 *     credential-mode: native-login   # optional harness credential path
 *     delegation-notes: use for code review on changed files
 *     model: claude-sonnet-5        # optional harness model pin
 *     ---
 *     Body becomes the systemPrompt verbatim (kun's base prompt is
 *     prepended unless omit_base_prompt: true).
 *
 * Workspace roles enter automatic BM25/LLM routing (indexed by id/name/
 * description/delegation-notes only — body is never searchable). They may
 * opt into `toolPolicy: inherit` for write tools under the parent capability
 * snapshot. They cannot choose a provider/reasoning level,
 * cannot load skills, and cannot nest `delegate_task` / `generate_subagent`.
 * Files with invalid frontmatter are dropped silently so a single broken
 * file doesn't take down delegation.
 */
export type WorkspaceAgentProfile = {
  id: string
  source: 'workspace'
  filePath: string
  /** Distinguishes an omitted surface field from an explicit declaration. */
  surfacesDeclared: boolean
  profile: SubagentProfileConfig
}

export type WorkspaceAgentCatalogProfile = {
  id: string
  source: 'workspace'
  filePath: string
  name?: string
  description?: string
  mode: SubagentMode
  toolPolicy: SubagentToolPolicy
  color?: string
  systemPrompt?: string
  promptPreamble?: string
  allowedTools?: string[]
  blockedTools?: string[]
  omitBasePrompt?: boolean
  surfaces?: NonNullable<SubagentProfileConfig['surfaces']>
  harnessId?: SubagentProfileConfig['harnessId']
  credentialMode?: SubagentProfileConfig['credentialMode']
  gatewayBinding?: SubagentProfileConfig['gatewayBinding']
  delegationNotes?: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const MAX_WORKSPACE_AGENT_FILES = 32
const MAX_WORKSPACE_AGENT_FILE_BYTES = 64 * 1024
const WORKSPACE_AGENT_LOCAL_READ_TOOLS = ['read', 'grep', 'glob', 'ls', 'repo_map'] as const

export async function loadWorkspaceAgentProfiles(workspace: string): Promise<WorkspaceAgentProfile[]> {
  if (!workspace) return []
  const workspaceRoot = resolve(workspace)
  const dir = join(workspaceRoot, '.kun', 'agents')
  let resolvedWorkspace: string
  let resolvedDir: string
  try {
    [resolvedWorkspace, resolvedDir] = await Promise.all([realpath(workspaceRoot), realpath(dir)])
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') return []
    throw error
  }
  if (!isPathInside(resolvedWorkspace, resolvedDir)) return []

  let entries: Dirent<string>[]
  try {
    entries = await readdir(resolvedDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') return []
    throw error
  }
  const results: WorkspaceAgentProfile[] = []
  for (const entry of entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_WORKSPACE_AGENT_FILES)) {
    const filePath = join(resolvedDir, entry.name)
    try {
      const text = await readWorkspaceAgentFile(filePath)
      if (text === null) continue
      const parsed = parseAgentMarkdown(text, entry.name.replace(/\.md$/i, ''))
      if (parsed) results.push({ ...parsed, filePath, source: 'workspace' })
    } catch {
      // Skip unreadable / malformed files; do not bubble — overlay should
      // never break the parent delegate_task call.
    }
  }
  return results
}

/** Renderer-facing workspace roster with configured surface fallback applied. */
export async function loadWorkspaceAgentCatalogProfiles(
  workspace: string,
  configuredProfiles: Readonly<Record<string, SubagentProfileConfig>>
): Promise<WorkspaceAgentCatalogProfile[]> {
  const overlay = await loadWorkspaceAgentProfiles(workspace)
  return overlay.map((entry) => {
    const profile = applyWorkspaceAgentSurfaceFallback(entry, configuredProfiles[entry.id])
    return {
      id: entry.id,
      source: 'workspace',
      filePath: entry.filePath,
      ...(profile.name ? { name: profile.name } : {}),
      ...(profile.description ? { description: profile.description } : {}),
      mode: profile.mode,
      toolPolicy: profile.toolPolicy,
      ...(profile.surfaces ? { surfaces: profile.surfaces } : {}),
      ...(profile.color ? { color: profile.color } : {}),
      ...(profile.systemPrompt ? { systemPrompt: profile.systemPrompt } : {}),
      ...(profile.promptPreamble ? { promptPreamble: profile.promptPreamble } : {}),
      ...(profile.allowedTools ? { allowedTools: profile.allowedTools } : {}),
      ...(profile.blockedTools ? { blockedTools: profile.blockedTools } : {}),
      ...(profile.omitBasePrompt ? { omitBasePrompt: true } : {}),
      ...(profile.harnessId ? { harnessId: profile.harnessId } : {}),
      ...(profile.credentialMode ? { credentialMode: profile.credentialMode } : {}),
      ...(profile.gatewayBinding ? { gatewayBinding: profile.gatewayBinding } : {}),
      ...(profile.delegationNotes ? { delegationNotes: profile.delegationNotes } : {})
    }
  })
}

async function readWorkspaceAgentFile(path: string): Promise<string | null> {
  let handle: FileHandle | undefined
  try {
    handle = await open(
      path,
      process.platform === 'win32'
        ? constants.O_RDONLY
        : constants.O_RDONLY | constants.O_NOFOLLOW
    )
    const fileStat = await handle.stat()
    if (!fileStat.isFile() || fileStat.size > MAX_WORKSPACE_AGENT_FILE_BYTES) return null
    const buffer = Buffer.allocUnsafe(MAX_WORKSPACE_AGENT_FILE_BYTES + 1)
    let offset = 0
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    // A growing file cannot bypass the stat precheck and turn an overlay scan
    // into an unbounded read. Do not parse truncated configuration.
    if (offset > MAX_WORKSPACE_AGENT_FILE_BYTES) return null
    return buffer.subarray(0, offset).toString('utf8')
  } catch {
    return null
  } finally {
    if (handle) await handle.close().catch(() => undefined)
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function parseAgentMarkdown(text: string, defaultId: string): {
  id: string
  surfacesDeclared: boolean
  profile: SubagentProfileConfig
} | null {
  const match = FRONTMATTER_RE.exec(text)
  if (!match) return null
  const yamlRaw = match[1] ?? ''
  const body = text.slice(match[0].length).trim()
  const fields = parseSimpleYaml(yamlRaw)
  const id = fields.id?.trim() || defaultId
  if (!id) return null
  const omitBase = boolField(fields, 'omit_base_prompt') === true || boolField(fields, 'omitBasePrompt') === true
  const systemPromptFromBody = body || undefined
  const toolPolicy = normalizeToolPolicy(fields.toolPolicy)
  const surfaceValues = parseListField(fields, 'surfaces') ??
    (/^\[\s*\]$/.test(fields.surfaces?.trim() ?? '') ? [] : undefined)
  const surfaces = surfaceValues
    ? SubagentSurface.array().max(4).safeParse(surfaceValues)
    : undefined
  if (surfaces && !surfaces.success) return null
  const requestedAllowedTools = parseListField(fields, 'allowedTools')
  const safeReadOnlyTools = new Set<string>(SUBAGENT_READ_ONLY_TOOL_NAMES)
  const localReadTools = new Set<string>(WORKSPACE_AGENT_LOCAL_READ_TOOLS)
  const allowedTools = toolPolicy === 'readOnly'
    ? (requestedAllowedTools ?? WORKSPACE_AGENT_LOCAL_READ_TOOLS)
      .filter((tool) => safeReadOnlyTools.has(tool) && localReadTools.has(tool))
    : requestedAllowedTools
  const raw: Record<string, unknown> = {
    ...(fields.name ? { name: fields.name } : {}),
    ...(fields.description ? { description: fields.description } : {}),
    ...(fields.color ? { color: fields.color } : {}),
    mode: normalizeMode(fields.mode),
    // A new workspace-only agent is code-scoped unless it explicitly opts
    // into another product surface. Same-id overlays may inherit the
    // configured profile's surface later in the runtime merge.
    surfaces: surfaces?.data ?? ['code'],
    ...(fields.systemPrompt ? { systemPrompt: fields.systemPrompt } : systemPromptFromBody ? { systemPrompt: systemPromptFromBody } : {}),
    ...(omitBase ? { omitBasePrompt: true } : {}),
    ...(fields.promptPreamble ? { promptPreamble: fields.promptPreamble } : {}),
    toolPolicy,
    ...(toolPolicy === 'readOnly'
      ? { allowedTools: (allowedTools && allowedTools.length)
        ? allowedTools
        : [...WORKSPACE_AGENT_LOCAL_READ_TOOLS] }
      : allowedTools && allowedTools.length ? { allowedTools } : {}),
    blockedTools: [...new Set([
      'delegate_task',
      'generate_subagent',
      'load_skill',
      ...(parseListField(fields, 'blockedTools') ?? [])
    ])],
    ...(parseListField(fields, 'blockedMcpServers') ? { blockedMcpServers: parseListField(fields, 'blockedMcpServers') } : {}),
    ...(parseListField(fields, 'blockedSkills') ? { blockedSkills: parseListField(fields, 'blockedSkills') } : {}),
    skillsEnabled: false
  }
  // ADE worker binding (10 §3.1): a workspace role may pin the harness and
  // model it dispatches onto; the credential path defaults to the harness's.
  // `model` only applies alongside a harness pin — on the native Kun loop a
  // workspace role still cannot choose a model/provider/reasoning level.
  const harnessId = (fields.harness ?? fields.harnessId)?.trim()
  if (harnessId) {
    raw.harnessId = harnessId
    if (fields.model?.trim()) raw.model = fields.model.trim()
  }
  const credentialMode = (fields['credential-mode'] ?? fields.credentialMode)?.trim()
  if (credentialMode) raw.credentialMode = credentialMode
  const gatewayBinding = fields['gateway-binding'] ?? fields.gatewayBinding
  if (gatewayBinding && harnessId) { try { raw.gatewayBinding = JSON.parse(gatewayBinding) } catch { raw.gatewayBinding = gatewayBinding } }
  const delegationNotes = (fields['delegation-notes'] ?? fields.delegationNotes)?.trim()
  if (delegationNotes) raw.delegationNotes = delegationNotes
  const parsed = SubagentProfileConfig.safeParse(raw)
  if (!parsed.success) return null
  return { id, surfacesDeclared: Boolean(surfaceValues), profile: parsed.data }
}

/** Preserve configured visibility when a same-id workspace overlay omits surfaces. */
export function applyWorkspaceAgentSurfaceFallback(
  entry: WorkspaceAgentProfile,
  configured: SubagentProfileConfig | undefined
): SubagentProfileConfig {
  if (entry.surfacesDeclared || !configured) return entry.profile
  return {
    ...entry.profile,
    surfaces: configured.surfaces ?? ['shared']
  }
}

function normalizeMode(value: string | undefined): SubagentMode {
  if (value === 'primary' || value === 'all') return value
  return 'subagent'
}

function normalizeToolPolicy(value: string | undefined): SubagentToolPolicy {
  return value === 'inherit' ? 'inherit' : 'readOnly'
}

function boolField(fields: Record<string, string>, key: string): boolean | undefined {
  const raw = fields[key]?.trim().toLowerCase()
  if (raw === 'true' || raw === 'yes') return true
  if (raw === 'false' || raw === 'no') return false
  return undefined
}

function parseListField(fields: Record<string, string>, key: string): string[] | undefined {
  const raw = fields[key]?.trim()
  if (!raw) return undefined
  // Support both inline `[a, b, c]` and comma-separated `a, b, c`.
  const stripped = raw.replace(/^\[/, '').replace(/\]$/, '')
  const items = stripped.split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .slice(0, 32)
  return items.length ? items : undefined
}

/**
 * Lean YAML key:value parser. Only supports flat scalars, lists, and
 * double-quoted strings — sufficient for agent frontmatter without pulling
 * in a YAML dependency.
 */
function parseSimpleYaml(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim()
    if (!line || line.startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    let value = line.slice(colon + 1).trim()
    if (!key) continue
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
    result[key] = value
  }
  return result
}
