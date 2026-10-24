import { randomUUID } from 'node:crypto'
import {
  BROWSER_USE_BRIDGE_CONTRACT_VERSION,
  BrowserUseBridgeRequest,
  BrowserUseBridgeResponse,
  BrowserUseHostChallengeResponse,
  signBrowserUseKunApprovalGrant,
  verifyBrowserUseBridgeResponse,
  verifyBrowserUseHostChallenge,
  type BrowserUseActionInput,
  type BrowserUseKunApprovalGrantDraft,
  type BrowserUseKunApprovalMode,
  type BrowserUseToolResult
} from '../../contracts/browser-use.js'
import { encryptBrowserUseActionEnvelope } from '../../contracts/browser-use-bridge-crypto.js'
import type {
  BrowserController,
  BrowserControllerReadiness
} from '../../ports/browser-controller.js'
import {
  currentBrowserUseHostAuthority,
  fixedBrowserUseHostAuthority,
  type BrowserUseHostAuthorityLease
} from './browser-controller-authority.js'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const MAX_CHALLENGE_RESPONSE_BYTES = 4 * 1024

export type HostBridgeBrowserControllerOptions = {
  bridgeUrl?: string
  bridgeToken?: string
  approvalSigningKey?: string
  timeoutMs?: number
  fetch?: typeof fetch
}

export class BrowserControllerError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'BrowserControllerError'
  }
}

