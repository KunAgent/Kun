import { OPERATION_REQUIRED_SCOPES } from '@kun/remote-protocol'
import type { RemoteScopeName as ProtocolScopeName } from '@kun/remote-protocol'
import type { RemoteScope } from '../contracts.js'
/** Only trusted Electron Main may derive these from current desktop/grant consent. */
export const ADVANCED_REMOTE_SCOPES = ['groups.read', 'groups.write', 'collaboration.read', 'collaboration.control', 'schedules.read', 'extensions.read', 'extensions.control'] as const
export type RemoteScopeName = ProtocolScopeName
export type RemoteAuthority = RemoteScope & { scopes?: readonly RemoteScopeName[] }
export class RemoteScopeRequired extends Error {
  constructor(readonly requiredScope: RemoteScopeName) { super('REMOTE_SCOPE_REQUIRED') }
}
export function requireRemoteScope(scope: RemoteAuthority, required: RemoteScopeName) {
  if (required === 'personal') return
  if (!scope.scopes?.includes(required)) throw new RemoteScopeRequired(required)
}
export function hasRemoteScope(scope: RemoteAuthority, required: RemoteScopeName) { return required === 'personal' || Boolean(scope.scopes?.includes(required)) }

const requiredScopes = OPERATION_REQUIRED_SCOPES as Readonly<Record<string, readonly RemoteScopeName[]>>

export function authorizeRemoteOperation(scope: RemoteAuthority, method: string, receiptRead = false) {
  for (const required of requiredScopes[method] ?? []) {
    if (!receiptRead || !required.endsWith('.write') && !required.endsWith('.control')) requireRemoteScope(scope, required)
  }
}

export function operationAuthorized(scope: RemoteAuthority, method: string) {
  return (requiredScopes[method] ?? []).every((required) => hasRemoteScope(scope, required))
}
