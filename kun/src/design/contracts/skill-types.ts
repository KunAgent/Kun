import { z } from 'zod'

// ─── Runtime Skill ───

export const SkillMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().default(''),
  category: z.enum(['design-patterns', 'color-theory', 'typography', 'layout', 'accessibility', 'animation', 'responsive', 'branding', 'ui-components', 'prototyping']).default('design-patterns'),
  tags: z.array(z.string()).default([]),
  author: z.string().default(''),
  version: z.string().default('1.0.0'),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).default('intermediate'),
  estimatedReadingMinutes: z.number().int().positive().default(5),
  prerequisites: z.array(z.string()).default([]),
  relatedSkills: z.array(z.string()).default([]),
  lastUpdated: z.string()
})
export type SkillMetadata = z.infer<typeof SkillMetadataSchema>

export const RuntimeSkillSchema = z.object({
  ...SkillMetadataSchema.shape,
  path: z.string().min(1),
  content: z.string().min(1),
  format: z.enum(['markdown', 'mdx', 'text']).default('markdown'),
  sections: z.array(z.object({
    title: z.string(),
    level: z.number().int().positive(),
    content: z.string()
  })).default([]),
  codeExamples: z.array(z.object({
    language: z.string(),
    code: z.string(),
    description: z.string().default('')
  })).default([]),
  references: z.array(z.object({
    title: z.string(),
    url: z.string().url()
  })).default([]),
  loadedAt: z.string()
})
export type RuntimeSkill = z.infer<typeof RuntimeSkillSchema>

// ─── Static Skill (reference only, not loaded into runtime) ───

export const StaticSkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  path: z.string().min(1),
  category: z.string().default('general'),
  tags: z.array(z.string()).default([]),
  description: z.string().default(''),
  format: z.enum(['markdown', 'mdx', 'text']).default('markdown')
})
export type StaticSkill = z.infer<typeof StaticSkillSchema>

// ─── Skill Search ───

export const SkillSearchSchema = z.object({
  query: z.string().default(''),
  category: z.enum(['design-patterns', 'color-theory', 'typography', 'layout', 'accessibility', 'animation', 'responsive', 'branding', 'ui-components', 'prototyping']).optional(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
  tags: z.array(z.string()).default([]),
  limit: z.number().int().positive().default(50),
  offset: z.number().int().nonnegative().default(0)
})
export type SkillSearch = z.infer<typeof SkillSearchSchema>

// ─── Skill Execution ───

export const SkillExecutionContextSchema = z.object({
  skillId: z.string().min(1),
  threadId: z.string().optional(),
  userPrompt: z.string().default(''),
  additionalContext: z.record(z.string(), z.unknown()).default({})
})
export type SkillExecutionContext = z.infer<typeof SkillExecutionContextSchema>

export const SkillExecutionResultSchema = z.object({
  skillId: z.string(),
  success: z.boolean(),
  injectedContent: z.string().default(''),
  error: z.string().optional(),
  executedAt: z.string()
})
export type SkillExecutionResult = z.infer<typeof SkillExecutionResultSchema>
