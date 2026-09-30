import type { HarnessTransport } from '../contracts/harness.js'
import type { DelegatedTurnRuntime } from '../runtime/delegated-turn-runtime.js'
import {
  createAgentSdkRuntime,
  type AgentSdkRuntimeFactoryDeps
} from '../runtime/agent-sdk/agent-sdk-runtime-factory.js'
import {
  AntigravityCliRuntime,
  type AntigravityCliRuntimeDeps
} from '../runtime/antigravity/antigravity-cli-runtime.js'
import {
  AcpRuntime,
  type AcpRuntimeDeps
} from '../runtime/acp/acp-runtime.js'
import {
  createCursorSdkRuntime,
  type CursorSdkRuntimeFactoryDeps
} from '../runtime/cursor/cursor-sdk-runtime-factory.js'
import {
  SessionTurnRuntime,
  type SessionTurnRuntimeDeps
} from '../session/session-turn-runtime.js'

/**
 * Shared transport map assembly used by the main runtime and by child/delegated
 * scopes. Callers build the per-scope deps objects (child scopes narrow them);
 * this factory only decides which transports exist.
 */
export function buildHarnessRuntimes(input: {
  agentSdk?: AgentSdkRuntimeFactoryDeps | null
  antigravity?: AntigravityCliRuntimeDeps | null
  cursor?: CursorSdkRuntimeFactoryDeps | null
  acp?: AcpRuntimeDeps | null
  /** P6-05/07: native `codex app-server` transport on the shared session layer. */
  codexAppServer?: SessionTurnRuntimeDeps | null
  /** P6-09/11: native `pi --mode rpc` transport on the shared session layer. */
  piRpc?: SessionTurnRuntimeDeps | null
}): Partial<Record<HarnessTransport, DelegatedTurnRuntime>> {
  const map: Partial<Record<HarnessTransport, DelegatedTurnRuntime>> = {}
  if (input.agentSdk) map['agent-sdk'] = createAgentSdkRuntime(input.agentSdk)
  if (input.antigravity) map['antigravity-cli'] = new AntigravityCliRuntime(input.antigravity)
  if (input.cursor) map['cursor-sdk'] = createCursorSdkRuntime(input.cursor)
  if (input.acp) map.acp = new AcpRuntime(input.acp)
  if (input.codexAppServer) {
    map['codex-app-server'] = new SessionTurnRuntime(input.codexAppServer)
  }
  if (input.piRpc) {
    map['pi-rpc'] = new SessionTurnRuntime(input.piRpc)
  }
  return map
}
