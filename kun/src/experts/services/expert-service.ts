import { mkdir, readFile, readdir, writeFile, rename, unlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { expandHomePath } from '../../config/kun-config.js'
import { resolveExpertPlugins } from '../adapters/expert-plugin-resolver.js'
import { ExpertStatusStore, type ExpertStatusSnapshot } from './expert-status-store.js'
import {
  CreateCustomExpertRequestSchema,
  CreateCustomExpertTeamRequestSchema,
  ExpertProfileSchema,
  ExpertTeamSchema,
  type ExpertProfile,
  type ExpertTeam,
  type ExpertTeamMember,
  type CreateCustomExpertRequest,
  type CreateCustomExpertTeamRequest,
  type CreateCustomExpertTeamMemberRequest
} from '../contracts/experts.js'

/**
 * ExpertService — 专家管理服务。
 *
 * 职责：
 * - 初始化时扫描 pluginRoots 加载插件专家/专家团
 * - 合并自定义专家（持久化到 customExpertsDir/{expertId}.json）
 * - 提供 list / get / enable / disable / create / delete 能力
 * - refresh() 重新扫描插件（支持热加载）
 *
 * 设计要点：
 * - 插件加载失败不阻塞其他插件（错误收集到 validationErrors）
 * - 自定义专家以 JSON 文件形式持久化，文件名 = {expertId}.json
 * - enable/disable 状态仅对自定义专家持久化；插件专家状态为内存态
 *   （MVP；Beta 可持久化到索引文件）
 */

/** 自定义专家持久化文件格式 */
type CustomExpertFile = {
  id: string
  kind: 'expert' | 'team'
  expert?: ExpertProfile
  team?: ExpertTeam
}

export type ExpertServiceOptions = {
  pluginRoots: readonly string[]
  customExpertsDir: string
}

export type ExpertServiceDiagnostics = {
  enabled: boolean
  pluginRoots: string[]
  customExpertsDir: string
  expertCount: number
  teamCount: number
  customCount: number
  validationErrors: Array<{ plugin: string; message: string }>
}

export class ExpertService {
  private experts = new Map<string, ExpertProfile>()
  private teams = new Map<string, ExpertTeam>()
  private validationErrors: Array<{ plugin: string; message: string }> = []
  private readonly customExpertsDir: string
  private readonly statusStore: ExpertStatusStore
  private statusRevision: number = 0

  constructor(private readonly options: ExpertServiceOptions) {
    this.customExpertsDir = expandHomePath(options.customExpertsDir)
    this.statusStore = new ExpertStatusStore(expandHomePath(options.pluginRoots[0] || options.customExpertsDir))
  }

  /** 初始化：扫描插件 + 加载自定义专家 + 加载持久化状态 */
  async initialize(): Promise<void> {
    await this.refresh()
    await this.loadCustomExperts()
    await this.loadStatus()
  }

  /** 加载持久化的 enabled/disabled 状态 */
  private async loadStatus(): Promise<void> {
    const snapshot = await this.statusStore.load()
    this.statusRevision = snapshot.revision

    for (const [id, entry] of snapshot.entries) {
      const expert = this.experts.get(id)
      if (expert) {
        expert.enabled = entry.enabled
      }
      const team = this.teams.get(id)
      if (team) {
        team.enabled = entry.enabled
      }
    }
  }

  /** 重新扫描插件目录并重建内存索引（保留自定义专家） */
  async refresh(): Promise<void> {
    const result = await resolveExpertPlugins(this.options.pluginRoots)
    this.validationErrors = result.validationErrors

    // 保留自定义专家，仅替换插件来源的条目
    for (const [id, expert] of this.experts) {
      if (expert.isCustom) continue
      this.experts.delete(id)
    }
    for (const [id, team] of this.teams) {
      if (team.isCustom) continue
      this.teams.delete(id)
    }

    for (const expert of result.experts) {
      this.experts.set(expert.id, expert)
    }
    for (const team of result.teams) {
      this.teams.set(team.id, team)
    }
  }

  /** 列出所有专家（含自定义） */
  listExperts(): ExpertProfile[] {
    return Array.from(this.experts.values())
  }

  /** 列出所有专家团（含自定义） */
  listTeams(): ExpertTeam[] {
    return Array.from(this.teams.values())
  }

  /** 获取单个专家 */
  getExpert(id: string): ExpertProfile | undefined {
    return this.experts.get(id)
  }

  /** 获取单个专家团 */
  getExpertTeam(id: string): ExpertTeam | undefined {
    return this.teams.get(id)
  }

  /** 启用/停用专家/专家团 (async with persistence) */
  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const expert = this.experts.get(id)
    const team = this.teams.get(id)

    if (!expert && !team) {
      return false
    }

    // Update in-memory state
    if (expert) {
      expert.enabled = enabled
    }
    if (team) {
      team.enabled = enabled
    }

    // Persist to disk
    const snapshot = await this.statusStore.load()
    snapshot.entries.set(id, { enabled, updatedAt: new Date().toISOString() })
    await this.statusStore.save(
      { revision: snapshot.revision + 1, entries: snapshot.entries },
      snapshot.revision
    )
    this.statusRevision = snapshot.revision + 1

    return true
  }

  /** 启用专家/专家团 */
  enableExpert(id: string): boolean {
    const expert = this.experts.get(id)
    if (expert) {
      expert.enabled = true
      return true
    }
    const team = this.teams.get(id)
    if (team) {
      team.enabled = true
      return true
    }
    return false
  }

  /** 停用专家/专家团 */
  disableExpert(id: string): boolean {
    const expert = this.experts.get(id)
    if (expert) {
      expert.enabled = false
      return true
    }
    const team = this.teams.get(id)
    if (team) {
      team.enabled = false
      return true
    }
    return false
  }

  /** 创建自定义专家并持久化 */
  async createCustomExpert(request: CreateCustomExpertRequest): Promise<ExpertProfile> {
    const parsed = CreateCustomExpertRequestSchema.parse(request)
    const id = this.generateUniqueCustomId('expert')
    const now = new Date().toISOString()
    const expert: ExpertProfile = {
      id,
      pluginName: id,
      displayName: parsed.name.trim(),
      description: parsed.description.trim(),
      profession: (parsed.profession ?? '').trim() || parsed.name.trim(),
      domainTags: dedupe(parsed.domainTags),
      roleDefinition: parsed.roleDefinition.trim(),
      behaviorRules: (parsed.behaviorRules ?? '').trim() || undefined,
      outputPreferences: (parsed.outputPreferences ?? '').trim() || undefined,
      skillRefs: dedupe(parsed.skillRefs),
      sourcePlugin: this.customExpertsDir,
      enabled: true,
      isCustom: true,
      quickPrompts: parsed.quickPrompts.map((p) => p.trim()).filter((p) => p.length > 0),
      ...(parsed.defaultInitPrompt?.trim() ? { defaultInitPrompt: parsed.defaultInitPrompt.trim() } : {}),
      version: '1.0.0',
      updatedAt: now
    }
    await this.persistCustomExpert({ id, kind: 'expert', expert })
    this.experts.set(id, expert)
    return expert
  }

  /** 创建自定义专家团并持久化 */
  async createCustomExpertTeam(request: CreateCustomExpertTeamRequest): Promise<ExpertTeam> {
    const parsed = CreateCustomExpertTeamRequestSchema.parse(request)
    const id = this.generateUniqueCustomId('team')
    const now = new Date().toISOString()
    const team: ExpertTeam = {
      id,
      pluginName: id,
      displayName: parsed.name.trim(),
      description: parsed.description.trim(),
      domainTags: dedupe(parsed.domainTags),
      members: normalizeMembers(parsed.members),
      workflow: parsed.workflow.trim(),
      deliverableSpec: (parsed.deliverableSpec ?? '').trim(),
      skillRefs: dedupe(parsed.skillRefs),
      sourcePlugin: this.customExpertsDir,
      enabled: true,
      isCustom: true,
      version: '1.0.0',
      updatedAt: now
    }
    await this.persistCustomExpert({ id, kind: 'team', team })
    this.teams.set(id, team)
    return team
  }

  /** 删除自定义专家/专家团；非自定义返回 false */
  async deleteCustomExpert(id: string): Promise<boolean> {
    // Strict path validation: reject path traversal
    if (id.includes('..') || id.includes('/') || id.includes('\\')) {
      return false
    }

    const expert = this.experts.get(id)
    if (expert?.isCustom) {
      this.experts.delete(id)
      await this.deleteCustomFile(id)

      // Remove from status
      const snapshot = await this.statusStore.load()
      snapshot.entries.delete(id)
      await this.statusStore.save(
        { revision: snapshot.revision + 1, entries: snapshot.entries },
        snapshot.revision
      )
      this.statusRevision = snapshot.revision + 1

      return true
    }
    const team = this.teams.get(id)
    if (team?.isCustom) {
      this.teams.delete(id)
      await this.deleteCustomFile(id)

      // Remove from status
      const snapshot = await this.statusStore.load()
      snapshot.entries.delete(id)
      await this.statusStore.save(
        { revision: snapshot.revision + 1, entries: snapshot.entries },
        snapshot.revision
      )
      this.statusRevision = snapshot.revision + 1

      return true
    }
    return false
  }

  /** 诊断信息 */
  diagnostics(): ExpertServiceDiagnostics {
    return {
      enabled: true,
      pluginRoots: [...this.options.pluginRoots],
      customExpertsDir: this.customExpertsDir,
      expertCount: this.experts.size,
      teamCount: this.teams.size,
      customCount:
        Array.from(this.experts.values()).filter((e) => e.isCustom).length +
        Array.from(this.teams.values()).filter((t) => t.isCustom).length,
      validationErrors: [...this.validationErrors]
    }
  }

  // ─────────────── 内部：自定义专家持久化 ───────────────

  /**
   * 原子写入：先写临时文件再 rename，避免写入一半进程崩溃导致 JSON 损坏。
   * 临时文件与目标文件同目录，保证 rename 在同一设备上完成。
   */
  private async persistCustomExpert(file: CustomExpertFile): Promise<void> {
    await mkdir(this.customExpertsDir, { recursive: true })
    const filePath = join(this.customExpertsDir, `${file.id}.json`)
    const tempPath = join(this.customExpertsDir, `.${file.id}.tmp.${randomBytes(4).toString('hex')}`)
    await writeFile(tempPath, JSON.stringify(file, null, 2), 'utf8')
    try {
      await rename(tempPath, filePath)
    } catch (err) {
      try {
        await unlink(tempPath)
      } catch {
        // 忽略清理失败
      }
      throw err
    }
  }

  /**
   * 生成自定义专家/专家团 id，并在内存索引上做冲突检测。
   * 时间戳 + 随机后缀保证快速连续创建也不会冲突。
   */
  private generateUniqueCustomId(kind: 'expert' | 'team'): string {
    let id = `custom_${kind}_${randomBytes(6).toString('hex')}`
    while (this.experts.has(id) || this.teams.has(id)) {
      id = `custom_${kind}_${randomBytes(6).toString('hex')}`
    }
    return id
  }

  private async deleteCustomFile(id: string): Promise<void> {
    const filePath = join(this.customExpertsDir, `${id}.json`)
    try {
      await rm(filePath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
    }
  }

  private async loadCustomExperts(): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(this.customExpertsDir)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return
      throw error
    }
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const filePath = join(this.customExpertsDir, entry)
      try {
        const text = await readFile(filePath, 'utf8')
        const file = JSON.parse(text) as CustomExpertFile
        // 用 schema 校验每个文件，损坏/不兼容的文件跳过且不抛错，
        // 避免单个坏文件影响整个列表加载。
        if (file.kind === 'expert' && file.expert) {
          this.experts.set(file.expert.id, ExpertProfileSchema.parse(file.expert))
        } else if (file.kind === 'team' && file.team) {
          this.teams.set(file.team.id, ExpertTeamSchema.parse(file.team))
        }
      } catch {
        // 跳过损坏的自定义专家文件，不阻塞初始化
      }
    }
  }
}

