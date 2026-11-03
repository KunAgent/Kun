import { z } from 'zod'
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
export const CodeForkParams = z.object({ threadId: Id, turnId: Id,
  expectedRevision: z.string().regex(/^thread-v1:(0|[1-9][0-9]{0,15})$/), historyVersion: z.string().min(1).max(256),
  title: z.string().trim().min(1).max(160).optional(), beforeTurn: z.boolean().default(false) }).strict()
export const RewindPreviewParams = z.object({ threadId: Id, turnId: Id,
  expectedRevision: z.string().regex(/^thread-v1:(0|[1-9][0-9]{0,15})$/), historyVersion: z.string().min(1).max(256) }).strict()
export const RewindCommitParams = z.object({ threadId: Id, token: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export const CodeHistoryParamSchemas = { 'code.fork': CodeForkParams,
  'code.rewind.preview': RewindPreviewParams, 'code.rewind.commit': RewindCommitParams } as const
export const CODE_HISTORY_READ_METHODS = new Set<string>()
