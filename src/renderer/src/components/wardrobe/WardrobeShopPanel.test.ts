import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createKunWardrobe } from '@shared/rooms-api'
import type { KunShop } from '@shared/kun-account-economy'

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${Object.values(values).join(',')}` : key
}) }))
import { WardrobeShopPanel } from './WardrobeShopPanel'
import { acceptWardrobe } from '../rooms/room-wardrobe'

const shop: KunShop = { feathers: 200, shelf: { pending: 0, limit: 99 }, offers: [
  { id: 'bottle-1', title: { en: 'One bottle' }, bottles: 1, price: 30, dailyLimit: null, purchasedToday: 0, endsAt: null },
  { id: 'bottle-10', title: { en: 'Ten bottles' }, bottles: 10, price: 250, dailyLimit: 2, purchasedToday: 0, endsAt: null }
] }
const wardrobe = { ...createKunWardrobe(1), feathers: 200 }
const api = { shop: vi.fn(), purchase: vi.fn() }
let renderer: ReactTestRenderer
const buy = (id: string) => renderer.root.findByProps({ 'data-wardrobe-buy': id })
const render = async (onBought = vi.fn()) => act(async () => {
  renderer = create(createElement(WardrobeShopPanel, { wardrobe, language: 'en', onBought }))
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', { kunGui: { kunAccount: { wardrobe: api } } })
  api.shop.mockResolvedValue({ ok: true, value: shop })
  acceptWardrobe({ wardrobe, revision: 1, mode: 'account' })
})
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })

describe('wardrobe bottle shop', () => {
  it('buys the server offer and updates the balance and shelf with sealed bottles', async () => {
    const onBought = vi.fn()
    const pending = [{ id: 'sealed-1', source: 'shop' as const, runId: 'purchase-1', createdAt: new Date().toISOString() }]
    api.purchase.mockResolvedValue({ ok: true, value: {
      wardrobe: { ...wardrobe, feathers: 170, pending }, revision: 2, mode: 'account',
      purchase: { id: 'purchase-1', offerId: 'bottle-1', bottles: 1, price: 30, bottleIds: ['sealed-1'] },
      shop: { ...shop, feathers: 170, shelf: { pending: 1, limit: 99 } }
    } })
    await render(onBought)
    expect(buy('bottle-1').props.disabled).toBe(false)
    expect(buy('bottle-10').props.disabled).toBe(true)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('wardrobeShopExchange')
    await act(async () => buy('bottle-1').props.onClick())
    expect(api.purchase).toHaveBeenCalledExactlyOnceWith('bottle-1')
    expect(onBought).toHaveBeenCalledExactlyOnceWith('wardrobeShopBought:1')
    expect(renderer.root.findByProps({ 'data-wardrobe-shop-feathers': 170 })).toBeDefined()
    expect(JSON.stringify(renderer.toJSON())).toContain('wardrobeShopShelf:1,99')
  })

  it.each([
    { patch: { feathers: 0 }, label: 'wardrobeShopShort:30' },
    { patch: { shelf: { pending: 99, limit: 99 } }, label: 'wardrobeShopShelfFull' },
    { patch: { offers: [{ ...shop.offers[0]!, dailyLimit: 1, purchasedToday: 1 }] }, label: 'wardrobeShopLimit' }
  ])('respects server balance, shelf capacity and daily offer limits ($label)', async ({ patch, label }) => {
    api.shop.mockResolvedValue({ ok: true, value: { ...shop, ...patch } })
    await render()
    expect(buy('bottle-1').props.disabled).toBe(true)
    expect(buy('bottle-1').children).toContain(label)
    expect(api.purchase).not.toHaveBeenCalled()
  })
})
