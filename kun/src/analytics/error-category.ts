/** Only a coarse enum crosses the analytics boundary. Never upload the raw code or message. */
export function analyticsErrorCategory(code: string): 'network' | 'authentication' | 'quota' | 'permission' | 'configuration' | 'runtime' | 'unknown' {
  const normalized = code.toLowerCase()
  if (/^(unauthorized|auth_|invalid_api_key|login_required)/.test(normalized)) return 'authentication'
  if (/^(rate_limit|quota|insufficient_quota)/.test(normalized)) return 'quota'
  if (/^(permission|sandbox|approval_denied|forbidden)/.test(normalized)) return 'permission'
  if (/^(network|connection|timeout|fetch_failed)/.test(normalized)) return 'network'
  if (/^(model_not_found|provider_not_configured|configuration)/.test(normalized)) return 'configuration'
  return 'unknown'
}
