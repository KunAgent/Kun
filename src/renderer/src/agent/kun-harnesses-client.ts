import type { AdeHarnessModels, AdeHarnessRow } from '@shared/ade-harnesses'
import { KUN_HARNESSES_PATH, kunHarnessModelsPath } from '@shared/kun-endpoints'
import { runtimeErrorToError } from '@shared/runtime-error'
import { rendererRuntimeClient } from './runtime-client'
import { readRuntimeError, readRuntimeJson } from './kun-runtime-services'

/**
 * Harness catalog client (docs/ade/01 §7, 12 §7.2). The catalog rows carry
 * cached detection status — `peek`, never a blocking probe.
 */
export function createKunHarnessesClient() {
  return {
    async listHarnesses(): Promise<AdeHarnessRow[]> {
      const response = await rendererRuntimeClient.runtimeRequest(KUN_HARNESSES_PATH, 'GET')
      if (!response.ok) {
        throw runtimeErrorToError(
          readRuntimeError(response.body, 'failed to list harnesses')
        )
      }
      const body = readRuntimeJson<{ harnesses?: AdeHarnessRow[] }>(
        response.body,
        'runtime returned an invalid harness list'
      )
      return Array.isArray(body.harnesses) ? body.harnesses : []
    },

    /**
     * Models for one harness (01 §9): static, probed, or provider-derived.
     * With `credentialMode` set to `provider`/`kun-gateway` the response
     * carries `groups` — gateway-exposable providers and their models.
     */
    async listHarnessModels(
      harnessId: string,
      credentialMode?: string
    ): Promise<AdeHarnessModels> {
      const response = await rendererRuntimeClient.runtimeRequest(
        kunHarnessModelsPath(harnessId, credentialMode), 'GET'
      )
      if (!response.ok) {
        throw runtimeErrorToError(
          readRuntimeError(response.body, 'failed to list harness models')
        )
      }
      return readRuntimeJson<AdeHarnessModels>(
        response.body,
        'runtime returned an invalid harness model list'
      )
    },

    /** Force a fresh detection pass for one harness (settings re-detect). */
    async probeHarness(harnessId: string): Promise<AdeHarnessRow> {
      const response = await rendererRuntimeClient.runtimeRequest(
        `${KUN_HARNESSES_PATH}/${encodeURIComponent(harnessId)}/probe`, 'POST', '{}'
      )
      if (!response.ok) {
        throw runtimeErrorToError(
          readRuntimeError(response.body, 'failed to re-detect harness')
        )
      }
      return readRuntimeJson<AdeHarnessRow>(
        response.body,
        'runtime returned an invalid harness probe result'
      )
    }
  }
}
