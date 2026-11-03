import {KUN_WARDROBE_RULES} from './wardrobe-simulator.js'
import type {KunWardrobe} from '../contracts/kun-wardrobe.js'
/** Server response fixture, used only in UI and outbox tests. */
export const serverPolicy=(patch:Partial<NonNullable<KunWardrobe['progress']>>={})=>({
 rulesVersion:1,serverTime:new Date().toISOString(),enabled:true,...KUN_WARDROBE_RULES,
 dailyDrops:0,dailyRemaining:5,untilDrop:12,untilEpic:10,shelfCount:0,timeZone:'Asia/Shanghai',
 resetAt:new Date(Date.now()+86400000).toISOString(),nextEligibleAt:new Date().toISOString(),...patch
})
