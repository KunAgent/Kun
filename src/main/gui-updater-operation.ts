import type { GuiUpdateChannel } from '../shared/gui-update'

export type GuiUpdateOperationKind = 'check' | 'download'

export type GuiUpdateOperation = {
  generation: number
  kind: GuiUpdateOperationKind
  channel: GuiUpdateChannel
  feedUrl: string
  targetVersion?: string
  startedAt: number
  invalidated: boolean
}

export type DownloadedGuiUpdate = {
  generation: number
  channel: GuiUpdateChannel
  feedUrl: string
  version: string
}

export class GuiUpdateOperationCoordinator {
  private generation = 0
  private lane: Promise<void> = Promise.resolve()
  private active: GuiUpdateOperation | null = null
  private downloaded: DownloadedGuiUpdate | null = null

  invalidate(): number {
    this.generation += 1
    if (this.active) this.active.invalidated = true
    this.downloaded = null
    return this.generation
  }

  currentGeneration(): number {
    return this.generation
  }

  isGenerationCurrent(generation: number): boolean {
    return generation === this.generation
  }

  currentOperation(): GuiUpdateOperation | null {
    return this.active
  }

  isCurrent(operation: GuiUpdateOperation | null | undefined): operation is GuiUpdateOperation {
    return Boolean(operation && !operation.invalidated && operation.generation === this.generation)
  }

  begin(kind: GuiUpdateOperationKind, channel: GuiUpdateChannel, feedUrl: string): GuiUpdateOperation {
    const operation = {
      generation: this.generation,
      kind,
      channel,
      feedUrl,
      startedAt: Date.now(),
      invalidated: false
    }
    this.active = operation
    return operation
  }

  end(operation: GuiUpdateOperation): void {
    if (this.active === operation) this.active = null
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.lane.then(task, task)
    this.lane = next.then(() => undefined, () => undefined)
    return next
  }

  markDownloaded(operation: GuiUpdateOperation, version: string): boolean {
    if (operation.kind !== 'download' || !this.isCurrent(operation) || !version || operation.targetVersion !== version) {
      return false
    }
    this.downloaded = { generation: operation.generation, channel: operation.channel, feedUrl: operation.feedUrl, version }
    return true
  }

  downloadedFor(channel: GuiUpdateChannel, feedUrl: string, version: string): boolean {
    const downloaded = this.downloaded
    return Boolean(
      downloaded &&
      downloaded.generation === this.generation &&
      downloaded.channel === channel &&
      downloaded.feedUrl === feedUrl &&
      downloaded.version === version
    )
  }

  clearDownloaded(): void {
    this.downloaded = null
  }
}
