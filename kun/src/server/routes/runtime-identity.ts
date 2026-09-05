import { isLoopbackHost } from '../loopback-host.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { ERRORS } from './runtime-error.js'

/**
 * Build the `GET /v1/runtime/identity` response used by the desktop handoff
 * verifier when OS-level process identity cannot be read (e.g. a Windows WMI /
 * CIM outage). The route is registered behind `authorize(request, runtime)` and
 * additionally requires a loopback client address so it can never be reached
 * from a remote peer. The response contains no credentials or settings, only
 * the immutable identity of the running serve instance.
 */
export function runtimeIdentityJsonResponse(
  runtime: ServerRuntime,
  request: Request
): JsonResponse {
  const remoteAddress = request.headers.get('x-kun-remote-address') ?? ''
  if (!isLoopbackAddress(remoteAddress)) return ERRORS.forbidden()
  const info = runtime.info()
  return jsonResponse({
    instanceId: info.instanceId,
    pid: info.pid ?? null,
    startedAt: info.startedAt,
    buildId: info.buildId,
    dataDir: info.dataDir,
    host: info.host,
    port: info.port
  })
}

function isLoopbackAddress(value: string): boolean {
  const normalized = value.replace(/^::ffff:/u, '').replace(/^\[|\]$/gu, '')
  return isLoopbackHost(normalized)
}
