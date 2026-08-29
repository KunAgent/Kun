import { constants, type Dirent } from 'node:fs'
import { open, readdir, realpath, stat, type FileHandle } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import type { SkillsCapabilityConfig } from '../contracts/capabilities.js'
import {
  loadKunProjectConfig,
  type KunProjectConfigLoadResult
} from '../config/project-config.js'

import {
  DEFAULT_ACTIVE_LIMIT,
  DEFAULT_CATALOG_BUDGET_BYTES,
  DEFAULT_INSTRUCTION_BUDGET_BYTES,
  MAX_MANUAL_SKILL_TURN_ACTIVATIONS,
  MAX_WORKSPACE_SKILL_CACHES
} from './skill-runtime-contracts.js'
import type {
  LoadedSkill,
  SkillActivation,
  SkillRuntimeDiagnostics,
  SkillRuntimeOptions,
  SkillTurnResolution
} from './skill-runtime-contracts.js'
import {
  blockedToolsFor,
  buildInjection,
  discoverSkills,
  emptyResolution,
  existingWorkspaceSkillRoots,
  explicitSkillMention,
  fileTypesFrom,
  filterBlockedSkills,
  filterSkills,
  formatSkillInstruction,
  isConventionalWorkspaceSkillRoot,
  isSameOrInside,
  readSkillText,
  normalizeFileType,
  normalizeRoot,
  renderCatalogInstruction,
  safePatternMatches,
  skillTurnKey,
  skillVisibleForWorkspace,
  skillsRuntimeEnabled,
  slug,
  truncateToBytes,
  uniqueRoots,
  uniqueValidationErrors
} from './skill-runtime-support.js'

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
    /** Per-call skill-id allow-list captured at a delegated execution boundary. */
    allowedSkillIds?: readonly string[]
    /** Per-call skill-id deny-list (e.g. a subagent profile's blockedSkills). Hidden from catalog + auto-activation. */
    blockedSkillIds?: readonly string[]
  }): Promise<SkillTurnResolution> {
    if (!skillsRuntimeEnabled(this.config)) return emptyResolution()
    const skills = filterSkills(
      await this.skillsForWorkspace(input.workspace),
      input.allowedSkillIds,
      input.blockedSkillIds
    )
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
    turn?: { threadId: string; turnId: string },
    allowedIds?: readonly string[]
  ): Promise<{
    skillId: string
    name: string
    instruction: string
    allowedTools: string[]
    truncated: boolean
  } | { error: string }> {
    if (!skillsRuntimeEnabled(this.config)) return { error: 'skills are disabled' }
    const skills = filterSkills(await this.skillsForWorkspace(workspace), allowedIds, blockedIds)
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

  async loadSkillAsset(
    skillId: string,
    assetPath: string,
    workspace = '',
    options: { offset?: number; limit?: number } = {},
    blockedIds?: readonly string[],
    allowedIds?: readonly string[]
  ): Promise<{
    skillId: string
    path: string
    content: string
    offset: number
    nextOffset?: number
    truncated: boolean
  } | { error: string }> {
    if (!skillsRuntimeEnabled(this.config)) return { error: 'skills are disabled' }
    const skills = filterSkills(await this.skillsForWorkspace(workspace), allowedIds, blockedIds)
    const normalized = slug(skillId.trim().replace(/^[$@]/, '').replace(/^skill:/i, ''))
    const skill = skills.find((candidate) => candidate.id === normalized) ??
      skills.find((candidate) => slug(candidate.name) === normalized)
    if (!skill) return { error: `unknown skill id "${skillId}"` }
    const requested = assetPath.trim().replaceAll('\\', '/').replace(/^\.\//, '')
    if (!requested || requested.startsWith('/') || requested.split('/').includes('..')) {
      return { error: 'asset path must be a declared relative path without traversal' }
    }
    const asset = skill.assets.find((candidate) => {
      const normalizedCandidate = candidate.replaceAll('\\', '/')
      return normalizedCandidate.endsWith(`/${requested}`)
    })
    if (!asset) return { error: `asset is not declared by skill "${skill.id}": ${requested}` }
    const offset = Math.max(0, Math.floor(options.offset ?? 0))
    const limit = Math.max(1, Math.min(400, Math.floor(options.limit ?? 160)))
    try {
      const text = await readSkillText(asset, 256 * 1024, 'skill asset')
      const lines = text.split(/\r?\n/)
      const content = lines.slice(offset, offset + limit).join('\n')
      const nextOffset = offset + limit < lines.length ? offset + limit : undefined
      return {
        skillId: skill.id,
        path: requested,
        content,
        offset,
        ...(nextOffset !== undefined ? { nextOffset } : {}),
        truncated: nextOffset !== undefined
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
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

  /** Return the catalog visible to one workspace, including conventional project roots. */
  async diagnosticsForWorkspace(workspace: string): Promise<SkillRuntimeDiagnostics> {
    const skills = skillsRuntimeEnabled(this.config)
      ? await this.skillsForWorkspace(workspace)
      : []
    const base = this.diagnostics()
    return {
      ...base,
      roots: uniqueRoots(skills.filter((skill) => skill.source === 'project').map((skill) => skill.root)),
      globalRoots: uniqueRoots(skills.filter((skill) => skill.source === 'global').map((skill) => skill.root)),
      skills: skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        ...(skill.description ? { description: skill.description } : {}),
        version: skill.version,
        root: skill.root,
        source: skill.source,
        legacy: skill.legacy,
        triggers: skill.triggers,
        allowedTools: skill.allowedTools
      }))
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
    blockedSkillIds?: readonly string[],
    allowedSkillIds?: readonly string[]
  ): Promise<string[]> {
    if (!skillsRuntimeEnabled(this.config)) return []
    return filterSkills(
      await this.skillsForWorkspace(workspace),
      allowedSkillIds,
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
    const globallyFiltered = filterBlockedSkills(combined, this.config.disabledIds)
    return projectConfig?.status === 'valid'
      ? filterBlockedSkills(globallyFiltered, projectConfig.skills.disabledIds)
      : globallyFiltered
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
