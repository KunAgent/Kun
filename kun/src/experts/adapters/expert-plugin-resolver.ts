import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expandHomePath } from '../../config/kun-config.js'
import {
  ExpertPluginManifestSchema,
  type ExpertPluginManifest,
  type ExpertProfile,
  type ExpertTeam,
  type ExpertTeamMember
} from '../contracts/experts.js'

/**
 * 专家插件解析器 — 扫描 pluginRoots 下的每个子目录，读取
 * .codebuddy-plugin/plugin.json，根据 expertType 加载 agents/*.md
 * 角色定义，构建 ExpertProfile / ExpertTeam。
 *
 * 设计要点：
 * - 无效插件跳过且不阻塞其他插件（收集 validationErrors）
 * - 专家团 workflow / deliverableSpec 从 lead agent markdown 推断
 *   （plugin.json 未直接提供这两个字段；使用 manifest.description
 *   与 lead agent 内容作为合理回退）
 * - skills 引用列表原样保留为 skillRefs（路径或名称），由 ExpertService
 *   关联到已加载的 SkillRuntime
 * - 不做文件监听；热加载由 ExpertService.refresh() 驱动
 */

export type ExpertPluginResolverResult = {
  experts: ExpertProfile[]
  teams: ExpertTeam[]
  validationErrors: Array<{ plugin: string; message: string }>
}

/** 单个插件的解析中间态 */
type ParsedPlugin = {
  pluginDir: string
  manifest: ExpertPluginManifest
}

/**
 * 扫描所有 pluginRoots，返回解析出的专家/专家团与错误列表。
 * 相对路径相对于 cwd 解析；~ 开头展开为 home 目录。
 */
export async function resolveExpertPlugins(
  pluginRoots: readonly string[]
): Promise<ExpertPluginResolverResult> {
  const experts: ExpertProfile[] = []
  const teams: ExpertTeam[] = []
  const validationErrors: Array<{ plugin: string; message: string }> = []

  for (const root of pluginRoots) {
    const rootPath = expandHomePath(root)
    let entries: string[]
    try {
      entries = await readdir(rootPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      throw error
    }
    for (const entry of entries) {
      const pluginDir = join(rootPath, entry)
      try {
        const info = await stat(pluginDir)
        if (!info.isDirectory()) continue
      } catch {
        continue
      }
      try {
        const parsed = await resolveSinglePlugin(pluginDir)
        if (!parsed) continue
        if (parsed.manifest.expertType === 'agent') {
          const profile = await buildExpertProfile(pluginDir, parsed.manifest)
          if (profile) experts.push(profile)
        } else {
          const team = await buildExpertTeam(pluginDir, parsed.manifest)
          if (team) teams.push(team)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        validationErrors.push({ plugin: entry, message })
      }
    }
  }

  return { experts, teams, validationErrors }
}

/** 读取并校验单个插件的 manifest；返回 null 表示不是专家插件 */
async function resolveSinglePlugin(pluginDir: string): Promise<ParsedPlugin | null> {
  const manifestPath = await findManifestPath(pluginDir)
  if (!manifestPath) return null
  const text = await readFile(manifestPath, 'utf8')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new Error(
      `failed to parse plugin.json: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const parsed = ExpertPluginManifestSchema.safeParse(normalizeManifestInput(json))
  if (!parsed.success) {
    throw new Error(
      `invalid plugin manifest: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    )
  }
  return { pluginDir, manifest: parsed.data }
}

async function findManifestPath(pluginDir: string): Promise<string | null> {
  const candidates = [
    join(pluginDir, '.codebuddy-plugin', 'plugin.json'),
    join(pluginDir, 'plugin.json')
  ]
  for (const candidate of candidates) {
    try {
      await stat(candidate)
      return candidate
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
    }
  }
  return null
}

function normalizeManifestInput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const raw = value as Record<string, unknown>
  return {
    name: raw.name,
    version: raw.version,
    description: raw.description,
    expertType: raw.expertType,
    agentName: raw.agentName,
    teamInfo: raw.teamInfo,
    displayName: raw.displayName,
    profession: raw.profession,
    displayDescription: raw.displayDescription,
    avatar: raw.avatar,
    categoryId: raw.categoryId,
    tags: raw.tags,
    quickPrompts: raw.quickPrompts,
    defaultInitPrompt: raw.defaultInitPrompt,
    skills: raw.skills,
    agents: raw.agents
  }
}

