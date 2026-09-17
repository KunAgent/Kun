import { z } from 'zod'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import {
  MemoryConfirmRequest,
  MemoryCorrectRequest,
  MemoryFeedbackConfig,
  MemoryFeedbackEvent
} from '../contracts/memory-feedback.js'
import { MemoryFeedbackService, MemoryFeedbackServiceError } from '../memory/memory-feedback-service.js'
import { FileMemoryFeedbackStore } from '../memory/memory-feedback-store.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { ManagerMemoryStoreOperation } from './shared-data-store-contracts.js'

const FeedbackId = z.string().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/u)

export class ManagerMemoryFeedbackOwner {
  private feedbackConfig = MemoryFeedbackConfig.parse({})
  private memoryConfig = MemoryCapabilityConfig.parse({})
  private readonly store: FileMemoryFeedbackStore
  private serviceInstance: MemoryFeedbackService | undefined

  constructor(private readonly options: {
    dataDir: string
    memoryStore: (config: z.infer<typeof MemoryCapabilityConfig>) => MemoryStore
  }) {
    this.store = new FileMemoryFeedbackStore({
      dataDir: options.dataDir,
      config: () => this.feedbackConfig
    })
  }

  async execute(operation: ManagerMemoryStoreOperation, value: unknown): Promise<unknown> {
    const body = z.object({
      config: MemoryCapabilityConfig,
      feedbackConfig: MemoryFeedbackConfig,
      value: z.unknown().optional()
    }).strict().parse(value)
    this.memoryConfig = body.config
    this.feedbackConfig = body.feedbackConfig

    switch (operation) {
      case 'feedbackReady':
        await this.store.ready()
        await this.service().ready()
        return null
      case 'feedbackAppend':
        if (!this.feedbackConfig.enabled) {
          throw new MemoryFeedbackServiceError('unavailable', 'memory feedback is disabled')
        }
        return this.store.append(MemoryFeedbackEvent.parse(body.value))
      case 'feedbackEvent':
        return (await this.store.event(z.object({ id: FeedbackId }).strict().parse(body.value).id)) ?? null
      case 'feedbackAggregate':
        return (await this.store.aggregate(
          z.object({ memoryId: FeedbackId }).strict().parse(body.value).memoryId
        )) ?? null
      case 'feedbackAggregates':
        return this.store.listAggregates()
      case 'feedbackDiagnostics':
        return this.store.diagnostics()
      case 'feedbackConfirm':
        return this.explicit(() => this.service().confirm(MemoryConfirmRequest.parse(body.value)))
      case 'feedbackCorrect':
        return this.explicit(() => this.service().correct(MemoryCorrectRequest.parse(body.value)))
      default:
        throw new Error(`unsupported Manager memory feedback operation: ${operation}`)
    }
  }

  private service(): MemoryFeedbackService {
    if (!this.serviceInstance) {
      this.serviceInstance = new MemoryFeedbackService({
        dataDir: this.options.dataDir,
        memoryStore: this.options.memoryStore(this.memoryConfig),
        feedbackStore: this.store,
        config: () => this.feedbackConfig
      })
    }
    return this.serviceInstance
  }

  private async explicit(operation: () => Promise<unknown>): Promise<unknown> {
    try {
      return { ok: true, result: await operation() }
    } catch (error) {
      if (!(error instanceof MemoryFeedbackServiceError)) throw error
      return { ok: false, error: { code: error.code, message: error.message } }
    }
  }
}
