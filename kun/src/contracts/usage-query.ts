import { z } from 'zod'
import {
  DailyUsageResponseSchema,
  ModelUsageResponseSchema,
  ThreadUsageResponseSchema,
  TurnUsageResponseSchema
} from './usage.js'
import { ProviderLocalCostSummarySchema } from './provider-quota.js'
import { UsageSnapshotSchema } from './usage.js'

const IsoTimestampSchema = z.string().datetime()
const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const RangeSchema = z.object({
  from: DateStringSchema,
  to: DateStringSchema,
  timezone: z.string().min(1),
  fromInclusive: IsoTimestampSchema,
  toExclusive: IsoTimestampSchema
})

export const SessionUsageAggregateQuerySchema = z.discriminatedUnion('groupBy', [
  z.object({
    groupBy: z.literal('thread'),
    threadId: z.string().min(1).max(512).optional()
  }).strict(),
  RangeSchema.extend({ groupBy: z.literal('day') }).strict(),
  RangeSchema.extend({ groupBy: z.literal('model') }).strict(),
  z.object({
    groupBy: z.literal('turn'),
    threadId: z.string().min(1).max(512)
  }).strict(),
  z.object({
    groupBy: z.literal('provider_local_cost'),
    profiles: z.array(z.object({
      id: z.string().min(1),
      presetId: z.string().min(1).optional()
    }).strict()).max(256),
    now: IsoTimestampSchema
  }).strict()
])
export type SessionUsageAggregateQuery = z.infer<typeof SessionUsageAggregateQuerySchema>

export const SessionUsageRecordSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1).optional(),
  model: z.string().optional(),
  providerId: z.string().optional(),
  completedAt: IsoTimestampSchema,
  usage: UsageSnapshotSchema,
  cumulative: z.boolean().optional()
}).strict()

export const SessionUsageAggregateRequestSchema = z.object({
  query: SessionUsageAggregateQuerySchema,
  liveRecords: z.array(SessionUsageRecordSchema).max(10_000).default([])
}).strict()
export type SessionUsageAggregateRequest = z.infer<typeof SessionUsageAggregateRequestSchema>

export const SessionUsageAggregateResponseSchema = z.union([
  ThreadUsageResponseSchema,
  DailyUsageResponseSchema,
  ModelUsageResponseSchema,
  TurnUsageResponseSchema,
  z.record(z.string(), ProviderLocalCostSummarySchema)
])
export type SessionUsageAggregateResponse = z.infer<typeof SessionUsageAggregateResponseSchema>
