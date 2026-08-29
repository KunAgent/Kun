import type {
  AntigravitySubscriptionModelCatalog,
  RuntimeRequestResult,
  SdkDownloadState
} from '../shared/kun-gui-api'

type RuntimeRequest = (
  path: string,
  method?: string,
  body?: string,
  headers?: Record<string, string>
) => Promise<RuntimeRequestResult>

export type RuntimeOfficialProviderCliStatus = {
  installed: boolean
  version: string
  directory: string
  path?: string
  download: SdkDownloadState | null
}

export async function requestOfficialProviderCliStatus(
  runtimeRequest: RuntimeRequest
): Promise<RuntimeOfficialProviderCliStatus> {
  return requestJson(runtimeRequest, '/v1/model-connections/official-cli/status', 'GET')
}

export async function requestOfficialProviderCliInstall(
  runtimeRequest: RuntimeRequest
): Promise<SdkDownloadState> {
  return requestJson(runtimeRequest, '/v1/model-connections/official-cli/install', 'POST')
}

export type OfficialProviderCliProgressEmitter = (state: SdkDownloadState) => void

export function startOfficialProviderCliProgress(
  runtimeRequest: RuntimeRequest,
  emit: OfficialProviderCliProgressEmitter,
  intervalMs = 1_000
): () => void {
  let stopped = false
  let pending = false
  const timer = setInterval(() => {
    if (stopped || pending) return
    pending = true
    void requestOfficialProviderCliStatus(runtimeRequest)
      .then((status) => {
        if (stopped) return
        if (status.download) emit(status.download)
        if (status.download?.status === 'done' || status.download?.status === 'error') stop()
      })
      .catch(() => undefined)
      .finally(() => { pending = false })
  }, intervalMs)
  timer.unref?.()
  const stop = (): void => {
    stopped = true
    clearInterval(timer)
  }
  return stop
}

export async function requestOfficialProviderCliModels(
  runtimeRequest: RuntimeRequest
): Promise<AntigravitySubscriptionModelCatalog> {
  return requestJson(runtimeRequest, '/v1/model-connections/official-cli/models', 'GET')
}

async function requestJson<T>(
  runtimeRequest: RuntimeRequest,
  path: string,
  method: string
): Promise<T> {
  const response = await runtimeRequest(path, method)
  let payload: unknown
  try {
    payload = JSON.parse(response.body)
  } catch {
    throw new Error('Kun returned malformed official provider CLI data.')
  }
  if (!response.ok) {
    throw new Error(runtimeErrorMessage(payload)
      || `Kun official provider CLI request failed (HTTP ${response.status}).`)
  }
  return payload as T
}

function runtimeErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ''
  const error = (payload as Record<string, unknown>).error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return ''
  const message = (error as Record<string, unknown>).message
  return typeof message === 'string' ? message.trim() : ''
}
