import { z } from 'zod'
export const ImportedProfile = z.object({ name: z.string().min(1).max(80).refine(value => Boolean(value.trim())),
  title: z.string().max(160).optional(), instructions: z.string().max(8000).optional() }).strict()
export const AgentImportDocument = z.object({ format: z.literal('kun-agent-profile'), version: z.literal(1), profile: ImportedProfile }).strict()
export const AgentImportPreviewRequest = z.object({ document: AgentImportDocument,
  name: z.string().min(1).max(80).refine(value => Boolean(value.trim())).optional() }).strict()
export const AgentImportCommitRequest = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().min(1).max(80).refine(value => Boolean(value.trim())) }).strict()
