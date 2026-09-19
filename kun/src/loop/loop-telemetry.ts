import type { GuiDesignArtifactContext } from '../ports/tool-host.js'

const MAX_TOOL_CATALOG_SNAPSHOTS = 256

type ToolCatalogSnapshot = {
  fingerprint: string
  toolNames: string[]
  toolHashes: Record<string, string>
}

export type ToolCatalogDrift =
  | { kind: 'none' }
  | { kind: 'additive'; previous: ToolCatalogSnapshot }
  | { kind: 'breaking'; previous: ToolCatalogSnapshot }

export type ToolCatalogFingerprintInput = {
  threadId: string
  workspace: string
  mode: string
  model: string
  activeSkillIds: readonly string[]
  allowedToolNames?: readonly string[]
  userInputDisabled?: boolean
  guiDesignCanvas?: boolean
  guiExcalidrawCanvas?: boolean
  guiDesignMode?: boolean
  guiDesignArtifact?: GuiDesignArtifactContext
  fingerprint: string
  toolNames: string[]
  toolHashes: Record<string, string>
}

/**
 * Bounded, process-local telemetry state used to make cache and compaction
 * decisions. It deliberately owns no event or turn persistence: callers keep
 * those visible side effects in the orchestration layer.
 */
export class LoopTelemetry {
  private readonly promptTokenPressure = new Map<string, { model: string; promptTokens: number }>()
  private readonly toolCatalogSnapshots = new Map<string, ToolCatalogSnapshot>()

  recordPromptPressure(threadId: string, model: string, promptTokens: number): void {
    if (!threadId || promptTokens <= 0) return
    const current = this.promptTokenPressure.get(threadId)
    if (current && current.promptTokens >= promptTokens) return
    this.promptTokenPressure.set(threadId, { model, promptTokens })
  }

  consumePromptPressure(
    threadId: string,
    model: string
  ): { model: string; promptTokens: number } | undefined {
    if (!threadId) return undefined
    const pressure = this.promptTokenPressure.get(threadId)
    if (!pressure) return undefined
    this.promptTokenPressure.delete(threadId)
    return {
      model: pressure.model || model,
      promptTokens: pressure.promptTokens
    }
  }

  clearPromptPressure(threadId: string): void {
    this.promptTokenPressure.delete(threadId)
  }

  recordToolCatalogFingerprint(input: ToolCatalogFingerprintInput): ToolCatalogDrift {
    const key = JSON.stringify({
      threadId: input.threadId,
      workspace: input.workspace,
      mode: input.mode,
      model: input.model,
      activeSkillIds: [...input.activeSkillIds].sort(),
      allowedToolNames: input.allowedToolNames ? [...input.allowedToolNames].sort() : [],
      userInputDisabled: input.userInputDisabled === true,
      guiDesignCanvas: input.guiDesignCanvas === true,
      guiExcalidrawCanvas: input.guiExcalidrawCanvas === true,
      guiDesignMode: input.guiDesignMode === true,
      guiDesignArtifact: input.guiDesignArtifact?.kind ?? null
    })
    const current: ToolCatalogSnapshot = {
      fingerprint: input.fingerprint,
      toolNames: input.toolNames,
      toolHashes: input.toolHashes
    }
    const previous = this.toolCatalogSnapshots.get(key)
    this.toolCatalogSnapshots.delete(key)
    this.toolCatalogSnapshots.set(key, current)
    if (this.toolCatalogSnapshots.size > MAX_TOOL_CATALOG_SNAPSHOTS) {
      const oldest = this.toolCatalogSnapshots.keys().next().value
      if (oldest !== undefined) this.toolCatalogSnapshots.delete(oldest)
    }
    if (!previous || previous.fingerprint === input.fingerprint) return { kind: 'none' }
    return isAdditiveToolCatalogChange(previous, current)
      ? { kind: 'additive', previous }
      : { kind: 'breaking', previous }
  }

}

function isAdditiveToolCatalogChange(previous: ToolCatalogSnapshot, current: ToolCatalogSnapshot): boolean {
  let added = false
  for (const name of current.toolNames) {
    if (!previous.toolHashes[name]) added = true
  }
  if (!added) return false
  for (const name of previous.toolNames) {
    const previousHash = previous.toolHashes[name]
    const currentHash = current.toolHashes[name]
    if (!previousHash || !currentHash || previousHash !== currentHash) return false
  }
  return true
}
