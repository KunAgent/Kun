import { describe, expect, it, vi } from 'vitest'
import type { KunAccountState } from '../../shared/kun-account'
import { EconomyError, type EconomyClient } from './economy-client'
import { AccountWardrobeSync } from './wardrobe-sync'

const signedIn = (id = 'user-1'): KunAccountState => ({ status: 'authenticated', user: { id, email: 'a@b.c', name: 'A', avatarUrl: null }, error: null })
const signedOut: KunAccountState = { status: 'anonymous', user: null, error: null }
const snapshot = (look: unknown = null, extra: Record<string, unknown> = {}) => ({ wardrobe: { feathers: 1 }, look, revision: 3, catalogVersion: 'c', ...extra })

function setup(options: { activity?: unknown[]; economy?: Partial<Record<keyof EconomyClient, ReturnType<typeof vi.fn>>> } = {}) {
  const runtimeCalls: Array<[string, string, unknown]> = []
  const runtime = vi.fn(async (path: string, method = 'GET', body?: string) => {
    runtimeCalls.push([path, method, body ? JSON.parse(body) : undefined])
    if (path.endsWith('/attach') || path.endsWith('/ack')) return { ok: true, status: 200, body: JSON.stringify({ wardrobe: { feathers: 9 }, revision: 7, mode: 'account' }) }
    if (path.endsWith('/activity')) return { ok: true, status: 200, body: JSON.stringify({ userId: 'user-1', activity: options.activity ?? [] }) }
    if (path === '/v1/rooms/user-profile') return { ok: true, status: 200, body: JSON.stringify({ profile: { avatar: { kind: 'composed', parts: { color: 'sky' } } } }) }
    return { ok: true, status: 200, body: '{}' }
  })
  const economy = {
    wardrobe: vi.fn(async () => snapshot({ color: 'mint' })), activity: vi.fn(), setLook: vi.fn(async () => snapshot({ color: 'sky' })),
    open: vi.fn(async () => ({ ...snapshot(), drops: [{ id: 'd' }], feathers: 5 })), shop: vi.fn(async () => ({ offers: [] })),
    ...options.economy
  } as unknown as EconomyClient
  const sync = new AccountWardrobeSync({ economy, runtime, log: vi.fn(), intervalMs: 60_000 })
  const settled = () => sync.sync()
  return { sync, economy, runtimeCalls, settled }
}

describe('account wardrobe mirror', () => {
  it('attaches the account with its look once per user and detaches on sign-out', async () => {
    const { sync, runtimeCalls, settled } = setup()
    sync.accountChanged(signedIn())
    sync.accountChanged(signedIn())
    await settled()
    expect(runtimeCalls[0]).toEqual(['/v1/rooms/wardrobe/account/attach', 'POST', { userId: 'user-1', wardrobe: { feathers: 1 }, look: { color: 'mint' } }])
    expect(runtimeCalls.filter(([path]) => path.endsWith('/attach'))).toHaveLength(1)
    sync.accountChanged({ ...signedIn(), status: 'error', error: 'network' })
    sync.accountChanged(signedOut)
    sync.accountChanged(signedOut)
    await vi.waitFor(() => expect(runtimeCalls.filter(([path]) => path.endsWith('/detach'))).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(runtimeCalls.filter(([path]) => path.endsWith('/detach'))).toHaveLength(1)
    sync.dispose()
  })

  it('gives a new account the look this machine already wears', async () => {
    const { sync, economy, runtimeCalls, settled } = setup({ economy: { wardrobe: vi.fn(async () => snapshot(null)) } })
    sync.accountChanged(signedIn())
    await settled()
    expect(economy.setLook).toHaveBeenCalledWith({ color: 'sky' })
    expect(runtimeCalls.filter(([path]) => path.endsWith('/attach')).map(([, , body]) => 'look' in (body as object))).toEqual([true, false])
    sync.dispose()
  })

  it('reports queued turns, acknowledges refusals, keeps the rest during an outage', async () => {
    const activity = vi.fn()
      .mockResolvedValueOnce({ counted: true, drop: { id: 'drop-1' }, ...snapshot() })
      .mockRejectedValueOnce(new EconomyError('activity_invalid'))
      .mockRejectedValueOnce(new EconomyError('network'))
    const { sync, runtimeCalls, settled } = setup({ economy: { activity }, activity: [
      { runId: 'run-1', source: 'room', roomId: 'room-a', messageId: 'm' }, { runId: 'run-2', source: 'code', threadId: 't' },
      { runId: 'run-3', source: 'room' }] })
    sync.accountChanged(signedIn())
    await settled()
    expect(activity.mock.calls[0]![0]).toEqual({ runId: 'run-1', source: 'room', context: { roomId: 'room-a', messageId: 'm' } })
    const ack = runtimeCalls.find(([path]) => path.endsWith('/ack'))!
    expect(ack[2]).toEqual({ userId: 'user-1', runIds: ['run-1', 'run-2'], drops: [{ runId: 'run-1', dropId: 'drop-1' }], wardrobe: { feathers: 1 } })
    sync.dispose()
  })

  it('returns account answers with the mirror and reports failures as codes', async () => {
    const { sync, settled } = setup()
    expect(await sync.change((economy) => economy.shop())).toEqual({ ok: false, code: 'anonymous' })
    sync.accountChanged(signedIn())
    await settled()
    expect(await sync.change((economy) => economy.open(['d']))).toEqual({ ok: true,
      value: { drops: [{ id: 'd' }], feathers: 5, wardrobe: { feathers: 9 }, revision: 7, mode: 'account' } })
    expect(await sync.change(async () => { throw new EconomyError('shelf_full') })).toEqual({ ok: false, code: 'shelf_full' })
    expect(await sync.read((economy) => economy.shop())).toEqual({ ok: true, value: { offers: [] } })
    sync.dispose()
  })
})
