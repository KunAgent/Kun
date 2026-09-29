import type {
  AdeHarnessModels,
  AdeHarnessRow,
  AdeHarnessTestRequest,
  AdeHarnessTestResult
} from '@shared/ade-harnesses'
import { KUN_HARNESSES_PATH, kunHarnessModelsPath } from '@shared/kun-endpoints'
import { runtimeErrorToError } from '@shared/runtime-error'
import { rendererRuntimeClient } from './runtime-client'
import { readRuntimeError, readRuntimeJson } from './kun-runtime-services'

/**
 * Harness catalog client (docs/ade/01 §7, 12 §7.2). Catalog rows carry
 * cached detection status; `waitMs` asks the server to hold the response
 * briefly so inflight detections can settle first (P4-02).
 */
export function createKunHarnessesClient() {
  return {
    async listHarnesses(options?: { waitMs?: number }): Promise<AdeHarnessRow[]> {
      const waitMs = options?.waitMs
      const path = typeof waitMs === 'number' && waitMs > 0
        ? `${KUN_HARNESSES_PATH}?wait_ms=${Math.floor(waitMs)}`
        : KUN_HARNESSES_PATH
      const response = await rendererRuntimeClient.runtimeRequest(path, 'GET')
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
    },

    /**
     * Progressive connection test (p4 §3.5, P4-10): detect → handshake →
     * optional trial turn on a hidden side thread. Trial consumes quota.
     */
    async testHarness(
      harnessId: string,
      input: AdeHarnessTestRequest
    ): Promise<AdeHarnessTestResult> {
      const response = await rendererRuntimeClient.runtimeRequest(
        `${KUN_HARNESSES_PATH}/${encodeURIComponent(harnessId)}/test`,
        'POST',
        JSON.stringify(input)
      )
      if (!response.ok) {
        throw runtimeErrorToError(
          readRuntimeError(response.body, 'failed to test harness connection')
        )
      }
      return readRuntimeJson<AdeHarnessTestResult>(
        response.body,
        'runtime returned an invalid harness test result'
      )
    }
  }
}
