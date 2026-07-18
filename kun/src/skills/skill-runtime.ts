import { constants, type Dirent } from 'node:fs'
import { open, readdir, realpath, stat, type FileHandle } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import type { SkillsCapabilityConfig } from '../contracts/capabilities.js'
import {
  loadKunProjectConfig,
  type KunProjectConfigLoadResult
} from '../config/project-config.js'

const DEFAULT_ACTIVE_LIMIT = 3
const DEFAULT_INSTRUCTION_BUDGET_BYTES = 24_000
const DEFAULT_CATALOG_BUDGET_BYTES = 8_000
const MAX_SKILL_PACKAGES_PER_ROOT = 64
const MAX_MANUAL_SKILL_TURN_ACTIVATIONS = 512
const MAX_SKILL_MANIFEST_BYTES = 64 * 1024
const MAX_SKILL_ENTRY_BYTES = 256 * 1024
const WORKSPACE_SKILL_RELATIVE_DIRS = [
  '.agents/skills',
  '.claude/skills',
  '.codex/skills',
  '.kun/skills',
  'skills'
] as const

const SkillTriggerManifest = z.object({
  commands: z.array(z.string().min(1).max(256)).max(16).default([]),
  // Prompt patterns intentionally use literal case-insensitive substring
  // matching. JavaScript regular expressions from workspace manifests can
  // catastrophically backtrack on every turn and block the runtime event loop.
  promptPatterns: z.array(z.string().min(1).max(256).refine(isSafePromptPattern, {
    message: 'promptPatterns must be literal text, not a regular expression'
  })).max(16).default([]),
  fileTypes: z.array(z.string().min(1).max(64)).max(16).default([])
}).default({ commands: [], promptPatterns: [], fileTypes: [] })

export const SkillManifest = z.object({
  id: z.string().min(1).max(128).optional(),
  name: z.string().min(1).max(256),
  description: z.string().max(4_000).optional(),
  version: z.string().max(128).default('0.0.0'),
  entry: z.string().min(1).max(1_024).default('SKILL.md'),
  triggers: SkillTriggerManifest,
  allowedTools: z.array(z.string().min(1).max(128)).max(64).default([]),
  assets: z.array(z.string().min(1).max(1_024)).max(32).default([]),
  priority: z.number().int().default(0)
}).strict()
export type SkillManifest = z.infer<typeof SkillManifest>

export type LoadedSkill = {
  id: string
  name: string
  description?: string
  version: string
  root: string
  entryPath: string
  entry: string
  triggers: z.infer<typeof SkillTriggerManifest>
  allowedTools: string[]
  assets: string[]
  priority: number
  legacy: boolean
  /** Source of the skill: 'project' (workspace) or 'global' (user-level). */
  source: 'project' | 'global'
}

export type SkillActivation = {
  skillId: string
  reason: string
  score: number
}

export type SkillTurnResolution = {
  activeSkillIds: string[]
  activations: SkillActivation[]
  catalogInstruction?: string
  instructions: string[]
  allowedToolNames?: string[]
  injectedBytes: number
}

export type SkillRuntimeDiagnostics = {
  enabled: boolean
  roots: string[]
  globalRoots: string[]
  skills: Array<{
    id: string
    name: string
    description?: string
    version: string
    root: string
    source: 'project' | 'global'
    legacy: boolean
    triggers: LoadedSkill['triggers']
    allowedTools: string[]
  }>
  validationErrors: Array<{ root: string; message: string }>
  lastActivations: SkillActivation[]
  lastInjection?: {
    activeSkillIds: string[]
    injectedBytes: number
    budgetBytes: number
    blockedToolNames: string[]
  }
}

export type SkillRuntimeOptions = {
  activeLimit?: number
  instructionBudgetBytes?: number
  /** Byte budget for the per-turn available-skills catalog. */
  catalogBudgetBytes?: number
}

const MAX_WORKSPACE_SKILL_CACHES = 128

export class SkillRuntime {
  private skills: LoadedSkill[]
  private validationErrors: Array<{ root: string; message: string }>
  private readonly workspaceSkillCache = new Map<string, {
    rootsKey: string
    skills: LoadedSkill[]
    validationErrors: Array<{ root: string; message: string }>
  }>()
  private lastActivations: SkillActivation[] = []
  private lastInjection: SkillRuntimeDiagnostics['lastInjection']
  /**
   * Explicit `load_skill` activations live only for one thread/turn. The map is
   * process-local and bounded so an abnormal turn that never reaches cleanup
   * cannot grow runtime state without limit.
   */
  private readonly manualSkillIdsByTurn = new Map<string, Set<string>>()

