import type {
  MemoryConfirmRequest,
  MemoryConfirmResult,
  MemoryCorrectRequest,
  MemoryCorrectResult
} from '../contracts/memory-feedback.js'
import { MemoryFeedbackService } from './memory-feedback-service.js'
import type {
  MemoryFeedbackAppendResult,
  MemoryFeedbackStore
} from './memory-feedback-store.js'

export type MemoryFeedbackRuntime = MemoryFeedbackStore & {
  enabled(): boolean
  confirm(request: MemoryConfirmRequest): Promise<MemoryConfirmResult>
  correct(request: MemoryCorrectRequest): Promise<MemoryCorrectResult>
}

export class LocalMemoryFeedbackRuntime implements MemoryFeedbackRuntime {
  constructor(
    private readonly store: MemoryFeedbackStore,
    private readonly service: MemoryFeedbackService,
    private readonly collectionEnabled: boolean
  ) {}

  enabled(): boolean {
    return this.collectionEnabled
  }

  async ready(): Promise<void> {
    await this.store.ready()
    await this.service.ready()
  }

  append(event: Parameters<MemoryFeedbackStore['append']>[0]): Promise<MemoryFeedbackAppendResult> {
    return this.store.append(event)
  }

  event(eventId: string) {
    return this.store.event(eventId)
  }

  aggregate(memoryId: string) {
    return this.store.aggregate(memoryId)
  }

  listAggregates() {
    return this.store.listAggregates()
  }

  diagnostics() {
    return this.store.diagnostics()
  }

  confirm(request: MemoryConfirmRequest) {
    return this.service.confirm(request)
  }

  correct(request: MemoryCorrectRequest) {
    return this.service.correct(request)
  }
}
