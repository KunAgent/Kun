import { z } from 'zod'
import { ThreadRemoteRunMode } from './threads.js'

/**
 * HTTP contracts for the Remote Agent Target API (Issue #647).
 *
 * The renderer uses these to populate the Composer "运行位置 / Run location"
 * picker (SSH host list from the user's ~/.ssh/config), to test a connection
 * before binding a thread, and to load shareable secret-free Remote Profiles.
 */

export const RemoteHostSummarySchema = z.object({
  alias: z.string().min(1),
  hostName: z.string().optional(),
  user: z.string().optional(),
  port: z.number().int().positive().optional(),
  proxyJump: z.string().optional()
})
export type RemoteHostSummary = z.infer<typeof RemoteHostSummarySchema>

export const ListRemoteHostsResponse = z.object({
  hosts: z.array(RemoteHostSummarySchema),
  /** True when ~/.ssh/config existed and was readable. */
  configFound: z.boolean()
})
export type ListRemoteHostsResponse = z.infer<typeof ListRemoteHostsResponse>

export const TestRemoteConnectionRequest = z.object({
  alias: z.string().min(1),
  remoteDir: z.string().min(1).optional()
})
export type TestRemoteConnectionRequest = z.infer<typeof TestRemoteConnectionRequest>

export const RemoteConnectionTestResponse = z.object({
  ok: z.boolean(),
  alias: z.string(),
  remoteDir: z.string().optional(),
  status: z.enum(['connected', 'connecting', 'degraded', 'disconnected', 'error']),
  latencyMs: z.number().optional(),
  os: z.string().optional(),
  branch: z.string().optional(),
  dirty: z.boolean().optional(),
  repoRoot: z.string().optional(),
  tools: z.record(z.string(), z.boolean()).default({}),
  error: z.string().optional()
})
export type RemoteConnectionTestResponse = z.infer<typeof RemoteConnectionTestResponse>

export const RemoteProfileSummarySchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  workspace: z.string().min(1),
  mode: ThreadRemoteRunMode,
  production: z.boolean(),
  healthCheck: z.string().optional(),
  testCommand: z.string().optional(),
  protectedPaths: z.array(z.string()).default([])
})
export type RemoteProfileSummary = z.infer<typeof RemoteProfileSummarySchema>

export const ListRemoteProfilesResponse = z.object({
  profiles: z.array(RemoteProfileSummarySchema)
})
export type ListRemoteProfilesResponse = z.infer<typeof ListRemoteProfilesResponse>
