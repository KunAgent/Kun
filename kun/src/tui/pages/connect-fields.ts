import { spawn } from 'node:child_process'
import type { ConnectField, ConnectionPreset } from '../connect-common.js'

export function fieldLabel(field: ConnectField | undefined, preset: ConnectionPreset): string {
  switch (field) {
    case 'id': return 'Provider ID'
    case 'name': return 'Provider name'
    case 'baseUrl': return 'Base URL'
    case 'endpointFormat': return 'Endpoint format'
    case 'credential': {
      const label = preset.authType === 'oauth' ? 'OAuth credential' : 'API key / token plan key'
      return preset.credentialRequirement === 'optional' ? `${label} (optional)` : label
    }
    case 'models': return 'Models (comma separated)'
    default: return ''
  }
}

export function fieldPlaceholder(field: ConnectField | undefined): string {
  if (field === 'credential') return 'hidden input'
  if (field === 'id') return 'for example: company-proxy'
  if (field === 'name') return 'display name'
  if (field === 'baseUrl') return 'https://api.example.com/v1'
  if (field === 'models') return 'model-a, model-b'
  return 'type a value'
}

export function endpointFormat(value: string | undefined): 'chat_completions' | 'responses' | 'messages' | 'custom_endpoint' {
  return value === 'responses' || value === 'messages' || value === 'custom_endpoint'
    ? value
    : 'chat_completions'
}

export function normalizeConnectionProviderId(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 100)
}

export function isModelProbeFailure(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return message.includes('provider probe failed') ||
    message.includes('model probe failed') ||
    message.includes('fetch failed') ||
    message.includes('failed to fetch') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('/models')
}

export function openBrowser(
  url: string,
  spawnFn: typeof spawn = spawn,
  platform: NodeJS.Platform = process.platform
): void {
  const launch = platform === 'darwin'
    ? { command: 'open', args: [url] }
    : platform === 'win32'
      ? { command: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] }
      : { command: 'xdg-open', args: [url] }
  try {
    const child = spawnFn(launch.command, launch.args, { detached: true, stdio: 'ignore', windowsHide: true })
    // spawn() reports a missing desktop opener asynchronously. Consume that
    // event so headless/SSH sessions keep the visible, copyable URL fallback.
    child.once('error', () => undefined)
    child.unref()
  } catch {
    // The URL remains visible and copyable when no desktop opener exists.
  }
}
