import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngagementSync } from './service'
import type { EngagementEntry } from '../../../kun/src/rooms/engagement/queue'

const id = '11111111-1111-4111-8111-111111111111'
const actor = 'u:' + id
const ticketId = '22222222-2222-4222-8222-222222222222'
const entriesFor = (keys: string[]): EngagementEntry[] => keys.map(key => ({
  actor, key, serverRunId: key, runId: key, source: 'code', phase: 'pending', startedAt: new Date().toISOString()
}))
const running: EngagementSync[] = []
afterEach(() => { for (const sync of running.splice(0)) sync.dispose(); vi.useRealTimers() })

function fixture(entries: EngagementEntry[], loseRetry = false) {
  let full = true, refused = false
  const calls: string[] = []
  const sync = new EngagementSync({
    account: {getState: async () => ({status:'authenticated', user:{id,name:'User',email:'test@example.invalid',avatarUrl:null},error:null}),
      accessToken:async ()=>'fixture', onState:()=>()=>{}, expire:async()=>{}},
    storage:{read:async()=>({installationId:id}),write:async()=>{}}, log:()=>{},
    runtime:async(path, _method, data)=>{
      const body=data ? JSON.parse(data) : {}, entry=entries.find(value=>value.key===body.key)
      let result: unknown = {actor,entries}
      if (path.endsWith('/claim') && entry) { entry.phase='issuing'; result=entry }
      if (path.endsWith('/ticket') && entry) Object.assign(entry,body.ticket,{phase:body.ticket?'issued':'done'})
      if (path.endsWith('/receipt') && entry) entry.phase='done'
      return {ok:true, status:200, body:JSON.stringify(result)}
    },
    fetch:async (input,init)=>{
      const path=new URL(String(input)).pathname
      if (path.endsWith('/complete')) {
        calls.push('complete'); full=false
        return Response.json({receipt:{ticketId},replayed:false})
      }
      if (init?.method==='GET') { calls.push('lookup'); return Response.json({ticket:null}) }
      calls.push('issue')
      if (loseRetry && refused && full) { full=false; throw Error('lost response') }
      refused=full
      return full ? Response.json({error:'engagement_pending_limit'},{status:429})
        : Response.json({ticket:{ticketId,expiresAt:new Date(Date.now()+86400000).toISOString()}})
    }
  })
  running.push(sync); sync.start()
  return calls
}

describe('activity ticket capacity', () => {
  it('defers new issues across the actor queue without repeated lookups each tick', async () => {
    vi.useFakeTimers()
    const calls = fixture(entriesFor(['one','two','three']))
    await vi.advanceTimersByTimeAsync(3000)
    expect(calls).toEqual(['issue'])
    await vi.advanceTimersByTimeAsync(3000)
    expect(calls).toEqual(['issue','issue'])
    await vi.advanceTimersByTimeAsync(3000)
    expect(calls).toHaveLength(2)
  })
  it('settles an existing ticket during a cooldown and promptly uses the freed slot', async () => {
    vi.useFakeTimers()
    const entries=entriesFor(['blocked','issued'])
    Object.assign(entries[1],{phase:'issued',status:'completed',ticketId,expiresAt:new Date(Date.now()+60000).toISOString()})
    const calls=fixture(entries)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual(['issue','complete'])
    await vi.advanceTimersByTimeAsync(1500)
    expect(calls).toEqual(['issue','complete','issue'])
    expect(entries.map(e=>e.phase)).toEqual(['issued','done'])
  })
  it('reconciles by run ID after an ambiguous retry even following an explicit refusal', async () => {
    vi.useFakeTimers()
    const calls=fixture(entriesFor(['run']), true)
    await vi.advanceTimersByTimeAsync(12000)
    expect(calls).toEqual(['issue','issue','lookup','issue'])
  })
})