  private constructor(
    private config: SkillsCapabilityConfig,
    private options: Required<SkillRuntimeOptions>,
    loaded: { skills: LoadedSkill[]; validationErrors: Array<{ root: string; message: string }> }
  ) {
    this.skills = loaded.skills
    this.validationErrors = loaded.validationErrors
    this.workspaceSkillCache.clear()
  }

  enabled(): boolean {
    return skillsRuntimeEnabled(this.config)
  }

  static async create(
    config: SkillsCapabilityConfig | undefined,
    options: SkillRuntimeOptions = {}
  ): Promise<SkillRuntime> {
    const normalized = config ?? {
      enabled: false,
      roots: [],
      workspaceRoots: [],
      globalRoots: [],
      projectConfigEnabled: false,
      disabledIds: [],
      legacySkillMd: true
    }
    const resolvedOptions = {
      activeLimit: options.activeLimit ?? DEFAULT_ACTIVE_LIMIT,
      instructionBudgetBytes: options.instructionBudgetBytes ?? DEFAULT_INSTRUCTION_BUDGET_BYTES,
      catalogBudgetBytes: options.catalogBudgetBytes ?? DEFAULT_CATALOG_BUDGET_BYTES
    }
    const loaded = normalized.enabled
      ? await discoverSkills(normalized)
      : { skills: [], validationErrors: [] }
    return new SkillRuntime(normalized, resolvedOptions, loaded)
  }

  replaceWith(next: SkillRuntime): void {
    this.config = next.config
    this.options = next.options
    this.skills = next.skills
    this.validationErrors = next.validationErrors
    this.workspaceSkillCache.clear()
    this.manualSkillIdsByTurn.clear()
    this.lastActivations = []
    this.lastInjection = undefined
  }

  async refresh(): Promise<void> {
    const loaded = this.config.enabled
      ? await discoverSkills(this.config)
      : { skills: [], validationErrors: [] }
    this.skills = loaded.skills
    this.validationErrors = loaded.validationErrors
    this.workspaceSkillCache.clear()
    this.manualSkillIdsByTurn.clear()
  }

  async resolveTurn(input: {
    prompt: string
    workspace: string
    filePaths?: readonly string[]
    threadId?: string
    turnId?: string
    /** Per-call skill-id deny-list (e.g. a subagent profile's blockedSkills). Hidden from catalog + auto-activation. */
    blockedSkillIds?: readonly string[]
  }): Promise<SkillTurnResolution> {
    if (!skillsRuntimeEnabled(this.config)) return emptyResolution()
    const skills = filterBlockedSkills(await this.skillsForWorkspace(input.workspace), input.blockedSkillIds)
    const catalogInstruction = renderCatalogInstruction(skills, this.options.catalogBudgetBytes)
    const matches = this.matchSkills(input, skills)
    const matchedIds = new Set(matches.map((match) => match.skill.id))
    for (const skillId of this.manualSkillIds(input.threadId, input.turnId)) {
      if (matchedIds.has(skillId)) continue
      const skill = skills.find((candidate) => candidate.id === skillId)
      if (!skill) continue
      matches.push({
        skill,
        skillId: skill.id,
        reason: 'load_skill',
        score: 1_100 + skill.priority
      })
      matchedIds.add(skillId)
    }
    matches.sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
    const active = matches.slice(0, this.options.activeLimit)
    const injection = buildInjection(active, this.options.instructionBudgetBytes)
    const catalogBytes = catalogInstruction ? Buffer.byteLength(catalogInstruction, 'utf8') : 0
    const injectedBytes = injection.injectedBytes + catalogBytes
    const blockedToolNames = blockedToolsFor(skills, injection.allowedToolNames)
    this.lastActivations = active.map(({ skill, reason, score }) => ({
      skillId: skill.id,
      reason,
      score
    }))
    this.lastInjection = {
      activeSkillIds: injection.activeSkillIds,
      injectedBytes,
      budgetBytes: this.options.instructionBudgetBytes,
      blockedToolNames
    }
    return {
      activeSkillIds: injection.activeSkillIds,
      activations: this.lastActivations,
      ...(catalogInstruction ? { catalogInstruction } : {}),
      instructions: injection.instructions,
      ...(injection.allowedToolNames ? { allowedToolNames: injection.allowedToolNames } : {}),
      injectedBytes
    }
  }

