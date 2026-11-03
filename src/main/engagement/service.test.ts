import {describe,it,expect,vi} from 'vitest'
import { EngagementSync } from './service'
import type { KunAccountState } from '../../shared/kun-account'
import type { EngagementEntry } from '../../../kun/src/rooms/engagement/queue'
const uid='00000000-0000-4000-8000-000000000001',ticketId='00000000-0000-4000-8000-000000000002'
const actor='u:'+uid
function fixture(input:Partial<EngagementEntry>={}) {
 let state={status:'authenticated',user:{id:uid}} as KunAccountState
 let listener:((s:KunAccountState)=>void)|undefined
 const entry={actor,key:'a'.repeat(64),serverRunId:'a'.repeat(64),runId:'private-local-run',source:'code',sourceLabel:'private title',phase:'pending',startedAt:new Date().toISOString(),...input} as EngagementEntry
 const q={actor,entries:[entry]};const calls:Array<{path:string;body:unknown;headers:Headers}>=[];const applied:unknown[]=[]
 let failIssue=false,blockIssue:(()=>Promise<void>)|undefined
 const account={getState:async()=>state,accessToken:async()=> 'user-token',expire:async()=>{},onState:(l:typeof listener)=>{listener=l;return()=>{listener=undefined}}}
 const fetcher=vi.fn(async(url:unknown,options?:RequestInit)=>{
  const path=new URL(String(url)).pathname,body=options?.body?JSON.parse(String(options.body)):undefined
  calls.push({path,body,headers:new Headers(options?.headers)})
  if(path.endsWith('/tickets') && options?.method==='POST') {
    await blockIssue?.()
    if(failIssue)throw new Error('offline')
    return new Response(JSON.stringify({ticket:{ticketId,expiresAt:new Date(Date.now()+86400_000).toISOString()}}))
  }
  if(path.endsWith('/complete'))return new Response(JSON.stringify({receipt:{receiptId:'receipt',ticketId,outcome:'none'},wardrobe:{},revision:2}))
  return new Response(JSON.stringify({ticket:null}))
 }) as unknown as typeof fetch
 const sync=new EngagementSync({account,fetch:fetcher,storage:{read:async()=>({installationId:uid}),write:async()=>{}},log:()=>{},runtime:async(path,_method,raw)=>{
  const body=raw?JSON.parse(raw):null
  if(path.endsWith('/actor'))q.actor=body.actor
  if(path.endsWith('/claim')) {if(entry.status || q.actor!==body.actor)return {ok:true,status:200,body:'null'};entry.phase='issuing';return {ok:true,status:200,body:JSON.stringify(entry)}}
  if(path.endsWith('/ticket'))Object.assign(entry,body.ticket?{...body.ticket,phase:'issued'}:{phase:'done'})
  if(path.endsWith('/receipt')){applied.push(body);entry.phase='done'}
  return {ok:true,status:200,body:JSON.stringify(q)}
 }})
 sync.start()
 return {sync,entry,calls,applied,setFail:(v:boolean)=>{failIssue=v},block:(fn:()=>Promise<void>)=>{blockIssue=fn},change:(s:KunAccountState)=>{state=s;listener?.(s)}}
}
const settle=async(f:ReturnType<typeof fixture>)=>{await new Promise(r=>setTimeout(r,0));await f.sync.sync()}
describe('main engagement lifecycle',()=>{
 it('issues while running, uploads minimal identifiers, finishes once and applies receipt',async()=>{
  const f=fixture();try {
   await settle(f);expect(f.entry.phase).toBe('issued')
   expect(f.calls[0].body).toEqual({runId:'a'.repeat(64),source:'code'})
   expect(JSON.stringify(f.calls)).not.toContain('private title')
   f.entry.status='completed';await f.sync.sync();await f.sync.sync()
   expect(f.calls.filter(c=>c.path.endsWith('/complete'))).toHaveLength(1);expect(f.applied).toHaveLength(1)
  } finally {f.sync.dispose()}
 })
 it('never issues a ticket for an offline completed start or a legacy completion',async()=>{
  const f=fixture({status:'completed'});try{await settle(f);expect(f.calls).toHaveLength(0);expect(f.entry.phase).toBe('done')}finally{f.sync.dispose()}
 })
 it('lost issue response followed by completion performs lookup only and never reconstructs a ticket',async()=>{
  const f=fixture();f.setFail(true)
  try {await settle(f);expect(f.entry.phase).toBe('issuing');f.entry.status='completed';f.setFail(false)
   const before=f.calls.length;await new Promise(r=>setTimeout(r,2100));await f.sync.sync();expect(f.calls.length).toBeGreaterThan(before);expect(f.calls.slice(before).every(c=>c.body===undefined)).toBe(true)
   expect(f.applied).toHaveLength(0)
  } finally {f.sync.dispose()}
 })
 it('keeps the issue response but suppresses delivery after an account switch',async()=>{
  const f=fixture();let release!:()=>void;f.block(()=>new Promise<void>(r=>{release=r}))
  try {
   await new Promise(r=>setTimeout(r,0));f.entry.status='completed'
   f.change({status:'authenticated',user:{id:'00000000-0000-4000-8000-000000000003'}} as KunAccountState)
   release();await f.sync.sync();expect(f.applied).toHaveLength(0);expect(f.entry.actor).toBe(actor)
  } finally {f.sync.dispose()}
 })
})
