import { useEffect } from 'react'
import { isAntigravityOrchestrator } from '@kun/provider-catalog'
import { loadHarnessModels, type HarnessModelCacheEntry } from '../store/harness-store'

/** These Agents publish reasoning choices for the selected model only. */
export function useNativeModelDetails(harnessId: string, model: string | undefined, cache: HarnessModelCacheEntry | undefined, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || (harnessId !== 'devin' && harnessId !== 'antigravity') || !model ||
      (harnessId === 'antigravity' && isAntigravityOrchestrator(model)) || !cache || cache.loading ||
      !cache.models.includes(model) || cache.detailsModel === model ||
      cache.modelInfo?.find((entry) => entry.id === model)?.reasoningEfforts !== undefined) return
    void loadHarnessModels(harnessId, false, model)
  }, [harnessId, model, cache, enabled])
}
