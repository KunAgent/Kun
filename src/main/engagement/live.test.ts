/** Opt-in production smoke: disposable guest identity; no account or real asset is created. */
import {it,expect} from 'vitest'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SqliteRoomStore} from '../../../kun/src/rooms/room-store-sqlite'
import {beginActivity,finishActivity,readQueue,setActor,claimIssue,saveTicket} from '../../../kun/src/rooms/engagement/queue'
import {applyReceipt} from '../../../kun/src/rooms/engagement/receipt'
import {readRoomWardrobe} from '../../../kun/src/rooms/room-wardrobe-service'
import {EngagementSync} from './service'
import {guestStorage} from './guest-storage'
it.skipIf(process.env.KUN_ENGAGEMENT_LIVE!=='1')('runs main → live Worker → Supabase → durable guest receipt',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kun-engagement-live-')),store=new SqliteRoomStore({path:join(dir,'rooms.sqlite')})
 const errors:string[]=[]
 const service=new EngagementSync({account:{getState:async()=>({status:'anonymous',user:null,error:null}),accessToken:async()=>null,expire:async()=>{},onState:()=>()=>{}},
  storage:guestStorage(join(dir,'guest.json')),fetch,log:code=>errors.push(code),runtime:async(path,_method,raw)=>{
   const body=raw?JSON.parse(raw):null;let result:unknown
   switch(path.split('/').pop()) {
    case 'engagement': result=(await readQueue(store)).state;break
    case 'actor': result=await setActor(store,body.actor);break
    case 'claim': result=await claimIssue(store,body.actor,body.key);break
    case 'ticket': result=await saveTicket(store,body.actor,body.key,body.ticket);break
    case 'receipt': result=await applyReceipt(store,body);break
   }
   return {ok:true,status:200,body:JSON.stringify(result)}
  }})
 try {
  service.start();await new Promise(r=>setTimeout(r,0));await service.sync()
  expect((await readQueue(store)).state.actor,errors.join(',')).toMatch(/^g:/)
  await beginActivity(store,{runId:'live-'+Date.now(),source:'code',threadId:'local-thread',sourceLabel:'local only'},new Date().toISOString())
  await service.sync();const entry=(await readQueue(store)).state.entries[0]!
  expect(entry.ticketId,errors.join(',')).toBeTruthy()
  await finishActivity(store,entry.runId,'completed');await service.sync();await service.sync()
  const detail=await readRoomWardrobe(store)
  expect(detail.guestHints).toHaveLength(1);expect(detail.wardrobe.pending).toEqual([]);expect(detail.wardrobe.items).toEqual({})
  expect((await store.events('*')).filter(e=>e.kind==='wardrobe.guest_hint')).toHaveLength(1)
  expect(errors).toEqual([])
 } finally {service.dispose();await store.close();await rm(dir,{recursive:true,force:true})}
},60000)