  /**
   * Renders the global catalog for diagnostics and compatibility. Runtime turns
   * use resolveTurn so workspace-local skills stay out of the immutable prefix.
  */
  catalogInstruction(): string | undefined {
    return renderCatalogInstruction(this.skills, this.options.catalogBudgetBytes)
  }

  /**
   * Loads a single skill's full instructions on demand, for the `load_skill`
   * tool. Lets the model pull a skill it discovered in the catalog even when no
   * trigger fired on the user prompt — mirroring codex's autonomous invocation.
   * Returns an error payload (never throws) so the tool can surface it to the
   * model as a normal tool result.
   */
  async loadSkillById(
    skillId: string,
    workspace = '',
    blockedIds?: readonly string[],
    turn?: { threadId: string; turnId: string }
  ): Promise<{
    skillId: string
    name: string
    instruction: string
    allowedTools: string[]
    truncated: boolean
  } | { error: string }> {
    if (!skillsRuntimeEnabled(this.config)) return { error: 'skills are disabled' }
    const skills = filterBlockedSkills(await this.skillsForWorkspace(workspace), blockedIds)
    const normalized = slug(skillId.trim().replace(/^[$@]/, '').replace(/^skill:/i, ''))
    const skill = skills.find((candidate) => candidate.id === normalized) ??
      skills.find((candidate) => slug(candidate.name) === normalized)
    if (!skill) {
      const available = skills.map((candidate) => candidate.id).join(', ')
      return { error: `unknown skill id "${skillId}". Available: ${available || '(none)'}` }
    }
    let instruction = formatSkillInstruction(skill, 'load_skill')
    let truncated = false
    const budget = this.options.instructionBudgetBytes
    if (Buffer.byteLength(instruction, 'utf8') > budget) {
      // Trim the entry body (the only unbounded part) to fit the per-turn budget.
      const header = formatSkillInstruction({ ...skill, entry: '' }, 'load_skill')
      const overhead = Buffer.byteLength(`${header}\n\n`, 'utf8')
      const room = Math.max(0, budget - overhead)
      instruction = `${header}\n\n${truncateToBytes(skill.entry, room)}`
      truncated = true
    }
    if (turn?.threadId.trim() && turn.turnId.trim()) {
      this.rememberManualActivation(turn.threadId, turn.turnId, skill.id)
    }
    return {
      skillId: skill.id,
      name: skill.name,
      instruction,
      allowedTools: [...skill.allowedTools],
      truncated
    }
  }

  clearTurnActivation(threadId: string, turnId: string): void {
    this.manualSkillIdsByTurn.delete(skillTurnKey(threadId, turnId))
  }

