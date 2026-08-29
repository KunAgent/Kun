import { constants, type Dirent } from 'node:fs'
import { open, readdir, realpath, stat, type FileHandle } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import type { SkillsCapabilityConfig } from '../contracts/capabilities.js'
import {
  loadKunProjectConfig,
  type KunProjectConfigLoadResult
} from '../config/project-config.js'

import {
  MAX_SKILL_ENTRY_BYTES,
  MAX_SKILL_MANIFEST_BYTES,
  MAX_SKILL_PACKAGES_PER_ROOT,
  SkillManifest,
  WORKSPACE_SKILL_RELATIVE_DIRS
} from './skill-runtime-contracts.js'
import type {
  LoadedSkill,
  SkillActivation,
  SkillTurnResolution
} from './skill-runtime-contracts.js'

export function skillsRuntimeEnabled(config: SkillsCapabilityConfig): boolean {
  return config.enabled || config.projectConfigEnabled === true
}

export function uniqueRoots(roots: string[]): string[] {
  return [...new Set(roots.map(normalizeRoot).filter(Boolean))]
}

export function uniqueValidationErrors(
  errors: Array<{ root: string; message: string }>
): Array<{ root: string; message: string }> {
  const seen = new Set<string>()
  return errors.filter((error) => {
    const key = `${error.root}\0${error.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function renderCatalogInstruction(skills: LoadedSkill[], budget: number): string | undefined {
  if (skills.length === 0) return undefined
  const header = '## Skills\n' +
    'A skill is a reusable set of instructions stored on disk. The skills below ' +
    'are available in this workspace. When a user request matches one, read its ' +
    '`SKILL.md` (the file path is listed) before acting, then follow it.'
  const footer = '### How to use skills\n' +
    '- A skill activates automatically when the user mentions it by id ' +
    '(`$id`, `@id`, or `/skill:id`) or trips one of its triggers; its full ' +
    'instructions are then injected for that turn.\n' +
    '- Otherwise, if a request clearly matches a skill above, call the ' +
    '`load_skill` tool with its id to pull the full instructions, then follow ' +
    'them. (You can also read the listed file directly.)'
  const lines: string[] = []
  let used = Buffer.byteLength(`${header}\n\n### Available skills\n\n${footer}`, 'utf8')
  let dropped = 0
  for (const skill of skills) {
    const desc = skill.description ? `: ${skill.description}` : ''
    const line = `- ${skill.name} (${skill.id})${desc} (file: ${skill.entryPath})`
    const cost = Buffer.byteLength(`${line}\n`, 'utf8')
    if (used + cost > budget) {
      dropped += 1
      continue
    }
    lines.push(line)
    used += cost
  }
  if (lines.length === 0) return undefined
  if (dropped > 0) {
    lines.push(`- ...and ${dropped} more skill${dropped === 1 ? '' : 's'} omitted (catalog budget reached).`)
  }
  return `${header}\n\n### Available skills\n${lines.join('\n')}\n\n${footer}`
}

export function normalizeRoot(path: string | undefined): string {
  const trimmed = path?.trim()
  return trimmed ? resolve(trimmed) : ''
}

export function skillTurnKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`
}

export function isSameOrInside(parent: string, target: string): boolean {
  if (!parent || !target) return false
  const rel = relative(parent, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function skillVisibleForWorkspace(
  skillRoot: string,
  workspaceRoot: string,
  knownWorkspaceRoots: string[]
): boolean {
  const root = normalizeRoot(skillRoot)
  if (workspaceRoot && isSameOrInside(workspaceRoot, root)) return true
  const ownerWorkspace = knownWorkspaceRoots.find((candidate) => isSameOrInside(candidate, root))
  if (ownerWorkspace) return workspaceRoot !== '' && ownerWorkspace === workspaceRoot
  if (workspaceRoot && looksLikeWorkspaceSkillRoot(root) && !isSameOrInside(workspaceRoot, root)) {
    return false
  }
  return true
}

export function looksLikeWorkspaceSkillRoot(root: string): boolean {
  const parts = root.split(/[\\/]+/)
  if (parts.length < 2) return false
  const tail2 = parts.slice(-2).join('/')
  return tail2 === '.agents/skills' ||
    tail2 === '.claude/skills' ||
    tail2 === '.codex/skills' ||
    tail2 === '.kun/skills' ||
    parts.at(-1) === 'skills'
}

export function isConventionalWorkspaceSkillRoot(workspaceRoot: string, root: string): boolean {
  if (!isSameOrInside(workspaceRoot, root)) return false
  const relativeRoot = relative(workspaceRoot, root).split(sep).join('/')
  return WORKSPACE_SKILL_RELATIVE_DIRS.some((candidate) => candidate === relativeRoot)
}

export async function existingWorkspaceSkillRoots(workspaceRoot: string): Promise<string[]> {
  const resolvedWorkspace = await realpath(workspaceRoot).catch(() => '')
  if (!resolvedWorkspace) return []
  const roots: string[] = []
  for (const relativeDir of WORKSPACE_SKILL_RELATIVE_DIRS) {
    const root = resolve(workspaceRoot, ...relativeDir.split('/'))
    const resolvedRoot = await realpath(root).catch(() => '')
    // Workspace discovery is untrusted repository content. A symlinked
    // .claude/.kun skill root must not import a package from elsewhere on the
    // user's disk simply because it sits under a familiar lexical path.
    if (resolvedRoot && isSameOrInside(resolvedWorkspace, resolvedRoot)) roots.push(root)
  }
  return roots
}

/**
 * Per-call skill deny-list. Mirrors the global `disabledIds` discovery filter
 * (slug both sides) but applies to a single resolveTurn/loadSkill call — e.g. a
 * subagent profile that blocks specific skills — without mutating the shared
 * runtime instance, so sibling children are unaffected.
 */
export function filterSkills(
  skills: LoadedSkill[],
  allowedIds: readonly string[] | undefined,
  blockedIds: readonly string[] | undefined
): LoadedSkill[] {
  const allowed = allowedIds
    ? new Set(allowedIds.map(normalizeSkillId))
    : undefined
  if (!allowed && (!blockedIds || blockedIds.length === 0)) return skills
  // Normalize like loadSkillById's lookup (strip leading $/@ and a `skill:`
  // prefix before slugging) so a `skill:gmail` / `$gmail` deny entry matches
  // the discovered, slugged id.
  const blocked = new Set((blockedIds ?? []).map(normalizeSkillId))
  return skills.filter((skill) => (!allowed || allowed.has(skill.id)) && !blocked.has(skill.id))
}

export function filterBlockedSkills(
  skills: LoadedSkill[],
  blockedIds: readonly string[] | undefined
): LoadedSkill[] {
  return filterSkills(skills, undefined, blockedIds)
}

export function normalizeSkillId(id: string): string {
  return slug(id.trim().replace(/^[$@]/, '').replace(/^skill:/i, ''))
}

export async function discoverSkills(
  config: SkillsCapabilityConfig,
  options: { workspaceRoot?: string } = {}
): Promise<{
  skills: LoadedSkill[]
  validationErrors: Array<{ root: string; message: string }>
}> {
  const skills: LoadedSkill[] = []
  const validationErrors: Array<{ root: string; message: string }> = []
  // Skill ids the user disabled. Slug both sides so `gmail`, `Gmail`, and
  // `skill:gmail` all match the discovered `slug(manifest.id)`. A disabled
  // skill is dropped here at the single discovery chokepoint, so it stays out
  // of the catalog, auto-match, load_skill, diagnostics, and counts alike.
  const disabledIds = new Set((config.disabledIds ?? []).map(slug))

  // Scan project roots (priority over global — loaded first)
  for (const rawRoot of config.roots) {
    const root = resolve(rawRoot)
    const candidates = await packageCandidates(root, options.workspaceRoot).catch((error) => {
      validationErrors.push({ root, message: errorMessage(error) })
      return []
    })
    for (const candidate of candidates) {
      const loaded = await loadSkillPackage(candidate, config.legacySkillMd, 'project').catch((error) => {
        validationErrors.push({ root: candidate, message: errorMessage(error) })
        return null
      })
      if (loaded) skills.push(loaded)
    }
  }

  // Scan global roots (#149: global skill loading fix)
  const globalRoots = config.globalRoots ?? []
  for (const rawRoot of globalRoots) {
    const root = resolve(rawRoot)
    const candidates = await packageCandidates(root).catch((error) => {
      validationErrors.push({ root, message: errorMessage(error) })
      return []
    })
    for (const candidate of candidates) {
      const loaded = await loadSkillPackage(candidate, config.legacySkillMd, 'global').catch((error) => {
        validationErrors.push({ root: candidate, message: errorMessage(error) })
        return null
      })
      if (loaded) skills.push(loaded)
    }
  }

  const unique = new Map<string, LoadedSkill>()
  for (const skill of skills) {
    if (disabledIds.has(skill.id)) continue
    if (!unique.has(skill.id)) unique.set(skill.id, skill)
    else validationErrors.push({ root: skill.root, message: `duplicate Skill id: ${skill.id}` })
  }
  return { skills: [...unique.values()].sort((a, b) => a.id.localeCompare(b.id)), validationErrors }
}

export async function packageCandidates(root: string, workspaceRoot?: string): Promise<string[]> {
  const resolvedRoot = await realpath(root)
  const resolvedWorkspace = workspaceRoot ? await realpath(workspaceRoot) : ''
  if (resolvedWorkspace && !isSameOrInside(resolvedWorkspace, resolvedRoot)) return []
  const candidates = new Set<string>()
  if (await exists(join(root, 'skill.json')) || await exists(join(root, 'SKILL.md'))) {
    candidates.add(root)
  }
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_SKILL_PACKAGES_PER_ROOT)) {
    const dir = join(root, entry.name)
    if (!(await entryIsDirectory(entry, dir))) continue
    if (resolvedWorkspace) {
      const resolvedDir = await realpath(dir).catch(() => '')
      if (!resolvedDir || !isSameOrInside(resolvedWorkspace, resolvedDir)) continue
    }
    if (await exists(join(dir, 'skill.json')) || await exists(join(dir, 'SKILL.md'))) {
      candidates.add(dir)
    }
  }
  return [...candidates]
}

/**
 * Whether a directory entry is — or resolves to — a directory. `readdir` with
 * `withFileTypes` describes the link itself, so a symlinked skill package (e.g.
 * the per-skill links `cc switch` drops into `.claude/skills`) reports
 * `isDirectory() === false` and would be skipped. Follow such links via `stat`
 * so those packages are still discovered. Also covers filesystems that report
 * an unknown `d_type`. (#320)
 */
export async function entryIsDirectory(entry: Dirent, path: string): Promise<boolean> {
  if (entry.isDirectory()) return true
  if (entry.isFile()) return false
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export async function loadSkillPackage(root: string, allowLegacy: boolean, source: 'project' | 'global'): Promise<LoadedSkill | null> {
  const manifestPath = join(root, 'skill.json')
  if (await exists(manifestPath)) {
    const packageRoot = await realpath(root)
    const safeManifestPath = await resolveSkillPackageFile(packageRoot, 'skill.json')
    const manifest = SkillManifest.parse(JSON.parse(await readSkillText(safeManifestPath, MAX_SKILL_MANIFEST_BYTES, 'skill manifest')))
    const entryPath = await resolveSkillPackageFile(packageRoot, manifest.entry)
    const entry = await readSkillText(entryPath, MAX_SKILL_ENTRY_BYTES, 'skill entry')
    const assets = await Promise.all(manifest.assets.map((asset) => resolveSkillPackageFile(packageRoot, asset)))
    return {
      id: slug(manifest.id ?? manifest.name),
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      root,
      entryPath,
      entry,
      triggers: manifest.triggers,
      allowedTools: manifest.allowedTools,
      assets,
      priority: manifest.priority,
      legacy: false,
      source,
    }
  }
  if (!allowLegacy) return null
  const legacyPath = join(root, 'SKILL.md')
  if (!await exists(legacyPath)) return null
  const packageRoot = await realpath(root)
  const safeLegacyPath = await resolveSkillPackageFile(packageRoot, 'SKILL.md')
  const entry = await readSkillText(safeLegacyPath, MAX_SKILL_ENTRY_BYTES, 'legacy skill entry')
  const frontmatter = readFrontmatter(entry)
  const folderName = basename(root)
  const name = frontmatter.name || folderName
  return {
    id: slug(frontmatter.id || folderName),
    name,
    description: frontmatter.description,
    version: 'legacy',
    root,
    entryPath: safeLegacyPath,
    entry,
    triggers: { commands: [], promptPatterns: [], fileTypes: [] },
    allowedTools: [],
    assets: [],
    priority: 0,
    legacy: true,
    source,
  }
}

export async function resolveSkillPackageFile(packageRoot: string, value: string): Promise<string> {
  if (isAbsolute(value)) throw new Error(`skill package path must be relative: ${value}`)
  const lexical = resolve(packageRoot, value)
  if (!isSameOrInside(packageRoot, lexical)) {
    throw new Error(`skill package path escapes its root: ${value}`)
  }
  const resolved = await realpath(lexical)
  if (!isSameOrInside(packageRoot, resolved)) {
    throw new Error(`skill package path resolves outside its root: ${value}`)
  }
  return resolved
}

export async function readSkillText(path: string, maxBytes: number, label: string): Promise<string> {
  let handle: FileHandle | undefined
  try {
    handle = await open(path, constants.O_RDONLY)
    const fileStat = await handle.stat()
    if (!fileStat.isFile()) throw new Error(`${label} is not a regular file`)
    if (fileStat.size > maxBytes) throw new Error(`${label} exceeds ${maxBytes} byte limit`)
    const buffer = Buffer.allocUnsafe(maxBytes + 1)
    let offset = 0
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > maxBytes) throw new Error(`${label} exceeds ${maxBytes} byte limit`)
    return buffer.subarray(0, offset).toString('utf8')
  } finally {
    if (handle) await handle.close().catch(() => undefined)
  }
}

export function formatSkillInstruction(skill: LoadedSkill, reason: string): string {
  return [
    `Active Skill: ${skill.name} (${skill.id})`,
    `Activation: ${reason}`,
    skill.description ? `Description: ${skill.description}` : '',
    skill.allowedTools.length ? `Allowed tools: ${skill.allowedTools.join(', ')}` : '',
    skill.assets.length
      ? `Assets: ${skill.assets.length} declared. Load only the selected reference with load_skill_asset; do not read the whole package.`
      : '',
    skill.entry
  ].filter(Boolean).join('\n\n')
}

export function buildInjection(
  active: Array<SkillActivation & { skill: LoadedSkill }>,
  budgetBytes: number
): {
  activeSkillIds: string[]
  instructions: string[]
  allowedToolNames?: string[]
  injectedBytes: number
} {
  const instructions: string[] = []
  const activeSkillIds: string[] = []
  const allowed = new Set<string>()
  let injectedBytes = 0
  for (const match of active) {
    const skill = match.skill
    const text = formatSkillInstruction(skill, match.reason)
    const bytes = Buffer.byteLength(text, 'utf8')
    if (injectedBytes + bytes > budgetBytes) continue
    activeSkillIds.push(skill.id)
    instructions.push(text)
    injectedBytes += bytes
    for (const tool of skill.allowedTools) allowed.add(tool)
  }
  return {
    activeSkillIds,
    instructions,
    ...(allowed.size > 0 ? { allowedToolNames: [...allowed].sort() } : {}),
    injectedBytes
  }
}

export function blockedToolsFor(skills: LoadedSkill[], allowedToolNames: string[] | undefined): string[] {
  if (!allowedToolNames) return []
  const allowed = new Set(allowedToolNames)
  return [...new Set(skills.flatMap((skill) => skill.allowedTools))]
    .filter((tool) => !allowed.has(tool))
    .sort()
}

export function emptyResolution(): SkillTurnResolution {
  return {
    activeSkillIds: [],
    activations: [],
    instructions: [],
    injectedBytes: 0
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export function explicitSkillMention(skill: LoadedSkill, prompt: string): string | undefined {
  const lower = prompt.toLowerCase()
  const id = skill.id.toLowerCase()
  const name = skill.name.toLowerCase()
  if (lower.includes(`$${id}`) || lower.includes(`@${id}`) || lower.includes(`/skill:${id}`)) return 'explicit:id'
  if (name && (lower.includes(`$${name}`) || lower.includes(`@${name}`))) return 'explicit:name'
  return undefined
}

export function safePatternMatches(pattern: string, prompt: string): boolean {
  return prompt.toLocaleLowerCase().includes(pattern.toLocaleLowerCase())
}

export function isSafePromptPattern(pattern: string): boolean {
  // Keep matching linear and predictable. File types and explicit commands
  // cover the structured cases that previously tempted manifests to use regex.
  return !/[\\^$.*+?()[\]{}|]/.test(pattern)
}

export function fileTypesFrom(paths: readonly string[], prompt: string): Set<string> {
  const out = new Set<string>()
  for (const filePath of paths) {
    const ext = extname(filePath)
    if (ext) out.add(normalizeFileType(ext))
  }
  for (const match of prompt.matchAll(/\.[a-z0-9]+/gi)) {
    out.add(normalizeFileType(match[0] ?? ''))
  }
  return out
}

export function normalizeFileType(value: string): string {
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

export function firstMarkdownParagraph(markdown: string): string | undefined {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.replace(/^#+\s*/, '').trim())
    .find(Boolean)
}

export function readFrontmatter(content: string): { id?: string; name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return { description: firstMarkdownParagraph(content) }
  const yaml = match[1] ?? ''
  return {
    id: frontmatterString(yaml, 'id'),
    name: frontmatterString(yaml, 'name'),
    description: frontmatterString(yaml, 'description') || firstMarkdownParagraph(content.slice(match[0].length))
  }
}

export function frontmatterString(yaml: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(yaml)
  return match ? stripQuotes(match[1] ?? '').trim() || undefined : undefined
}

export function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function truncateToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '…(truncated)'
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  const marker = '\n…(truncated)'
  const room = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'))
  // Slice by chars then shrink until the UTF-8 byte length fits the budget.
  let end = Math.min(value.length, room)
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > room) end -= 1
  return value.slice(0, end) + marker
}

export function slug(value: string): string {
  return value
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'skill'
}

export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map((issue) => issue.message).join('; ')
  return error instanceof Error ? error.message : String(error)
}