// ─────────────── 模块级工具函数（导出便于测试） ───────────────

/** 去除空白项并去重，保持顺序。 */
function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const value = item.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

/**
 * 把成员输入（可能是中文 roleLabel 或非法字符）规范化为符合
 * `^[a-z0-9_-]+$` 的 agentName。空串或纯数字开头会补前缀，重复时追加 -2、-3。
 *
 * profile id 形如 `{teamId}/{agentName}`，agentName 的字符集约束可避免
 * 路径分隔符或特殊字符导致 profile id 冲突。
 */
export function normalizeAgentName(input: string, existing: Set<string>): string {
  let normalized = input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')

  if (!normalized || /^\d/.test(normalized)) {
    normalized = `agent-${normalized || 'member'}`
  }

  let candidate = normalized
  let suffix = 2
  while (existing.has(candidate)) {
    candidate = `${normalized}-${suffix}`
    suffix++
  }
  return candidate
}

/**
 * 规范化专家团成员列表：
 * - 第一个成员 agentName 固定为 `lead`（除非用户已填入合法值，仍优先 lead）
 * - 其余成员用 normalizeAgentName(roleLabel / agentName) 生成稳定 id
 * - agentName 全局去重（重复时追加 -2、-3）
 */
export function normalizeMembers(
  members: readonly CreateCustomExpertTeamMemberRequest[]
): ExpertTeamMember[] {
  const used = new Set<string>()
  used.add('lead')
  return members.map((m, idx) => {
    let agentName: string
    if (idx === 0) {
      // 第一个成员固定为 lead，保证专家团 lead profile id 稳定
      agentName = 'lead'
    } else {
      const source = m.agentName?.trim() || m.roleLabel
      agentName = normalizeAgentName(source, used)
    }
    used.add(agentName)
    return {
      agentName,
      roleLabel: m.roleLabel.trim(),
      roleDefinition: m.roleDefinition.trim(),
      skillRefs: dedupe(m.skillRefs ?? [])
    }
  })
}
