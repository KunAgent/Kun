const CREDENTIAL_PATH_KEYS = new Set([
  'AWS_CONFIG_FILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AZURE_CONFIG_DIR',
  'CLAUDE_CONFIG_DIR',
  'DOCKER_CONFIG',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'KUBECONFIG',
  'NPM_CONFIG_USERCONFIG',
  'SSH_AUTH_SOCK'
])

const INTERNAL_KEYS = new Set([
  'DEEPSEEK_API_KEY',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_RUN_AS_NODE',
  'KUN_RUNTIME_TOKEN',
  'KUN_RUNTIME_URL',
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
  'V8_INSPECTOR'
])

const PROXY_KEYS = new Set([
  'ALL_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'NPM_CONFIG_PROXY',
  'NPM_CONFIG_HTTPS_PROXY'
])

const SENSITIVE_KEY_PARTS = [
  'ACCESS_TOKEN',
  'API_KEY',
  'AUTH_TOKEN',
  'BEARER',
  'CLIENT_SECRET',
  'COOKIE',
  'CREDENTIAL',
  'PASSWORD',
  'PASSWD',
  'PRIVATE_KEY',
  'REFRESH_TOKEN',
  'SECRET',
  'SESSION_TOKEN'
] as const

export type ToolEnvironmentSanitizationOptions = {
  allowKeys?: readonly string[]
}

export type ToolEnvironmentSanitization = {
  env: Record<string, string | undefined>
  removedKeys: string[]
}

/**
 * Remove credentials and host-process control variables before starting a tool.
 * Values are never copied into the audit result; callers may log removedKeys
 * without risking accidental credential disclosure.
 */
export function sanitizeToolEnvironment(
  input: Record<string, string | undefined>,
  options: ToolEnvironmentSanitizationOptions = {}
): ToolEnvironmentSanitization {
  const allowed = new Set((options.allowKeys ?? []).map((key) => key.trim().toUpperCase()).filter(Boolean))
  const env: Record<string, string | undefined> = {}
  const removedKeys: string[] = []

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    const normalizedKey = key.toUpperCase()
    if (!allowed.has(normalizedKey) && shouldRemove(normalizedKey, value)) {
      removedKeys.push(key)
      continue
    }
    env[key] = value
  }

  removedKeys.sort((a, b) => a.localeCompare(b))
  return { env, removedKeys }
}

function shouldRemove(key: string, value: string): boolean {
  if (INTERNAL_KEYS.has(key) || CREDENTIAL_PATH_KEYS.has(key)) return true
  if (key.startsWith('ELECTRON_') || key === 'DEBUG_PORT' || key === 'INSPECT_PORT') return true
  if (SENSITIVE_KEY_PARTS.some((part) => key === part || key.includes(`_${part}`))) return true
  if (PROXY_KEYS.has(key)) return proxyContainsCredentials(value)
  return false
}

function proxyContainsCredentials(value: string): boolean {
  const normalized = value.trim()
  if (!normalized || !normalized.includes('://')) return false
  try {
    const parsed = new URL(normalized)
    return Boolean(parsed.username || parsed.password)
  } catch {
    // An unparseable proxy is left alone here; URL validation belongs to the
    // network policy layer, while this helper only removes known credentials.
    return false
  }
}
