import { z } from 'zod'
const Count=z.number().int().nonnegative()
const Prices=z.object({common:Count,rare:Count,epic:Count,legendary:Count})
/** Cached server presentation data, never used to authorize or calculate a drop locally. */
export const KunEngagementProgressSchema=z.object({rulesVersion:Count,serverTime:z.string(),enabled:z.boolean(),
  dailyCap:Count,dailyDrops:Count,dailyRemaining:Count,pity:Count,untilDrop:Count,epicPity:Count,untilEpic:Count,
  shelfLimit:Count,shelfCount:Count,tenPull:Count,exchangeFeathers:Prices,duplicateFeathers:Prices,
  dropRate:z.number(),cardRate:z.number(),timeZone:z.string(),minIntervalMs:Count,resetAt:z.string(),nextEligibleAt:z.string()}).strict()
export type KunEngagementProgress=z.infer<typeof KunEngagementProgressSchema>
