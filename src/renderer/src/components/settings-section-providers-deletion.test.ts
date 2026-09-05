import { describe, expect, it } from 'vitest'
import { reconcilePendingSharedProviderDeletions } from './settings-section-providers'

describe('pending shared model connection deletions', () => {
  const connection = {
    id: 'custom-provider-2',
    accountId: 'account:custom-provider-2',
    name: 'Custom Provider',
    kind: 'http' as const,
    authType: 'api-key' as const,
    endpointFormat: 'chat_completions' as const,
    useProxy: false,
    configured: true,
    models: ['custom-model']
  }
  const snapshot = (revision: number, providers = [connection]) => ({
    schemaVersion: 1 as const,
    proxyRoutingVersion: 1 as const,
    revision,
    providers
  })

  it('keeps tombstones through the deletion revision and releases newer snapshots', () => {
    const pending = new Map([[connection.id, { generation: 1, committedRevision: 5 }]])

    expect(reconcilePendingSharedProviderDeletions(snapshot(4), pending).has(connection.id)).toBe(true)
    expect(reconcilePendingSharedProviderDeletions(snapshot(5), pending).has(connection.id)).toBe(true)
    expect(reconcilePendingSharedProviderDeletions(snapshot(6), pending).has(connection.id)).toBe(false)
    expect(pending.get(connection.id)?.committedRevision).toBe(5)
  })

  it('keeps an uncommitted tombstone even when a stale snapshot omits the provider', () => {
    const pending = new Map([[connection.id, { generation: 1, committedRevision: null }]])

    expect(reconcilePendingSharedProviderDeletions(snapshot(20), pending).has(connection.id)).toBe(true)
    expect(reconcilePendingSharedProviderDeletions(snapshot(20, []), pending).has(connection.id)).toBe(true)
  })

  it('does not release a committed tombstone until local settings observe the deletion', () => {
    const pending = new Map([[connection.id, { generation: 1, committedRevision: 5 }]])

    expect(reconcilePendingSharedProviderDeletions(
      snapshot(6, []),
      pending,
      new Set([connection.id])
    ).has(connection.id)).toBe(true)
    expect(reconcilePendingSharedProviderDeletions(
      snapshot(6, []),
      pending,
      new Set()
    ).has(connection.id)).toBe(false)
  })
})
