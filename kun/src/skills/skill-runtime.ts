import { type Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { SkillsCapabilityConfig } from '../contracts/capabilities.js'

const DEFAULT_ACTIVE_LIMIT = 3
const DEFAULT_INSTRUCTION_BUDGET_BYTES = 24_000
const DEFAULT_CATALOG_BUDGET_BYTES = 8_000

const SkillTriggerManifest = z.object({
  commands: z.array(z.string().min(1)).default([]),
  promptPatterns: z.array(z.string().min(1)).default([]),
  fileTypes: z.array(z.string().min(1)).default([])
}).default({ commands: [], promptPatterns: [], fileTypes: [] })

export const SkillManifest = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().default('0.0.0'),
  entry: z.string().min(1).default('SKILL.md'),
  triggers: SkillTriggerManifest,
  allowedTools: z.array(z.string().min(1)).default([]),
  assets: z.array(z.string().min(1)).default([]),
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
}

export type SkillActivation = {
  skillId: string
  reason: string
  score: number
}

export type SkillTurnResolution = {
  activeSkillIds: string[]
  activations: SkillActivation[]
  instructions: string[]
  allowedToolNames?: string[]
  injectedBytes: number
}

export type SkillRuntimeDiagnostics = {
  enabled: boolean
  roots: string[]
  skills: Array<{
    id: string
    name: string
    description?: string
    version: string
    root: string
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
  /** Byte budget for the always-on available-skills catalog folded into the prefix. */
  catalogBudgetBytes?: number
}

export class SkillRuntime {
  private skills: LoadedSkill[]
  private validationErrors: Array<{ root: string; message: string }>
  private lastActivations: SkillActivation[] = []
  private lastInjection: SkillRuntimeDiagnostics['lastInjection']

  private constructor(
    private readonly config: SkillsCapabilityConfig,
    private readonly options: Required<SkillRuntimeOptions>,
    loaded: { skills: LoadedSkill[]; validationErrors: Array<{ root: string; message: string }> }
  ) {
    this.skills = loaded.skills
    this.validationErrors = loaded.validationErrors
  }

  static async create(
    config: SkillsCapabilityConfig | undefined,
    options: SkillRuntimeOptions = {}
  ): Promise<SkillRuntime> {
    const normalized = config ?? { enabled: false, roots: [], legacySkillMd: true }
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

  async refresh(): Promise<void> {
    const loaded = this.config.enabled
      ? await discoverSkills(this.config)
      : { skills: [], validationErrors: [] }
    this.skills = loaded.skills
    this.validationErrors = loaded.validationErrors
  }

  resolveTurn(input: {
    prompt: string
    workspace: string
    filePaths?: readonly string[]
  }): SkillTurnResolution {
    if (!this.config.enabled) return emptyResolution()
    const matches = this.matchSkills(input)
    const active = matches.slice(0, this.options.activeLimit)
    const injection = buildInjection(active, this.options.instructionBudgetBytes)
    const blockedToolNames = blockedToolsFor(this.skills, injection.allowedToolNames)
    this.lastActivations = active.map(({ skill, reason, score }) => ({
      skillId: skill.id,
      reason,
      score
    }))
    this.lastInjection = {
      activeSkillIds: injection.activeSkillIds,
      injectedBytes: injection.injectedBytes,
      budgetBytes: this.options.instructionBudgetBytes,
      blockedToolNames
    }
    return {
      activeSkillIds: injection.activeSkillIds,
      activations: this.lastActivations,
      instructions: injection.instructions,
      ...(injection.allowedToolNames ? { allowedToolNames: injection.allowedToolNames } : {}),
      injectedBytes: injection.injectedBytes
    }
  }

  /**
   * Renders the always-on catalog of available skills, folded once into the
   * stable prefix at session start. Unlike {@link resolveTurn} (which only
   * injects a skill once its triggers fire on the user prompt), the catalog
   * lets the model learn that skills exist at all and read the linked
   * `SKILL.md` on demand. Mirrors codex's `render_available_skills_body`.
   * Returns `undefined` when skills are disabled or none are loaded so the
   * prefix stays byte-identical to the no-skills case.
   */
  catalogInstruction(): string | undefined {
    if (!this.config.enabled || this.skills.length === 0) return undefined
    const budget = this.options.catalogBudgetBytes
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
    for (const skill of this.skills) {
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
      lines.push(`- …and ${dropped} more skill${dropped === 1 ? '' : 's'} omitted (catalog budget reached).`)
    }
    return `${header}\n\n### Available skills\n${lines.join('\n')}\n\n${footer}`
  }

  /**
   * Loads a single skill's full instructions on demand, for the `load_skill`
   * tool. Lets the model pull a skill it discovered in the catalog even when no
   * trigger fired on the user prompt — mirroring codex's autonomous invocation.
   * Returns an error payload (never throws) so the tool can surface it to the
   * model as a normal tool result.
   */
  loadSkillById(skillId: string): {
    skillId: string
    name: string
    instruction: string
    allowedTools: string[]
    truncated: boolean
  } | { error: string } {
    if (!this.config.enabled) return { error: 'skills are disabled' }
    const normalized = slug(skillId.trim().replace(/^[$@]/, '').replace(/^skill:/i, ''))
    const skill = this.skills.find((candidate) => candidate.id === normalized) ??
      this.skills.find((candidate) => slug(candidate.name) === normalized)
    if (!skill) {
      const available = this.skills.map((candidate) => candidate.id).join(', ')
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
    return {
      skillId: skill.id,
      name: skill.name,
      instruction,
      allowedTools: [...skill.allowedTools],
      truncated
    }
  }

  diagnostics(): SkillRuntimeDiagnostics {
    return {
      enabled: this.config.enabled,
      roots: [...this.config.roots],
      skills: this.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        ...(skill.description ? { description: skill.description } : {}),
        version: skill.version,
        root: skill.root,
        legacy: skill.legacy,
        triggers: skill.triggers,
        allowedTools: skill.allowedTools
      })),
      validationErrors: [...this.validationErrors],
      lastActivations: [...this.lastActivations],
      ...(this.lastInjection ? { lastInjection: this.lastInjection } : {})
    }
  }

  count(): number {
    return this.skills.length
  }

  private matchSkills(input: {
    prompt: string
    workspace: string
    filePaths?: readonly string[]
  }): Array<SkillActivation & { skill: LoadedSkill }> {
    const prompt = input.prompt
    const lowerPrompt = prompt.toLowerCase()
    const fileTypes = fileTypesFrom(input.filePaths ?? [], prompt)
    const matches: Array<SkillActivation & { skill: LoadedSkill }> = []
    for (const skill of this.skills) {
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
}

async function discoverSkills(config: SkillsCapabilityConfig): Promise<{
  skills: LoadedSkill[]
  validationErrors: Array<{ root: string; message: string }>
}> {
  const skills: LoadedSkill[] = []
  const validationErrors: Array<{ root: string; message: string }> = []
  for (const rawRoot of config.roots) {
    const root = resolve(rawRoot)
    const candidates = await packageCandidates(root).catch((error) => {
      validationErrors.push({ root, message: errorMessage(error) })
      return []
    })
    for (const candidate of candidates) {
      const loaded = await loadSkillPackage(candidate, config.legacySkillMd).catch((error) => {
        validationErrors.push({ root: candidate, message: errorMessage(error) })
        return null
      })
      if (loaded) skills.push(loaded)
    }
  }
  const unique = new Map<string, LoadedSkill>()
  for (const skill of skills) {
    if (!unique.has(skill.id)) unique.set(skill.id, skill)
    else validationErrors.push({ root: skill.root, message: `duplicate Skill id: ${skill.id}` })
  }
  return { skills: [...unique.values()].sort((a, b) => a.id.localeCompare(b.id)), validationErrors }
}

async function packageCandidates(root: string): Promise<string[]> {
  const candidates = new Set<string>()
  if (await exists(join(root, 'skill.json')) || await exists(join(root, 'SKILL.md'))) {
    candidates.add(root)
  }
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const dir = join(root, entry.name)
    if (!(await entryIsDirectory(entry, dir))) continue
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

async function loadSkillPackage(root: string, allowLegacy: boolean): Promise<LoadedSkill | null> {
  const manifestPath = join(root, 'skill.json')
  if (await exists(manifestPath)) {
    const manifest = SkillManifest.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
    const entryPath = resolve(root, manifest.entry)
    const entry = await readFile(entryPath, 'utf8')
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
      assets: manifest.assets.map((asset) => resolve(root, asset)),
      priority: manifest.priority,
      legacy: false
    }
  }
  if (!allowLegacy) return null
  const legacyPath = join(root, 'SKILL.md')
  if (!await exists(legacyPath)) return null
  const entry = await readFile(legacyPath, 'utf8')
  const frontmatter = readFrontmatter(entry)
  const folderName = basename(root)
  const name = frontmatter.name || folderName
  return {
    id: slug(frontmatter.id || folderName),
    name,
    description: frontmatter.description,
    version: 'legacy',
    root,
    entryPath: legacyPath,
    entry,
    triggers: { commands: [], promptPatterns: [], fileTypes: [] },
    allowedTools: [],
    assets: [],
    priority: 0,
    legacy: true
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
  try {
    return new RegExp(pattern, 'i').test(prompt)
  } catch {
    return false
  }
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
