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
  isSafePromptPattern
} from './skill-runtime-support.js'

export const DEFAULT_ACTIVE_LIMIT = 3
export const DEFAULT_INSTRUCTION_BUDGET_BYTES = 24_000
export const DEFAULT_CATALOG_BUDGET_BYTES = 8_000
export const MAX_SKILL_PACKAGES_PER_ROOT = 64
export const MAX_MANUAL_SKILL_TURN_ACTIVATIONS = 512
export const MAX_SKILL_MANIFEST_BYTES = 64 * 1024
export const MAX_SKILL_ENTRY_BYTES = 256 * 1024
export const WORKSPACE_SKILL_RELATIVE_DIRS = [
  '.agents/skills',
  '.claude/skills',
  '.codex/skills',
  '.kun/skills',
  'skills'
] as const

export const SkillTriggerManifest = z.object({
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
  assets: z.array(z.string().min(1).max(1_024)).max(128).default([]),
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
  /** Source of the skill, ordered by precedence: project, global, builtin. */
  source: 'project' | 'global' | 'builtin'
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
  builtinRoots?: string[]
  skills: Array<{
    id: string
    name: string
    description?: string
    version: string
    root: string
    source: 'project' | 'global' | 'builtin'
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

export const MAX_WORKSPACE_SKILL_CACHES = 128
