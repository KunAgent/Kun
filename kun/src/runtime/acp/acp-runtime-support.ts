/**
 * AcpRuntime support: delegated trace records (same shape as the other
 * delegated runtimes), the ACP failure → finishTurn mapping (03 §9), and the
 * per-turn credential-env resolution for non-native-login credential modes.
 */
import type { ModelRequestTraceDelegated } from '../../contracts/model-request-trace.js'
import type {
  HarnessDefinition,
  HarnessId,
  HarnessRoute
} from '../../contracts/harness.js'
import type { LlmDebugSink } from '../../services/llm-debug-recorder.js'
import type { DelegatedRuntimeCapabilities } from '../delegated-turn-runtime.js'
import {
  unsupported,
  type HarnessCapabilities
} from '../../contracts/harness-capabilities.js'
import { ACP_DEFAULT_CAPABILITIES } from '../../harness/builtin-harnesses.js'
import { AcpError, type McpServer } from './acp-schema.js'
import { isAcpAuthenticationRequired } from './acp-authentication.js'
import {
  finishDelegatedTrace,
  startDelegatedTrace,
  type DelegatedTrace
} from '../../session/delegated-trace.js'
import {
  resolveDelegatedCredentialContext,
  type DelegatedCredentialEnvInput
} from '../../session/delegated-credentials.js'

export type AcpTrace = DelegatedTrace

/** Thin wrapper: identical record shape, transport pinned to `acp`. */
export function startAcpTrace(
  sink: LlmDebugSink | undefined,
  input: {
    threadId: string
    turnId: string
    harnessId: string
    model: string
    prompt: readonly unknown[]
    redactedRequestValues: readonly string[]
    phase: 'portable' | 'resumed' | 'rebased'
    preparationReason?: ModelRequestTraceDelegated['reason']
  }
): Promise<AcpTrace | undefined> {
  return startDelegatedTrace(sink, {
    ...input,
    providerKind: 'acp',
    endpointFormat: 'acp',
    target: `acp://${input.harnessId}/session`,
    capabilities: acpLegacyCapabilities()
  })
}

export function finishAcpTrace(
  trace: AcpTrace | undefined,
  result: { kind: 'completed'; text: string } | { kind: 'error'; error: unknown }
): Promise<void> {
  return finishDelegatedTrace(trace, result)
}

export function acpLegacyCapabilities(): DelegatedRuntimeCapabilities {
  return {
    nativeResume: true,
    structuredStreaming: true,
    kunTools: true,
    externalApproval: true,
    liveSteering: false,
    nativeContextTelemetry: false,
    fork: false
  }
}

/**
 * ACP failure → finishTurn code/message (03 §9): startup spawn/init failures
 * read as `harness_not_ready`; mid-turn process death is `harness_crashed`;
 * malformed required frames are `harness_protocol_error`; the agent's own
 * JSON-RPC errors are `agent_error`. User-facing text is bounded and never
 * carries environment or credential material.
 */
export function mapAcpFailure(
  error: unknown,
  startup: boolean,
  harnessId?: string
): { code: string; message: string } {
  if (error instanceof AcpError) {
    if (isAcpAuthenticationRequired(error)) {
      return {
        code: 'harness_not_ready',
        message: harnessId === 'devin'
          ? 'Devin CLI requires login. Run devin auth login in a terminal, then retry.'
          : 'The agent requires login. Open Agent settings, sign in with its CLI, and retry.'
      }
    }
    switch (error.code) {
      case 'request_timeout':
        return startup
          ? {
              code: 'harness_not_ready',
              message: 'ACP agent did not complete startup in time'
            }
          : { code: 'request_timeout', message: sanitize(error.message) }
      case 'harness_protocol_error':
        return { code: 'harness_protocol_error', message: sanitize(error.message) }
      case 'harness_crashed':
      case 'connection_closed':
        return { code: 'harness_crashed', message: sanitize(error.message) }
      case 'policy_denied':
        return { code: 'policy_denied', message: sanitize(error.message) }
      case 'request_aborted':
        return { code: 'request_aborted', message: sanitize(error.message) }
      case 'agent_error':
      default:
        return { code: 'agent_error', message: sanitize(error.message) }
    }
  }
  const errno = error as NodeJS.ErrnoException
  if (
    errno?.code === 'ENOENT' ||
    errno?.code === 'EACCES' ||
    errno?.code === 'EPERM'
  ) {
    return {
      code: 'harness_not_ready',
      message: `ACP agent executable is not available (${errno.code})`
    }
  }
  return {
    code: startup ? 'harness_not_ready' : 'agent_error',
    message: sanitize(error instanceof Error ? error.message : String(error))
  }
}

function sanitize(message: string): string {
  return message.slice(0, 2_000)
}

/**
 * Pre-connect capability view (P3-09): the static ACP declaration, narrowed
 * to not claim `kunTools` when this runtime cannot hand out MCP descriptors.
 */
export function acpStaticCapabilities(kunToolsDeliverable: boolean): HarnessCapabilities {
  if (kunToolsDeliverable) return ACP_DEFAULT_CAPABILITIES
  return {
    ...ACP_DEFAULT_CAPABILITIES,
    statuses: {
      ...ACP_DEFAULT_CAPABILITIES.statuses,
      kunTools: unsupported('not-implemented', {
        message: 'Kun Tools MCP requires a serve-hosted runtime to deliver descriptors'
      })
    }
  }
}

/** Which kun-tools transport a session request actually carried. */
export function kunToolsDescriptorOf(
  servers: readonly McpServer[]
): 'http' | 'stdio' | 'none' {
  const first = servers[0] as { type?: string } | undefined
  if (!first) return 'none'
  return first.type === 'http' ? 'http' : 'stdio'
}

export type AcpCredentialEnvInput = DelegatedCredentialEnvInput

/**
 * Resolve the credential identity + child env for a turn (P3-10). A
 * `kun-gateway` route embeds the selected provider/model in the env, so the
 * identity — and the pooled connection it keys — folds the canonical route in
 * (grant ids never hash routes, so a later turn cannot widen a live token).
 * Shared implementation lives in `session/delegated-credentials.ts` (P6-02).
 */
export function resolveAcpCredentialContext(
  resolve: ((input: AcpCredentialEnvInput) => Promise<Record<string, string>>) | undefined,
  input: {
    definition: HarnessDefinition
    credentialMode: HarnessRoute['credentialMode']
    threadId: string
    turnId: string
    providerId?: string
    model?: string
    accountId?: string
  }
): Promise<{ credentialIdentity: string; env: Record<string, string> }> {
  return resolveDelegatedCredentialContext(resolve, input)
}
