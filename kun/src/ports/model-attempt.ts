import type { UsageSnapshot } from '../contracts/usage.js'

export type ModelAttemptInput = { providerId: string; model: string; protocol: string;
  inputUpperBound?: number; maxOutputTokens?: number; estimatedTokens: number }
export type ModelAttemptLease = { finish(usage?: UsageSnapshot, dispatched?: boolean): Promise<void> }
export type ModelAttemptObserver = { begin(input: ModelAttemptInput): Promise<ModelAttemptLease> }
