import { z } from 'zod'

export const STATIC_PERMISSIONS = [
  'commands.register',
  'ui.views',
  'ui.actions',
  'ui.notifications',
  'webview',
  'webview.external',
  'hostDom',
  'agent.run',
  'agent.threads.readOwn',
  'tools.register',
  'providers.register',
  'accounts.read',
  'storage.global',
  'storage.workspace',
  'workspace.read',
  'workspace.write',
  'media.read',
  'media.process',
  'media.export',
  'jobs.manage'
] as const

export const StaticPermissionSchema = z.enum(STATIC_PERMISSIONS)
export type StaticPermission = z.infer<typeof StaticPermissionSchema>

export const PROVIDER_PERMISSION_PATTERN =
  /^accounts\.(?:use|manage|secrets\.read):(?:[a-z0-9][a-z0-9-]*\.)?[a-z][a-z0-9-]*$/
export const NETWORK_PERMISSION_PATTERN =
  /^network:(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export const ScopedPermissionSchema = z.union([
  z.string().regex(PROVIDER_PERMISSION_PATTERN),
  z.string().regex(NETWORK_PERMISSION_PATTERN)
])
export type ScopedPermission = `accounts.${'use' | 'manage' | 'secrets.read'}:${string}` | `network:${string}`

export const PermissionSchema = z.union([StaticPermissionSchema, ScopedPermissionSchema])
export type Permission = StaticPermission | ScopedPermission

export function permissionMatches(granted: string, requested: string): boolean {
  if (granted === requested) return true
  if (!granted.startsWith('network:') || !requested.startsWith('network:')) return false
  const grantHost = granted.slice('network:'.length)
  const requestedHost = requested.slice('network:'.length)
  return grantHost.startsWith('*.') && requestedHost.endsWith(grantHost.slice(1))
}

export function hasPermission(grants: readonly string[], requested: string): boolean {
  return grants.some((grant) => permissionMatches(grant, requested))
}
