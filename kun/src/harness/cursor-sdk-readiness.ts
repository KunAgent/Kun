import type { HarnessTestHandshake } from '../contracts/harness-test.js'
import { raceProbeAbort } from './probe-abort.js'
import { checkCursorSdkInstallation } from './cursor-sdk-installation.js'

type LocalSdk = {
  Agent?: { create?: unknown; resume?: unknown }
  JsonlLocalAgentStore?: unknown
}

/**
 * The installed SDK exposes no local authentication/protocol probe. Its public
 * Agent.create/resume API and JsonlLocalAgentStore are the contracts Kun uses.
 * Import and inspect those exports only: never create an agent, open a store,
 * call Cursor.me/models.list (cloud requests), or pass any provider credential.
 */
export async function probeCursorSdkReadiness(signal: AbortSignal,
  deps: { loadSdk?: () => Promise<LocalSdk>; checkInstallation?: () => Promise<string> } = {}
): Promise<Omit<HarnessTestHandshake, 'durationMs'>> {
  signal.throwIfAborted()
  const version = await raceProbeAbort((deps.checkInstallation ?? checkCursorSdkInstallation)(), signal)
  signal.throwIfAborted()
  const sdk = await raceProbeAbort((deps.loadSdk ?? (() => import('@cursor/sdk')))(), signal)
  signal.throwIfAborted()
  const ok = typeof sdk.Agent?.create === 'function' && typeof sdk.Agent.resume === 'function' &&
    typeof sdk.JsonlLocalAgentStore === 'function'
  return {
    ok, supported: false, protocol: 'cursor-sdk-local-api', authentication: 'unverified',
    agent: { name: '@cursor/sdk', version },
    detail: ok
      ? 'Bundled Cursor SDK API, local store and platform helpers checked; no wire handshake, authentication, account quota or model request tested'
      : 'Bundled Cursor SDK is missing the required local agent API; reinstall or update Kun'
  }
}
