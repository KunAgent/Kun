import { z } from 'zod'
import { MAX_PATH_LENGTH, trimmedString } from './common'

const MAX_GIT_PATHS = 5_000

const workspaceRoot = trimmedString(MAX_PATH_LENGTH)
const repositoryPath = z.string().min(1).max(MAX_PATH_LENGTH).refine((path) => !path.includes('\0'))

export const gitWorkspacePayloadSchema = workspaceRoot

export const gitPathsPayloadSchema = z
  .object({
    workspaceRoot,
    paths: z.array(repositoryPath).min(1).max(MAX_GIT_PATHS).optional()
  })
  .strict()

export const gitDiscardPayloadSchema = z
  .object({
    workspaceRoot,
    paths: z.array(repositoryPath).min(1).max(MAX_GIT_PATHS),
    confirmed: z.literal(true)
  })
  .strict()

export const gitFileDiffPayloadSchema = z
  .object({
    workspaceRoot,
    side: z.enum(['unstaged', 'staged', 'branch']),
    path: repositoryPath,
    previousPath: repositoryPath.optional(),
    mergeBase: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/).optional(),
    untracked: z.boolean().optional()
  })
  .strict()

export const gitCommitPayloadSchema = z
  .object({
    workspaceRoot,
    message: z.string().max(64_000),
    stageAll: z.boolean().optional()
  })
  .strict()

export const gitPushPayloadSchema = z.object({ workspaceRoot }).strict()

export const gitCommitMessagePayloadSchema = z
  .object({
    workspaceRoot,
    stageAll: z.boolean().optional()
  })
  .strict()