export class HostBridgeBrowserController implements BrowserController {
  private readonly fixedAuthority?: BrowserUseHostAuthorityLease
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: HostBridgeBrowserControllerOptions = {}) {
    if (
      options.bridgeUrl !== undefined ||
      options.bridgeToken !== undefined ||
      options.approvalSigningKey !== undefined
    ) {
      this.fixedAuthority = fixedBrowserUseHostAuthority({
        bridgeUrl: options.bridgeUrl,
        bridgeToken: options.bridgeToken,
        approvalSigningKey: options.approvalSigningKey
      })
    }
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetch ?? fetch
  }

  readiness(): BrowserControllerReadiness {
    if (!this.authority().binding) {
      return {
        available: false,
        interactionRequired: true,
        reason: 'Browser Use requires the managed desktop host and a visible authenticated GUI.'
      }
    }
    return { available: true }
  }

  async execute(input: {
    threadId: string
    turnId: string
    action: BrowserUseActionInput
    kunApprovalMode?: BrowserUseKunApprovalMode
    kunApprovalGrant?: BrowserUseKunApprovalGrantDraft
    signal: AbortSignal
  }): Promise<BrowserUseToolResult> {
    const authority = this.authority()
    const binding = authority.binding
    if (!binding) {
      throw new BrowserControllerError(
        'interaction_required',
        'Browser Use requires the managed desktop host and a visible authenticated GUI.'
      )
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    const onAbort = () => controller.abort(input.signal.reason)
    const onAuthorityRevoked = () => controller.abort(authority.signal.reason)
    input.signal.addEventListener('abort', onAbort, { once: true })
    authority.signal.addEventListener('abort', onAuthorityRevoked, { once: true })
    const requestId = randomUUID()
    try {
      // addEventListener does not replay an abort that won the race immediately
      // before registration. Re-read both owners before any network disclosure.
      if (input.signal.aborted) onAbort()
      if (authority.signal.aborted) onAuthorityRevoked()
      controller.signal.throwIfAborted()
      const challengeNonce = randomUUID()
      const challengeResponse = await this.fetchImpl(`${binding.bridgeUrl}/v1/challenge`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify({
          contractVersion: BROWSER_USE_BRIDGE_CONTRACT_VERSION,
          nonce: challengeNonce
        }),
        redirect: 'error',
        signal: controller.signal
      })
      if (!challengeResponse.ok) {
        throw new BrowserControllerError(
          'browser_host_identity_unverified',
          `Browser Use host identity challenge failed (HTTP ${challengeResponse.status}).`
        )
      }
      const challengeRaw = await readBoundedJsonResponse(
        challengeResponse,
        MAX_CHALLENGE_RESPONSE_BYTES
      )
      const challenge = BrowserUseHostChallengeResponse.safeParse(challengeRaw)
      if (
        !challenge.success ||
        challenge.data.nonce !== challengeNonce ||
        !verifyBrowserUseHostChallenge(challenge.data, binding.approvalSigningKey)
      ) {
        throw new BrowserControllerError(
          'browser_host_identity_unverified',
          'Browser Use host identity challenge returned an invalid proof.'
        )
      }

      const signedGrant = input.kunApprovalGrant
        ? signBrowserUseKunApprovalGrant({
            ...input.kunApprovalGrant,
            threadId: input.threadId,
            turnId: input.turnId
          }, binding.approvalSigningKey)
        : undefined
      const request = BrowserUseBridgeRequest.parse({
        contractVersion: BROWSER_USE_BRIDGE_CONTRACT_VERSION,
        requestId,
        threadId: input.threadId,
        turnId: input.turnId,
        action: input.action,
        ...(input.kunApprovalMode
          ? { kunApprovalMode: input.kunApprovalMode }
          : {}),
        ...(signedGrant
          ? { kunApprovalGrant: signedGrant }
          : {})
      })
      const envelope = encryptBrowserUseActionEnvelope({
        bridgeToken: binding.bridgeToken,
        request
      }, binding.approvalSigningKey)
      controller.signal.throwIfAborted()
      const response = await this.fetchImpl(`${binding.bridgeUrl}/v1/actions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify(envelope),
        redirect: 'error',
        signal: controller.signal
      })
      if (!response.ok) {
        throw new BrowserControllerError(
          response.status === 401 ? 'browser_host_unauthorized' : 'browser_host_failed',
          `Browser Use host rejected the request (HTTP ${response.status}).`
        )
      }
      const raw = await readBoundedJsonResponse(response, MAX_RESPONSE_BYTES)
      const parsed = BrowserUseBridgeResponse.safeParse(raw)
      if (
        !parsed.success ||
        parsed.data.requestId !== requestId ||
        !verifyBrowserUseBridgeResponse(parsed.data, binding.approvalSigningKey)
      ) {
        throw new BrowserControllerError(
          'browser_host_invalid_response',
          'Browser Use host returned a mismatched or invalid response.'
        )
      }
      return parsed.data.result
    } catch (error) {
      if (controller.signal.aborted) {
        throw new BrowserControllerError(
          input.signal.aborted
            ? 'aborted'
            : authority.signal.aborted
              ? 'browser_host_authority_revoked'
              : 'browser_host_timeout',
          input.signal.aborted
            ? 'Browser Use action was cancelled.'
            : authority.signal.aborted
              ? 'Browser Use host authority changed while the action was running.'
            : 'Browser Use host timed out.'
        )
      }
      if (error instanceof BrowserControllerError) throw error
      throw new BrowserControllerError('browser_host_unavailable', safeErrorMessage(error))
    } finally {
      clearTimeout(timeout)
      input.signal.removeEventListener('abort', onAbort)
      authority.signal.removeEventListener('abort', onAuthorityRevoked)
    }
  }

  private authority(): BrowserUseHostAuthorityLease {
    return this.fixedAuthority ?? currentBrowserUseHostAuthority()
  }
}

async function readBoundedJsonResponse(
  response: Response,
  maxBytes: number
): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new BrowserControllerError(
      'browser_host_response_too_large',
      'Browser Use host returned an oversized response.'
    )
  }
  if (!response.body) {
    throw new BrowserControllerError(
      'browser_host_invalid_response',
      'Browser Use host returned an empty response.'
    )
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    bytes += next.value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new BrowserControllerError(
        'browser_host_response_too_large',
        'Browser Use host returned an oversized response.'
      )
    }
    chunks.push(next.value)
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes).toString('utf8'))
  } catch {
    throw new BrowserControllerError(
      'browser_host_invalid_response',
      'Browser Use host returned malformed JSON.'
    )
  }
}

function safeErrorMessage(error: unknown): string {
  const base = error instanceof Error ? error.message : String(error)
  // Node's fetch reports "fetch failed" and keeps ECONNREFUSED & co. in `cause`.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : ''
  const message = cause && !base.includes(cause) ? `${base}: ${cause}` : base
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .slice(0, 1024)
}
