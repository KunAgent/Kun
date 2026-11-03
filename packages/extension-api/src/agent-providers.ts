import { z } from 'zod'
import { LocalIdSchema } from './common.js'

const EnvNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)

/**
 * A local command-line Agent an extension adds to Kun's Agent catalog. It
 * speaks the Agent Client Protocol over stdio; Kun owns the process, the
 * sandbox mediation and every approval. Declaring one needs the
 * `agents.register` permission, and Kun still starts it only after the user
 * enables it in the Agent Center.
 */
export const AgentProviderDeclarationSchema = z.strictObject({
  id: LocalIdSchema,
  displayName: z.string().min(1).max(64),
  description: z.string().max(1024).optional(),
  /**
   * A built-in ACP Agent this one is a build of (same protocol behaviour,
   * another command); absent means a generic ACP agent.
   */
  extends: z.string().regex(/^[a-z][a-z0-9-]{1,47}$/).optional(),
  /** Executable name on PATH or an absolute path; never a shell command line. */
  command: z.string().min(1).max(256),
  args: z.array(z.string().max(1024)).max(32).default([]),
  /** Non-secret variables only; credentials stay with the Agent's own sign-in. */
  env: z.record(EnvNameSchema, z.string().max(1024)).default({}),
  docsUrl: z.string().url().max(512).optional(),
  /** Shown to the user when the command is missing; Kun never runs it. */
  installHint: z.string().max(512).optional()
})
export type AgentProviderDeclaration = z.infer<typeof AgentProviderDeclarationSchema>
export type AgentProviderDeclarationInput = z.input<typeof AgentProviderDeclarationSchema>
