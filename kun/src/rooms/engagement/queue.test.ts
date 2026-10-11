import {afterEach,it,expect} from 'vitest'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SqliteRoomStore} from '../room-store-sqlite.js'
import {beginActivity,finishActivity,claimIssue,readQueue,setActor,saveTicket,updateQueue,keyFor} from './queue.js'
import {applyReceipt} from './receipt.js'
import {readRoomWardrobe} from '../room-wardrobe-service.js'
const resources:Array<{store:SqliteRoomStore;dir:string}>=[]
afterEach(async()=>{for(const r of resources.splice(0)){await r.store.close();await rm(r.dir,{recursive:true,force:true})}})
async function store(){const dir=await mkdtemp(join(tmpdir(),'engagement-'));const store=new SqliteRoomStore({path:join(dir,'rooms.sqlite')});resources.push({store,dir});return store}
const guest='g:00000000-0000-4000-8000-000000000001',user='u:00000000-0000-4000-8000-000000000002'
const ticketId='00000000-0000-4000-8000-000000000003'
const now=()=>new Date().toISOString()
const progress={rulesVersion:1,serverTime:now(),enabled:true,dailyCap:5,dailyDrops:1,dailyRemaining:4,pity:12,untilDrop:12,epicPity:10,untilEpic:10,shelfLimit:99,shelfCount:0,tenPull:10,exchangeFeathers:{common:30,rare:80,epic:200,legendary:500},duplicateFeathers:{common:5,rare:15,epic:40,legendary:100},dropRate:.12,cardRate:.08,timeZone:'Asia/Shanghai',minIntervalMs:60000,resetAt:now(),nextEligibleAt:now()}
it('binds the start identity, retains it across switches and never manufactures missing starts',async()=>{
 const s=await store();await finishActivity(s,'offline','completed');expect((await readQueue(s)).state.entries).toHaveLength(0)
 await setActor(s,guest);await beginActivity(s,{runId:'r',source:'code',threadId:'t'},now())
 const e=(await readQueue(s)).state.entries[0]!;await setActor(s,user)
 expect(await claimIssue(s,user,e.key)).toBeNull();await finishActivity(s,'r','completed')
 expect((await readQueue(s)).state.entries[0]).toMatchObject({actor:guest,status:'completed'})
 await setActor(s,guest);expect(await claimIssue(s,guest,e.key)).toBeNull()
})
it('applies guest receipt and progress atomically once, without minting any asset',async()=>{
 const s=await store();await setActor(s,guest);await beginActivity(s,{runId:'r',source:'room',roomId:'room'},now())
 const e=(await readQueue(s)).state.entries[0]!;await claimIssue(s,guest,e.key)
 await saveTicket(s,guest,e.key,{ticketId,expiresAt:now()});await finishActivity(s,'r','completed')
 const input={actor:guest,key:e.key,receipt:{receiptId:'00000000-0000-4000-8000-000000000004',ticketId,outcome:'login_hint' as const,reason:'daily_first',rulesVersion:1,settledAt:now(),dropId:null,progress}}
 expect(await applyReceipt(s,input)).toEqual({applied:true});expect(await applyReceipt(s,input)).toEqual({applied:false})
 const view=await readRoomWardrobe(s);expect(view.guestHints).toHaveLength(1);expect(view.wardrobe.pending).toEqual([]);expect(view.wardrobe.items).toEqual({});expect(view.wardrobe.progress).toEqual(progress)
 expect((await s.events('*')).filter(e=>e.kind==='wardrobe.guest_hint')).toHaveLength(1)
})
it('does not replay historical starts and caps the local outbox without moving identity',async()=>{
 const s=await store();await setActor(s,guest);await beginActivity(s,{runId:'old',source:'code'},new Date(Date.now()-60000).toISOString())
 expect((await readQueue(s)).state.entries).toHaveLength(0)
})

it('compacts completed entries while retaining durable start deduplication',async()=>{
 const s=await store();await setActor(s,guest)
 await beginActivity(s,{runId:'first',source:'code'},now())
 await updateQueue(s,state=>({state:{...state,entries:Array.from({length:256},(_,i)=>({actor:guest,runId:i?'r'+i:'first',key:keyFor(i?'r'+i:'first'),serverRunId:keyFor(i?'r'+i:'first'),source:'code',startedAt:now(),phase:'done'}))},result:null}))
 await beginActivity(s,{runId:'new',source:'code'},now())
 let entries=(await readQueue(s)).state.entries
 expect(entries).toHaveLength(256);expect(entries.some(e=>e.runId==='new')).toBe(true);expect(entries.some(e=>e.runId==='first')).toBe(false)
 await beginActivity(s,{runId:'first',source:'code'},now())
 entries=(await readQueue(s)).state.entries;expect(entries.some(e=>e.runId==='first')).toBe(false)
})
