import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { providerModule } from '../../harness/providers/registry.js'
import type { AcpSessionUsageInput, AcpSessionUsageSource } from '../../harness/providers/provider-module.js'
import type { AcpUsage } from './acp-usage-types.js'

export type AcpSessionUsageRun = {
  source: AcpSessionUsageSource
  mark: unknown
  input: AcpSessionUsageInput
}

/** Before `session/prompt`: where this turn starts in the engine's own session log, if it keeps one. */
export async function beginAcpSessionUsage(
  harnessId: string,
  input: AcpSessionUsageInput
): Promise<AcpSessionUsageRun | undefined> {
  const source = providerModule(harnessId)?.acp?.sessionUsage
  if (!source) return undefined
  try {
    return { source, mark: await source.begin(input), input }
  } catch {
    return undefined
  }
}

/**
 * After the prompt: one usage draft per model call of the turn, for an engine
 * whose protocol carried no usage. An engine that reported its own usage keeps it.
 */
export async function collectAcpSessionUsage(
  run: AcpSessionUsageRun | undefined,
  facts: { sawUsageTokens: boolean },
  turn: { threadId: string; turnId: string; harnessId: string; model?: string }
): Promise<RuntimeEventDraft[]> {
  if (!run || facts.sawUsageTokens) return []
  try {
    const samples = await run.source.collect(run.mark, run.input)
    if (samples.length) facts.sawUsageTokens = true
    return samples.map((sample): RuntimeEventDraft => {
      const model = sample.model ?? turn.model
      return {
        kind: 'usage',
        threadId: turn.threadId,
        turnId: turn.turnId,
        ...(model ? { model } : {}),
        source: 'harness-reported',
        harnessId: turn.harnessId,
        usage: sample.usage
      }
    })
  } catch {
    return []
  }
}

/** The prompt result's usage: the standard field, else what the engine keeps in `_meta`. */
export function acpPromptResultUsage(
  harnessId: string,
  result: { usage?: AcpUsage | null; _meta?: Record<string, unknown> | null }
): AcpUsage | null | undefined {
  if (result.usage) return result.usage
  if (!result._meta) return undefined
  try {
    return providerModule(harnessId)?.acp?.promptResultUsage?.(result._meta)
  } catch {
    return undefined
  }
}