  diagnostics(): SkillRuntimeDiagnostics {
    const projectRoots = this.config.roots ?? []
    const globalRoots = this.config.globalRoots ?? []
    return {
      enabled: skillsRuntimeEnabled(this.config),
      roots: [...projectRoots],
      globalRoots: [...globalRoots],
      skills: this.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        ...(skill.description ? { description: skill.description } : {}),
        version: skill.version,
        root: skill.root,
        source: skill.source,
        legacy: skill.legacy,
        triggers: skill.triggers,
        allowedTools: skill.allowedTools
      })),
      validationErrors: uniqueValidationErrors([
        ...this.validationErrors,
        ...[...this.workspaceSkillCache.values()].flatMap((cached) => cached.validationErrors)
      ]),
      lastActivations: [...this.lastActivations],
      ...(this.lastInjection ? { lastInjection: this.lastInjection } : {})
    }
  }

  count(): number {
    return this.skills.length
  }

  async countForWorkspace(workspace: string): Promise<number> {
    if (!skillsRuntimeEnabled(this.config)) return 0
    return (await this.skillsForWorkspace(workspace)).length
  }

  async availableSkillIdsForWorkspace(
    workspace: string,
    blockedSkillIds?: readonly string[]
  ): Promise<string[]> {
    if (!skillsRuntimeEnabled(this.config)) return []
    return filterBlockedSkills(
      await this.skillsForWorkspace(workspace),
      blockedSkillIds
    ).map((skill) => skill.id)
  }

  private matchSkills(input: {
    prompt: string
    workspace: string
    filePaths?: readonly string[]
  }, skills: LoadedSkill[]): Array<SkillActivation & { skill: LoadedSkill }> {
    const prompt = input.prompt
    const lowerPrompt = prompt.toLowerCase()
    const fileTypes = fileTypesFrom(input.filePaths ?? [], prompt)
    const matches: Array<SkillActivation & { skill: LoadedSkill }> = []
    for (const skill of skills) {
      const explicit = explicitSkillMention(skill, prompt)
      if (explicit) {
        matches.push({ skill, skillId: skill.id, reason: explicit, score: 1_000 + skill.priority })
        continue
      }
      const command = skill.triggers.commands.find((candidate) => lowerPrompt.startsWith(candidate.toLowerCase()))
      if (command) {
        matches.push({ skill, skillId: skill.id, reason: `command:${command}`, score: 900 + skill.priority })
        continue
      }
      const pattern = skill.triggers.promptPatterns.find((candidate) => safePatternMatches(candidate, prompt))
      if (pattern) {
        matches.push({ skill, skillId: skill.id, reason: `pattern:${pattern}`, score: 500 + skill.priority })
        continue
      }
      const fileType = skill.triggers.fileTypes.find((candidate) => fileTypes.has(normalizeFileType(candidate)))
      if (fileType) {
        matches.push({ skill, skillId: skill.id, reason: `fileType:${fileType}`, score: 300 + skill.priority })
      }
    }
    return matches.sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
  }

  private manualSkillIds(threadId: string | undefined, turnId: string | undefined): readonly string[] {
    if (!threadId?.trim() || !turnId?.trim()) return []
    return [...(this.manualSkillIdsByTurn.get(skillTurnKey(threadId, turnId)) ?? [])]
  }

  private rememberManualActivation(threadId: string, turnId: string, skillId: string): void {
    const key = skillTurnKey(threadId, turnId)
    const active = new Set(this.manualSkillIdsByTurn.get(key) ?? [])
    active.add(skillId)
    this.manualSkillIdsByTurn.delete(key)
    this.manualSkillIdsByTurn.set(key, active)
    if (this.manualSkillIdsByTurn.size > MAX_MANUAL_SKILL_TURN_ACTIVATIONS) {
      const oldest = this.manualSkillIdsByTurn.keys().next().value
      if (oldest !== undefined) this.manualSkillIdsByTurn.delete(oldest)
    }
  }

  private async skillsForWorkspace(workspace: string): Promise<LoadedSkill[]> {
    const workspaceRoot = normalizeRoot(workspace)
    const projectConfig = workspaceRoot && this.config.projectConfigEnabled !== false
      ? await loadKunProjectConfig(workspaceRoot)
      : undefined
    const workspaceLoaded = workspaceRoot
      ? await this.loadWorkspaceSkills(workspaceRoot, projectConfig)
      : { skills: [], validationErrors: [] }
    const knownWorkspaceRoots = [
      workspaceRoot,
      ...(this.config.workspaceRoots ?? []).map(normalizeRoot)
    ].filter(Boolean)
    const staticSkills = this.skills.filter((skill) => {
      if (!skillVisibleForWorkspace(skill.root, workspaceRoot, knownWorkspaceRoots)) return false
      if (projectConfig?.status !== 'valid') return true
      const projectLocal = skill.source === 'project' && isSameOrInside(workspaceRoot, normalizeRoot(skill.root))
      if (!projectLocal) return true
      if (!projectConfig.skills.enabled) return false
      if (!projectConfig.skills.includeConventional &&
        isConventionalWorkspaceSkillRoot(workspaceRoot, normalizeRoot(skill.root))) {
        return false
      }
      return true
    })
    const unique = new Map<string, LoadedSkill>()
    for (const skill of [...workspaceLoaded.skills, ...staticSkills]) {
      if (!unique.has(skill.id)) unique.set(skill.id, skill)
    }
    const combined = [...unique.values()].sort((a, b) => a.id.localeCompare(b.id))
    return projectConfig?.status === 'valid'
      ? filterBlockedSkills(combined, projectConfig.skills.disabledIds)
      : combined
  }

  private async loadWorkspaceSkills(
    workspaceRoot: string,
    projectConfig: KunProjectConfigLoadResult | undefined
  ): Promise<{
    skills: LoadedSkill[]
    validationErrors: Array<{ root: string; message: string }>
  }> {
    const projectConventionalEnabled = projectConfig?.status === 'valid' &&
      projectConfig.skills.enabled && projectConfig.skills.includeConventional
    const discoveredRoots = this.config.enabled || projectConventionalEnabled
      ? await existingWorkspaceSkillRoots(workspaceRoot)
      : []
    const configRoots = new Set((this.config.roots ?? []).map(normalizeRoot).filter(Boolean))
    const knownWorkspaceRoots = (this.config.workspaceRoots ?? []).map(normalizeRoot).filter(Boolean)
    const isKnownWorkspace = knownWorkspaceRoots.some((candidate) => candidate === workspaceRoot)
    const configuredConventionalRoots = isKnownWorkspace
      ? discoveredRoots.filter((root) => configRoots.has(normalizeRoot(root)))
      : discoveredRoots
    const projectRoots = projectConfig?.status === 'valid' && projectConfig.skills.enabled
      ? projectConfig.skills.roots
      : []
    const conventionalRoots = projectConfig?.status === 'valid'
      ? projectConfig.skills.enabled && projectConfig.skills.includeConventional
        ? configuredConventionalRoots
        : []
      : configuredConventionalRoots
    const roots = uniqueRoots([...projectRoots, ...conventionalRoots])
    const projectConfigKey = projectConfig?.status === 'valid'
      ? `valid:${projectConfig.digest}`
      : projectConfig?.status === 'invalid'
        ? `invalid:${projectConfig.message}`
        : projectConfig?.status ?? 'disabled'
    const rootsKey = `${projectConfigKey}\0${roots.join('\0')}`
    const cached = this.workspaceSkillCache.get(workspaceRoot)
    if (cached?.rootsKey === rootsKey) {
      this.workspaceSkillCache.delete(workspaceRoot)
      this.workspaceSkillCache.set(workspaceRoot, cached)
      return { skills: cached.skills, validationErrors: cached.validationErrors }
    }
    const loaded = roots.length > 0
      ? await discoverSkills({ ...this.config, roots }, { workspaceRoot })
      : { skills: [], validationErrors: [] }
    if (projectConfig?.status === 'invalid') {
      loaded.validationErrors.unshift({
        root: projectConfig.path,
        message: projectConfig.message
      })
    }
    this.workspaceSkillCache.delete(workspaceRoot)
    this.workspaceSkillCache.set(workspaceRoot, { rootsKey, ...loaded })
    if (this.workspaceSkillCache.size > MAX_WORKSPACE_SKILL_CACHES) {
      const oldest = this.workspaceSkillCache.keys().next().value
      if (oldest !== undefined) this.workspaceSkillCache.delete(oldest)
    }
    return loaded
  }
}

