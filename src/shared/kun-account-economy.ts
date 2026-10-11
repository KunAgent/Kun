import type { KunAvatarParts, KunWardrobe, KunWardrobeDrop, KunWardrobeItemKey, KunWardrobeSettings } from './rooms-api'

/**
 * The Kun account's wardrobe, feather shop and invitations as the renderer sees them. Main holds the
 * tokens, calls Kunserve, and keeps the runtime's wardrobe row as the account's mirror; every
 * wardrobe result carries that mirror so editors and the sidebar update at once.
 */

/** A Kunserve rule code (`not_enough_feathers`, `invite_self`, ...) or a local failure. */
export type KunEconomyFailure = 'anonymous' | 'expired' | 'network' | 'service' | 'runtime' | 'invalid_request' | (string & {})
export type KunEconomyResult<T> = { ok: true; value: T } | { ok: false; code: KunEconomyFailure }

export type KunAccountWardrobeDetail = { wardrobe: KunWardrobe; revision: number; mode: 'account' }
export type KunAccountOpenResult = KunAccountWardrobeDetail & {
  drops: KunWardrobeDrop[]; drop: KunWardrobeDrop; granted: KunWardrobeItemKey[]; feathers: number; guaranteed: boolean
}

export type KunShopOffer = {
  id: string
  title: Record<string, string>
  bottles: number
  price: number
  dailyLimit: number | null
  purchasedToday: number
  endsAt: string | null
}
export type KunShop = { feathers: number; shelf: { pending: number; limit: number }; offers: KunShopOffer[] }
export type KunShopPurchase = KunAccountWardrobeDetail & {
  purchase: { id: string; offerId: string; bottles: number; price: number; bottleIds: string[] }
  shop: KunShop
}

export type KunReferral = { status: 'pending' | 'rewarded' | 'capped'; claimedAt: string; qualifiedAt: string | null }
export type KunInviteSummary = {
  code: string
  link: string
  invited: number
  pending: number
  rewarded: number
  monthlyRewarded: number
  monthlyCap: number
  rewards: { inviter: { bottles?: number; feathers?: number }; invitee: { bottles?: number; feathers?: number } }
  recent: KunReferral[]
  invitedBy: KunReferral | null
  canClaim: boolean
  claimUntil: string | null
}

export type KunSharePosterSavePayload = { dataBase64: string; fileName: string }
export type KunSharePosterSaveResult = { status: 'cancelled' } | { status: 'saved'; path: string }

export interface KunAccountWardrobeApi {
  revealSharePoster(): Promise<void>
  saveSharePoster(payload: KunSharePosterSavePayload): Promise<KunSharePosterSaveResult>
  /** Reports finished turns to the account and refreshes the mirror; harmless when signed out. */
  sync(): Promise<KunEconomyResult<null>>
  open(dropIds: string[]): Promise<KunEconomyResult<KunAccountOpenResult>>
  stash(dropIds: string[]): Promise<KunEconomyResult<KunAccountWardrobeDetail>>
  seen(keys: string[]): Promise<KunEconomyResult<KunAccountWardrobeDetail>>
  settings(settings: Partial<KunWardrobeSettings>): Promise<KunEconomyResult<KunAccountWardrobeDetail>>
  /** Makes this look the account avatar; the server accepts only owned items. */
  setLook(parts: KunAvatarParts): Promise<KunEconomyResult<KunAccountWardrobeDetail>>
  shop(): Promise<KunEconomyResult<KunShop>>
  purchase(offerId: string): Promise<KunEconomyResult<KunShopPurchase>>
  invites(): Promise<KunEconomyResult<KunInviteSummary>>
  claimInvite(code: string): Promise<KunEconomyResult<KunInviteSummary>>
}

export const KUN_ACCOUNT_WARDROBE_CHANNELS = {
  saveSharePoster: 'kun-account:share:save', revealSharePoster: 'kun-account:share:reveal',
  sync: 'kun-account:wardrobe:sync', open: 'kun-account:wardrobe:open', stash: 'kun-account:wardrobe:stash',
  seen: 'kun-account:wardrobe:seen', settings: 'kun-account:wardrobe:settings',
  setLook: 'kun-account:wardrobe:look', shop: 'kun-account:shop', purchase: 'kun-account:shop:purchase',
  invites: 'kun-account:invites', claimInvite: 'kun-account:invites:claim'
} as const
