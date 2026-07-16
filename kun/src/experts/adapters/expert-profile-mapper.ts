import type { SubagentProfileConfig } from '../../contracts/capabilities.js'
import type { ExpertProfile, ExpertTeam } from '../contracts/experts.js'

/**
 * 专家 profile 映射器 — 将 ExpertProfile / ExpertTeam 映射为
 * SubagentProfileConfig，注入 delegation runtime 的 profiles map。
 *
 * 设计要点：
 * - 单专家 → mode: 'primary'（可作为会话主 persona）
 * - 专家团 lead agent → mode: 'primary'；member agents → mode: 'subagent'
 * - 专家选择不是"切换运行时"——映射结果只是 profile，由 delegation
 *   runtime 在 thread 创建时注入，不改变运行时本身
 * - toolPolicy 默认 inherit（专家继承主 agent 工具集）
 */

export type MappedProfiles = {
  /** profile id → SubagentProfileConfig */
  profiles: Record<string, SubagentProfileConfig>
  /** 默认主 profile id（单专家 = 专家 id；专家团 = lead agent id） */
  defaultProfile?: string
}

/**
 * 将单个 ExpertProfile 映射为 SubagentProfileConfig。
 * profile id = expert.id（即 plugin.name）。
 */
export function mapExpertProfile(expert: ExpertProfile): SubagentProfileConfig {
  return {
    name: expert.displayName,
    description: expert.description,
    mode: 'primary',
    systemPrompt: expert.roleDefinition,
    toolPolicy: 'inherit',
    ...(expert.behaviorRules ? { promptPreamble: expert.behaviorRules } : {}),
    ...(expert.skillRefs.length > 0 ? { blockedSkills: [] } : {})
  }
}

/**
 * 将专家团映射为一组 SubagentProfileConfig。
 * - lead agent → mode: 'primary'（作为会话主 persona）
 * - member agents → mode: 'subagent'（通过 delegate_task 委派）
 * profile id 格式：`{teamId}/{agentName}`，避免与单专家 id 冲突。
 */
export function mapExpertTeam(team: ExpertTeam): MappedProfiles {
  const profiles: Record<string, SubagentProfileConfig> = {}
  const leadAgent = team.members[0]
  const leadProfileId = `${team.id}/${leadAgent.agentName}`

  profiles[leadProfileId] = {
    name: leadAgent.roleLabel,
    description: team.description,
    mode: 'primary',
    systemPrompt: leadAgent.roleDefinition,
    toolPolicy: 'inherit'
  }

  for (let i = 1; i < team.members.length; i++) {
    const member = team.members[i]
    const profileId = `${team.id}/${member.agentName}`
    profiles[profileId] = {
      name: member.roleLabel,
      description: member.roleLabel,
      mode: 'subagent',
      systemPrompt: member.roleDefinition,
      toolPolicy: 'inherit'
    }
  }

  return { profiles, defaultProfile: leadProfileId }
}

/**
 * 批量映射多个专家和专家团，合并为单个 profiles map。
 * 单专家 id 直接作为 profile id；专家团成员 id 使用 `{teamId}/{agentName}` 格式。
 * 返回第一个单专家或第一个专家团 lead 作为默认 profile。
 */
export function mapAllExperts(
  experts: readonly ExpertProfile[],
  teams: readonly ExpertTeam[]
): MappedProfiles {
  const profiles: Record<string, SubagentProfileConfig> = {}
  let defaultProfile: string | undefined

  for (const expert of experts) {
    profiles[expert.id] = mapExpertProfile(expert)
    if (!defaultProfile) defaultProfile = expert.id
  }

  for (const team of teams) {
    const mapped = mapExpertTeam(team)
    for (const [id, profile] of Object.entries(mapped.profiles)) {
      profiles[id] = profile
    }
    if (!defaultProfile && mapped.defaultProfile) {
      defaultProfile = mapped.defaultProfile
    }
  }

  return { profiles, defaultProfile }
}
