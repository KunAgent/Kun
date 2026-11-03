/** Apply a verified server response and announce it atomically; replay never repeats animation. */
import { z } from 'zod'
import type { RoomStore } from '../room-store.js'
import { RoomStoreConflictError } from '../room-store.js'
import { readQueue, KIND } from './queue.js'
import { mirrorWardrobe } from '../room-wardrobe-account.js'
import { readWardrobeAccountState, WARDROBE_ACCOUNT_KIND } from '../room-wardrobe-mode.js'
import { readRoomWardrobe } from '../room-wardrobe-service.js'
import { KunEngagementProgressSchema } from '../../contracts/kun-engagement.js'
export const Receipt = z.object({ receiptId:z.string().uuid(),ticketId:z.string().uuid(),outcome:z.enum(['bottle','login_hint','none']),
  reason:z.string(),rulesVersion:z.number(),settledAt:z.string(),dropId:z.string().uuid().nullable(),progress:KunEngagementProgressSchema }).passthrough()
export const ApplyReceipt = z.object({actor:z.string(),key:z.string(),serverRevision:z.number().optional(),receipt:Receipt,wardrobe:z.record(z.string(),z.unknown()).optional()}).strict()
export async function applyReceipt(store:RoomStore,input:z.infer<typeof ApplyReceipt>) {
  await readRoomWardrobe(store)
  for(let attempt=0;;attempt++) {
    const row=await readQueue(store), account=await readWardrobeAccountState(store)
    const entry=row.state.entries.find(e=>e.key===input.key && e.actor===input.actor)
    if(!entry || entry.phase==='done') return {applied:false}
    if(row.state.actor!==input.actor || entry.ticketId!==input.receipt.ticketId) return {applied:false}
    const isUser=input.actor.startsWith('u:')
    if(isUser ? account.state?.userId!==input.actor.slice(2) || account.state.mode!=='account' : account.state?.mode!=='guest') return {applied:false}
    const current=await store.get<Record<string,unknown>>('room_wardrobe','self')
    if(!current || !account.state) return {applied:false}
    if(isUser && !input.wardrobe) throw new Error('engagement_snapshot_missing')
    const localContext=Object.fromEntries(['roomId','threadId','messageId','sourceLabel'].flatMap(k=>entry[k as keyof typeof entry] ? [[k,entry[k as keyof typeof entry]]] : []))
    const newer=(account.state.serverRevision??0)>(input.serverRevision??0)
    const wardrobe=newer ? current.value : isUser ? mirrorWardrobe(input.wardrobe!) : {...current.value,progress:input.receipt.progress}
    // Match opaque server run IDs to local context without transmitting it.
    if(isUser && !newer) for(const drop of [...(wardrobe as ReturnType<typeof mirrorWardrobe>).pending,...(wardrobe as ReturnType<typeof mirrorWardrobe>).history]) {
      const origin=row.state.entries.find(e=>e.actor===input.actor && e.serverRunId===drop.runId)
      if(origin?.receiptReason && origin.receiptResetAt) drop.activityReceipt={reason:origin.receiptReason,resetAt:origin.receiptResetAt}
      if(drop.id===input.receipt.dropId) drop.activityReceipt={reason:input.receipt.reason,resetAt:input.receipt.progress.resetAt}
      if(origin) for(const key of ['roomId','threadId','messageId','sourceLabel'] as const) if(origin[key])drop[key]=origin[key]
    }
    const hint={id:input.receipt.receiptId,createdAt:input.receipt.settledAt,...(entry.roomId?{roomId:entry.roomId}:{}),...(entry.threadId?{threadId:entry.threadId}:{})}
    const state=input.receipt.outcome==='login_hint' && !isUser
      ? {...account.state,guestHints:[...(account.state.guestHints??[]),hint].slice(-20)} : {...account.state,...(isUser?{serverRevision:Math.max(account.state.serverRevision??0,input.serverRevision??0)}:{})}
    const events=[{roomId:'agent-directory',kind:'wardrobe.updated',payload:{}}]
    if(input.receipt.outcome==='bottle' && isUser) events.push({roomId:entry.roomId??'agent-directory',kind:'wardrobe.dropped',payload:{...localContext,dropId:input.receipt.dropId,runId:entry.runId,receiptId:input.receipt.receiptId}})
    if(input.receipt.outcome==='login_hint' && !isUser) events.push({roomId:entry.roomId??'agent-directory',kind:'wardrobe.guest_hint',payload:hint})
    try {
      await store.commit({requestId:'engagement-receipt:'+input.receipt.receiptId,checks:[
        {kind:KIND,id:'self',expectedRevision:row.revision},
        {kind:'room_wardrobe',id:'self',expectedRevision:current.revision},
        {kind:WARDROBE_ACCOUNT_KIND,id:'self',expectedRevision:account.revision}
      ],puts:[{kind:KIND,id:'self',value:{...row.state,entries:row.state.entries.map(e=>e.key===entry.key?{...e,phase:'done',receiptId:input.receipt.receiptId,receiptReason:input.receipt.reason,receiptResetAt:input.receipt.progress.resetAt}:e)}},
        {kind:'room_wardrobe',id:'self',value:wardrobe},{kind:WARDROBE_ACCOUNT_KIND,id:'self',value:state}],events})
      return {applied:true}
    } catch(error) { if(!(error instanceof RoomStoreConflictError) || attempt>=4)throw error }
  }
}
