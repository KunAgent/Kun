import { z } from 'zod'

/**
 * 专家/专家团 contracts — 映射 .codebuddy-plugin/plugin.json 结构，
 * 定义专家插件 manifest、专家 profile、专家团与自定义创建请求。
 * 专家选择不是"切换运行时"，而是注入 systemPrompt + 复用 delegation。
 */

/** 专家类型：单专家 / 专家团 */
export const ExpertType = z.enum(['agent', 'team'])
export type ExpertType = z.infer<typeof ExpertType>

/** 多语言文本（zh/en） */
export const LocalizedTextSchema = z
  .object({
    zh: z.string().min(1),
    en: z.string().min(1)
  })
  .strict()
export type LocalizedText = z.infer<typeof LocalizedTextSchema>

/**
 * 专家插件 manifest（映射 .codebuddy-plugin/plugin.json 结构）。
 * expertType 区分单专家与专家团；teamInfo 仅在 expertType='team' 时存在。
 */
export const ExpertPluginManifestSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().min(1),
    expertType: ExpertType,
    /** 单专家时指向 agents/{agentName}.md */
    agentName: z.string().min(1).optional(),
    /** 专家团信息（expertType='team' 时存在） */
    teamInfo: z
      .object({
        leadAgent: z.string().min(1),
        memberAgents: z.array(z.string().min(1)).default([])
      })
      .strict()
      .optional(),
    displayName: LocalizedTextSchema,
    profession: LocalizedTextSchema,
    displayDescription: LocalizedTextSchema,
    avatar: z.string().optional(),
    categoryId: z.string().optional(),
    tags: z.array(LocalizedTextSchema).default([]),
    quickPrompts: z.array(LocalizedTextSchema).default([]),
    defaultInitPrompt: LocalizedTextSchema,
    /** 关联技能 ID 列表 */
    skills: z.array(z.string().min(1)).default([]),
    /** 专家团成员 agent 文件列表（expertType='team'） */
    agents: z.array(z.string().min(1)).default([])
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (manifest.expertType === 'agent' && !manifest.agentName) {
      ctx.addIssue({
        code: 'custom',
        path: ['agentName'],
        message: "agentName is required when expertType is 'agent'"
      })
    }
    if (manifest.expertType === 'team' && !manifest.teamInfo) {
      ctx.addIssue({
        code: 'custom',
        path: ['teamInfo'],
        message: "teamInfo is required when expertType is 'team'"
      })
    }
  })
export type ExpertPluginManifest = z.infer<typeof ExpertPluginManifestSchema>

/** 专家（单专家 profile） */
export const ExpertProfileSchema = z
  .object({
    /** 从 plugin.name 派生，保持原值 */
    id: z.string().min(1),
    pluginName: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().min(1),
    profession: z.string().min(1),
    avatarPath: z.string().optional(),
    domainTags: z.array(z.string()).default([]),
    /** agents/*.md 文件内容（角色定义） */
    roleDefinition: z.string().min(1),
    behaviorRules: z.string().optional(),
    outputPreferences: z.string().optional(),
    /** 关联技能 ID 列表 */
    skillRefs: z.array(z.string().min(1)).default([]),
    /** 插件目录路径 */
    sourcePlugin: z.string().min(1),
    enabled: z.boolean().default(true),
    isCustom: z.boolean().default(false),
    categoryId: z.string().optional(),
    quickPrompts: z.array(z.string()).default([]),
    defaultInitPrompt: z.string().optional(),
    version: z.string().min(1),
    updatedAt: z.string()
  })
  .strict()
export type ExpertProfile = z.infer<typeof ExpertProfileSchema>

/** 专家团成员 */
export const ExpertTeamMemberSchema = z
  .object({
    /** 对应 agents/*.md 文件名（不含扩展名） */
    agentName: z.string().min(1),
    /** 角色定义 markdown 内容 */
    roleDefinition: z.string().min(1),
    /** 成员职责简述 */
    roleLabel: z.string().min(1),
    skillRefs: z.array(z.string().min(1)).default([])
  })
  .strict()
export type ExpertTeamMember = z.infer<typeof ExpertTeamMemberSchema>