function skillsRuntimeEnabled(config: SkillsCapabilityConfig): boolean {
  return config.enabled || config.projectConfigEnabled === true
}

function uniqueRoots(roots: string[]): string[] {
  return [...new Set(roots.map(normalizeRoot).filter(Boolean))]
}

function uniqueValidationErrors(
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

function renderCatalogInstruction(skills: LoadedSkill[], budget: number): string | undefined {
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

function normalizeRoot(path: string | undefined): string {
  const trimmed = path?.trim()
  return trimmed ? resolve(trimmed) : ''
}

function skillTurnKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`
}

function isSameOrInside(parent: string, target: string): boolean {
  if (!parent || !target) return false
  const rel = relative(parent, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function skillVisibleForWorkspace(
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

function looksLikeWorkspaceSkillRoot(root: string): boolean {
  const parts = root.split(/[\\/]+/)
  if (parts.length < 2) return false
  const tail2 = parts.slice(-2).join('/')
  return tail2 === '.agents/skills' ||
    tail2 === '.claude/skills' ||
    tail2 === '.codex/skills' ||
    tail2 === '.kun/skills' ||
    parts.at(-1) === 'skills'
}

function isConventionalWorkspaceSkillRoot(workspaceRoot: string, root: string): boolean {
  if (!isSameOrInside(workspaceRoot, root)) return false
  const relativeRoot = relative(workspaceRoot, root).split(sep).join('/')
  return WORKSPACE_SKILL_RELATIVE_DIRS.some((candidate) => candidate === relativeRoot)
}

async function existingWorkspaceSkillRoots(workspaceRoot: string): Promise<string[]> {
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
function filterBlockedSkills(skills: LoadedSkill[], blockedIds: readonly string[] | undefined): LoadedSkill[] {
  if (!blockedIds || blockedIds.length === 0) return skills
  // Normalize like loadSkillById's lookup (strip leading $/@ and a `skill:`
  // prefix before slugging) so a `skill:gmail` / `$gmail` deny entry matches
  // the discovered, slugged id.
  const blocked = new Set(blockedIds.map((id) => slug(id.trim().replace(/^[$@]/, '').replace(/^skill:/i, ''))))
  return skills.filter((skill) => !blocked.has(skill.id))
}

async function discoverSkills(
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

async function packageCandidates(root: string, workspaceRoot?: string): Promise<string[]> {
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
async function entryIsDirectory(entry: Dirent, path: string): Promise<boolean> {
  if (entry.isDirectory()) return true
  if (entry.isFile()) return false
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function loadSkillPackage(root: string, allowLegacy: boolean, source: 'project' | 'global'): Promise<LoadedSkill | null> {
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

async function resolveSkillPackageFile(packageRoot: string, value: string): Promise<string> {
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

async function readSkillText(path: string, maxBytes: number, label: string): Promise<string> {
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

function formatSkillInstruction(skill: LoadedSkill, reason: string): string {
  return [
    `Active Skill: ${skill.name} (${skill.id})`,
    `Activation: ${reason}`,
    skill.description ? `Description: ${skill.description}` : '',
    skill.allowedTools.length ? `Allowed tools: ${skill.allowedTools.join(', ')}` : '',
    skill.assets.length ? `Assets:\n${skill.assets.map((asset) => `- ${asset}`).join('\n')}` : '',
    skill.entry
  ].filter(Boolean).join('\n\n')
}

function buildInjection(
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

function blockedToolsFor(skills: LoadedSkill[], allowedToolNames: string[] | undefined): string[] {
  if (!allowedToolNames) return []
  const allowed = new Set(allowedToolNames)
  return [...new Set(skills.flatMap((skill) => skill.allowedTools))]
    .filter((tool) => !allowed.has(tool))
    .sort()
}

function emptyResolution(): SkillTurnResolution {
  return {
    activeSkillIds: [],
    activations: [],
    instructions: [],
    injectedBytes: 0
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function explicitSkillMention(skill: LoadedSkill, prompt: string): string | undefined {
  const lower = prompt.toLowerCase()
  const id = skill.id.toLowerCase()
  const name = skill.name.toLowerCase()
  if (lower.includes(`$${id}`) || lower.includes(`@${id}`) || lower.includes(`/skill:${id}`)) return 'explicit:id'
  if (name && (lower.includes(`$${name}`) || lower.includes(`@${name}`))) return 'explicit:name'
  return undefined
}

function safePatternMatches(pattern: string, prompt: string): boolean {
  return prompt.toLocaleLowerCase().includes(pattern.toLocaleLowerCase())
}

function isSafePromptPattern(pattern: string): boolean {
  // Keep matching linear and predictable. File types and explicit commands
  // cover the structured cases that previously tempted manifests to use regex.
  return !/[\\^$.*+?()[\]{}|]/.test(pattern)
}

function fileTypesFrom(paths: readonly string[], prompt: string): Set<string> {
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

function normalizeFileType(value: string): string {
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

function firstMarkdownParagraph(markdown: string): string | undefined {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.replace(/^#+\s*/, '').trim())
    .find(Boolean)
}

function readFrontmatter(content: string): { id?: string; name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return { description: firstMarkdownParagraph(content) }
  const yaml = match[1] ?? ''
  return {
    id: frontmatterString(yaml, 'id'),
    name: frontmatterString(yaml, 'name'),
    description: frontmatterString(yaml, 'description') || firstMarkdownParagraph(content.slice(match[0].length))
  }
}

function frontmatterString(yaml: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(yaml)
  return match ? stripQuotes(match[1] ?? '').trim() || undefined : undefined
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function truncateToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '…(truncated)'
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  const marker = '\n…(truncated)'
  const room = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'))
  // Slice by chars then shrink until the UTF-8 byte length fits the budget.
  let end = Math.min(value.length, room)
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > room) end -= 1
  return value.slice(0, end) + marker
}

function slug(value: string): string {
  return value
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'skill'
}

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map((issue) => issue.message).join('; ')
  return error instanceof Error ? error.message : String(error)
}
