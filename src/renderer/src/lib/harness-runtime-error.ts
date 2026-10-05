/** Match known native Agent failures without replacing unrelated provider errors. */
export function harnessRuntimeErrorKey(code: string | null, text: string): string | undefined {
  if (/(?:requires a newer version|upgrade to the latest app or cli)/i.test(text)) return 'agentRuntimeError.update'
  if (code === 'policy_denied' && /(?:permission mode|agent permission)/i.test(text)) return 'agentRuntimeError.permission'
  if (/(?:agent launch has no current readiness proof|agent profile changed|configuration or credentials changed|readiness check was superseded)/i.test(text)) {
    return 'agentRuntimeError.changed'
  }
  if (code === 'harness_not_ready' || code === 'harness_disabled' || /agent profile is disabled/i.test(text)) return 'agentRuntimeError.setup'
  if ((code === 'agent_error' || code === 'harness_auth_required') && /(?:requires interactive login|failed to authenticate|not logged in|authentication required)/i.test(text)) {
    return 'agentRuntimeError.authentication'
  }
  if (/(?:did not advertise|unavailable|unsupported|unknown).*(?:requested model|model selector)|(?:requested model|model selector).*(?:unavailable|unsupported|unknown)/i.test(text)) {
    return 'agentRuntimeError.model'
  }
  return undefined
}