/** 专家团 */
export const ExpertTeamSchema = z
  .object({
    id: z.string().min(1),
    pluginName: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().min(1),
    domainTags: z.array(z.string()).default([]),
    members: z.array(ExpertTeamMemberSchema).min(1),
    /** 协作流程描述 */
    workflow: z.string().min(1),
    /** 交付物要求 */
    deliverableSpec: z.string().min(1),
    skillRefs: z.array(z.string().min(1)).default([]),
    sourcePlugin: z.string().min(1),
    enabled: z.boolean().default(true),
    isCustom: z.boolean().default(false),
    categoryId: z.string().optional(),
    version: z.string().min(1),
    updatedAt: z.string()
  })
  .strict()
export type ExpertTeam = z.infer<typeof ExpertTeamSchema>

/** 自定义专家创建请求 */
export const CreateCustomExpertRequestSchema = z
  .object({
    name: z.string().min(1).max(100),
    profession: z.string().max(50).optional(),
    description: z.string().min(1).max(500),
    domainTags: z.array(z.string().min(1).max(50)).min(1).max(10).default([]),
    roleDefinition: z.string().min(10).max(5000),
    behaviorRules: z.string().max(2000).optional(),
    outputPreferences: z.string().max(2000).optional(),
    skillRefs: z.array(z.string().min(1).max(100)).max(20).default([]),
    quickPrompts: z.array(z.string().min(1).max(200)).max(10).default([]),
    defaultInitPrompt: z.string().max(500).optional()
  })
  .strict()
export type CreateCustomExpertRequest = z.infer<typeof CreateCustomExpertRequestSchema>

/**
 * 自定义专家团成员创建请求。
 * agentName 可选（允许用户不填）；服务端会用 normalizeAgentName 规范化，
 * 并保证第一个成员固定为 lead。提供时必须匹配 ^[a-z0-9_-]+$。
 */
export const CreateCustomExpertTeamMemberRequestSchema = z
  .object({
    agentName: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-z0-9_-]+$/, 'agentName may only contain lowercase letters, digits, underscore and hyphen')
      .optional(),
    roleLabel: z.string().min(1).max(50),
    roleDefinition: z.string().min(10).max(3000),
    skillRefs: z.array(z.string().min(1).max(100)).max(20).default([])
  })
  .strict()
export type CreateCustomExpertTeamMemberRequest = z.infer<
  typeof CreateCustomExpertTeamMemberRequestSchema
>

/** 自定义专家团创建请求 */
export const CreateCustomExpertTeamRequestSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    domainTags: z.array(z.string().min(1).max(50)).min(1).max(10).default([]),
    workflow: z.string().min(10).max(5000),
    deliverableSpec: z.string().max(2000).default(''),
    skillRefs: z.array(z.string().min(1).max(100)).max(20).default([]),
    members: z.array(CreateCustomExpertTeamMemberRequestSchema).min(1).max(10)
  })
  .strict()
export type CreateCustomExpertTeamRequest = z.infer<typeof CreateCustomExpertTeamRequestSchema>

/** 专家列表响应 */
export const ListExpertsResponseSchema = z
  .object({
    experts: z.array(ExpertProfileSchema).default([]),
    teams: z.array(ExpertTeamSchema).default([])
  })
  .strict()
export type ListExpertsResponse = z.infer<typeof ListExpertsResponseSchema>

/** 专家详情响应 */
export const ExpertDetailResponseSchema = z
  .object({
    expert: ExpertProfileSchema.optional(),
    team: ExpertTeamSchema.optional()
  })
  .strict()
export type ExpertDetailResponse = z.infer<typeof ExpertDetailResponseSchema>

/** 启用/停用专家请求 */
export const UpdateExpertStatusRequestSchema = z
  .object({
    enabled: z.boolean()
  })
  .strict()
export type UpdateExpertStatusRequest = z.infer<typeof UpdateExpertStatusRequestSchema>

/** 删除专家响应 */
export const DeleteExpertResponseSchema = z
  .object({
    id: z.string().min(1),
    deleted: z.literal(true)
  })
  .strict()
export type DeleteExpertResponse = z.infer<typeof DeleteExpertResponseSchema>