/** 构建单专家 ExpertProfile */
async function buildExpertProfile(
  pluginDir: string,
  manifest: ExpertPluginManifest
): Promise<ExpertProfile | null> {
  const agentName = manifest.agentName
  if (!agentName) return null
  const roleDefinition = await readAgentFile(pluginDir, agentName)
  if (!roleDefinition) return null

  const now = new Date().toISOString()
  return {
    id: manifest.name,
    pluginName: manifest.name,
    displayName: pickLocalized(manifest.displayName, 'zh'),
    description: pickLocalized(manifest.displayDescription, 'zh') || manifest.description,
    profession: pickLocalized(manifest.profession, 'zh'),
    avatarPath: manifest.avatar ? resolve(pluginDir, manifest.avatar) : undefined,
    domainTags: manifest.tags.map((t) => pickLocalized(t, 'zh')).filter(Boolean),
    roleDefinition,
    skillRefs: manifest.skills.map((s) => s.replace(/^\.\//, '')),
    sourcePlugin: pluginDir,
    enabled: true,
    isCustom: false,
    categoryId: manifest.categoryId,
    quickPrompts: manifest.quickPrompts.map((p) => pickLocalized(p, 'zh')).filter(Boolean),
    defaultInitPrompt: pickLocalized(manifest.defaultInitPrompt, 'zh'),
    version: manifest.version,
    updatedAt: now
  }
}

/** 构建专家团 ExpertTeam */
async function buildExpertTeam(
  pluginDir: string,
  manifest: ExpertPluginManifest
): Promise<ExpertTeam | null> {
  const teamInfo = manifest.teamInfo
  if (!teamInfo) return null

  const leadAgentName = teamInfo.leadAgent
  const leadRole = await readAgentFile(pluginDir, leadAgentName)
  if (!leadRole) return null

  const members: ExpertTeamMember[] = []
  // lead agent 作为第一个成员
  members.push({
    agentName: leadAgentName,
    roleDefinition: leadRole,
    roleLabel: pickLocalized(manifest.profession, 'zh'),
    skillRefs: manifest.skills.map((s) => s.replace(/^\.\//, ''))
  })
  // 其余 member agents
  for (const memberName of teamInfo.memberAgents) {
    const roleDefinition = await readAgentFile(pluginDir, memberName)
    if (!roleDefinition) continue
    members.push({
      agentName: memberName,
      roleDefinition,
      roleLabel: memberName,
      skillRefs: []
    })
  }

  const now = new Date().toISOString()
  return {
    id: manifest.name,
    pluginName: manifest.name,
    displayName: pickLocalized(manifest.displayName, 'zh'),
    description: pickLocalized(manifest.displayDescription, 'zh') || manifest.description,
    domainTags: manifest.tags.map((t) => pickLocalized(t, 'zh')).filter(Boolean),
    members,
    // plugin.json 未直接提供 workflow / deliverableSpec；使用
    // manifest.description 作为 workflow 的合理回退，lead agent
    // 角色定义中通常已包含协作流程描述
    workflow: manifest.description,
    deliverableSpec: pickLocalized(manifest.displayDescription, 'zh') || manifest.description,
    skillRefs: manifest.skills.map((s) => s.replace(/^\.\//, '')),
    sourcePlugin: pluginDir,
    enabled: true,
    isCustom: false,
    categoryId: manifest.categoryId,
    version: manifest.version,
    updatedAt: now
  }
}

/** 读取 agents/{agentName}.md 文件内容；不存在时返回 null */
async function readAgentFile(pluginDir: string, agentName: string): Promise<string | null> {
  // 尝试 agents/{agentName}.md 和 {agentName}.md 两种路径
  const candidates = [
    join(pluginDir, 'agents', `${agentName}.md`),
    join(pluginDir, `${agentName}.md`)
  ]
  for (const filePath of candidates) {
    try {
      const content = await readFile(filePath, 'utf8')
      return content.trim() || null
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
    }
  }
  return null
}

/** 从多语言对象中按偏好选取文本；缺失时回退到另一语言 */
function pickLocalized(
  value: { zh: string; en: string } | undefined,
  prefer: 'zh' | 'en'
): string {
  if (!value) return ''
  return value[prefer] || value.en || value.zh || ''
}
