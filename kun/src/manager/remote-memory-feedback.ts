import { z } from 'zod'
import type { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import {
  MemoryConfirmResult,
  MemoryCorrectResult,
  MemoryFeedbackAggregate,
  MemoryFeedbackDiagnostics,
  MemoryFeedbackEvent,
  MemoryFeedbackOperationError,
  type MemoryConfirmRequest,
  type MemoryCorrectRequest,
  type MemoryFeedbackConfig,
  type MemoryFeedbackEvent as MemoryFeedbackEventValue
} from '../contracts/memory-feedback.js'
import { MemoryFeedbackServiceError } from '../memory/memory-feedback-service.js'
import type {
  MemoryFeedbackAppendResult,
  MemoryFeedbackStore
} from '../memory/memory-feedback-store.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { callManagerStore } from './remote-data-store-request.js'

const AppendResult = z.enum(['appended', 'replayed'])
const ConfirmOutcome = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: MemoryConfirmResult }).strict(),
  z.object({ ok: z.literal(false), error: MemoryFeedbackOperationError }).strict()
])
const CorrectOutcome = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: MemoryCorrectResult }).strict(),
  z.object({ ok: z.literal(false), error: MemoryFeedbackOperationError }).strict()
])

/** RPC-only feedback adapter. Durable ledger and correction receipts remain Manager-owned. */
export class ManagerRemoteMemoryFeedback implements MemoryFeedbackStore {
  constructor(
    private readonly manager: ServiceManagerConnection,
    private readonly memoryConfig: MemoryCapabilityConfig,
    private readonly feedbackConfig: MemoryFeedbackConfig
  ) {}

  async ready(): Promise<void> {
    await this.call('feedbackReady')
  }

  async append(event: MemoryFeedbackEventValue): Promise<MemoryFeedbackAppendResult> {
    return AppendResult.parse(await this.call('feedbackAppend', event))
  }

  async event(eventId: string) {
    return MemoryFeedbackEvent.nullable().parse(
      await this.call('feedbackEvent', { id: eventId })
    ) ?? undefined
  }

  async aggregate(memoryId: string) {
    return MemoryFeedbackAggregate.nullable().parse(
      await this.call('feedbackAggregate', { memoryId })
    ) ?? undefined
  }

  async listAggregates() {
    return MemoryFeedbackAggregate.array().parse(await this.call('feedbackAggregates'))
  }

  async diagnostics() {
    return MemoryFeedbackDiagnostics.parse(await this.call('feedbackDiagnostics'))
  }

  async confirm(request: MemoryConfirmRequest) {
    const outcome = ConfirmOutcome.parse(await this.call('feedbackConfirm', request))
    if (!outcome.ok) throw new MemoryFeedbackServiceError(outcome.error.code, outcome.error.message)
    return outcome.result
  }

  async correct(request: MemoryCorrectRequest) {
    const outcome = CorrectOutcome.parse(await this.call('feedbackCorrect', request))
    if (!outcome.ok) throw new MemoryFeedbackServiceError(outcome.error.code, outcome.error.message)
    return outcome.result
  }

  private call(operation: string, value?: unknown): Promise<unknown> {
    return callManagerStore(this.manager, 'memory', operation, {
      config: this.memoryConfig,
      feedbackConfig: this.feedbackConfig,
      value: value ?? {}
    })
  }
}
