import type { KunAccountState } from '../../shared/kun-account'
import { hasKunAccountSession } from '../../shared/kun-account'
import type { ArtAccountAccess } from '../art-assets/account-access'
import type { RuntimeCall } from '../kun-account/wardrobe-sync'
import { engagementClient, EngagementHttpError, type Identity } from './client'
import type { guestStorage, GuestSession } from './guest-storage'
import type { EngagementEntry } from '../../../kun/src/rooms/engagement/queue'
const ROOT='/v1/rooms/engagement'
type Queue={actor:string|null;entries:EngagementEntry[]}
type Ticket={ticketId:string;expiresAt:string}
/** Network owner for both guests and accounts. The runtime holds durable lifecycle facts. */
export class EngagementSync {
  private identity:Identity|null=null
  private epoch=0
  private timer?:ReturnType<typeof setInterval>
  private busy:Promise<void>|null=null
  private leaseAt=0
  private guest?:GuestSession
  private retryAt=0
  private failures=0
  private initialized=false
  private disposed=false
  private unsubscribe?:()=>void
  private request:ReturnType<typeof engagementClient>
  constructor(private deps:{account:ArtAccountAccess;runtime:RuntimeCall;fetch:typeof fetch;storage:ReturnType<typeof guestStorage>;log:(code:string)=>void}) {
    this.request=engagementClient(deps.account,deps.fetch)
  }
  start() {
    this.unsubscribe=this.deps.account.onState(s=>this.changed(s))
    void this.deps.account.getState().then(s=>this.changed(s)).catch(()=>undefined)
    this.timer=setInterval(()=>{void this.sync()},1500);this.timer.unref?.()
  }
  private changed(state:KunAccountState) {
    if(hasKunAccountSession(state) && state.user) {
      const actor='u:'+state.user.id
      if(this.identity?.actor===actor)return
      this.epoch++;this.identity={actor};this.leaseAt=0;this.initialized=true
    } else if(state.status==='anonymous') {
      const actor=this.guest?'g:'+this.guest.guestId:null
      if(this.identity?.actor===actor && this.initialized)return
      this.epoch++;this.identity=this.guest?{actor:actor!,credential:this.guest.credential}:null;this.leaseAt=0;this.initialized=true
    } else if(!hasKunAccountSession(state)) {
      this.epoch++;this.identity=null;this.initialized=false;this.leaseAt=0
    }
    this.retryAt=0
    // Clear the prior actor promptly even when a previous network request is still in flight.
    void this.runtime('/actor',{actor:this.identity?.actor??null}).catch(()=>undefined)
    void this.sync()
  }
  private async runtime(path:string,body?:unknown) {
    const r=await this.deps.runtime(ROOT+path,body===undefined?'GET':'POST',body===undefined?undefined:JSON.stringify(body))
    if(!r.ok)throw new Error('engagement_runtime')
    return JSON.parse(r.body)
  }
  async sync():Promise<void> {
    if(this.disposed || Date.now()<this.retryAt)return
    if(this.busy)return this.busy
    this.busy=this.tick().then(()=>{this.failures=0}).catch(async error=>{
      this.retryAt=Date.now()+Math.min(60000,2000*2**Math.min(5,this.failures++))
      if(error instanceof EngagementHttpError && error.status===401 && this.identity?.actor.startsWith('g:')) {
        this.epoch++;this.identity=null;this.guest=undefined;this.leaseAt=0
        const saved=await this.deps.storage.read();await this.deps.storage.write({installationId:saved.installationId})
        await this.runtime('/actor',{actor:null}).catch(()=>undefined)
      }
      this.deps.log(error instanceof EngagementHttpError?'http_'+error.status:'unavailable')
    }).finally(()=>{this.busy=null})
    return this.busy
  }
  private async tick() {
    if(!this.initialized)return
    const epoch=this.epoch
    if(!this.identity || this.identity.actor.startsWith('g:') && Date.parse(this.guest?.expiresAt??'')<=Date.now()) {
      const saved=await this.deps.storage.read()
      let session=saved.session
      if(!session || Date.parse(session.expiresAt)<=Date.now()) {
        session=await this.request('/api/engagement/guest-sessions','POST',{installationId:saved.installationId},null) as GuestSession
        if(!session.credential?.match(/^kg_[a-f0-9]{64}$/) || !session.guestId?.match(/^[a-f0-9-]{36}$/) || !Number.isFinite(Date.parse(session.expiresAt)))throw new Error('guest_response')
        await this.deps.storage.write({...saved,session})
      }
      this.guest=session
      if(this.epoch!==epoch)return
      this.identity={actor:'g:'+session.guestId,credential:session.credential}
    }
    const identity=this.identity
    if(this.epoch!==epoch || !identity)return
    if(Date.now()-this.leaseAt>10_000) {
      await this.runtime('/actor',{actor:identity.actor});this.leaseAt=Date.now()
    }
    const q=await this.runtime('') as Queue
    if(q.actor!==identity.actor || this.epoch!==epoch)return
    const entries=q.entries.filter(e=>e.actor===identity.actor && e.phase!=='done')
    // Issue live activities first. Terminal activities only ever look up a previously issued ticket.
    for(const entry of entries.sort((a,b)=>Number(Boolean(a.status))-Number(Boolean(b.status)))) {
      if(this.epoch!==epoch || this.disposed)return
      try { await this.process(entry,identity,epoch) } catch(error) {
        if(error instanceof EngagementHttpError && [400,404,409,410,426].includes(error.status)) {
          await this.runtime('/ticket',{actor:identity.actor,key:entry.key,ticket:null})
          this.deps.log('retired_'+error.status)
        } else if(error instanceof EngagementHttpError && error.code==='engagement_pending_limit') {
          continue // Completing an existing ticket may free a pending slot.
        } else throw error
      }
    }
  }
  private async process(entry:EngagementEntry,identity:Identity,epoch:number) {
    const base={actor:identity.actor,key:entry.key}
    if(Date.now()-this.leaseAt>10_000 && this.epoch===epoch) {await this.runtime('/actor',{actor:identity.actor});this.leaseAt=Date.now()}
    if(!entry.status && entry.expiresAt && Date.parse(entry.expiresAt)<=Date.now()) {await this.runtime('/ticket',{...base,ticket:null});return}
    let ticket:Ticket|null=entry.ticketId?{ticketId:entry.ticketId,expiresAt:entry.expiresAt!}:null
    let result:Record<string,unknown>|undefined
    if(!ticket) {
      // A restart/lost response can leave an issue in flight. Lookup is safe in every lifecycle state.
      if(entry.phase==='issuing') {
        result=await this.request('/api/engagement/tickets?runId='+encodeURIComponent(entry.serverRunId),'GET',undefined,identity)
        ticket=result.ticket as Ticket|null
      }
      if(!ticket && !entry.status) {
        const claimed=await this.runtime('/claim',base) as EngagementEntry|null
        if(claimed && this.epoch===epoch) {
          result=await this.request('/api/engagement/tickets','POST',{runId:entry.serverRunId,source:entry.source},identity)
          ticket=result.ticket as Ticket|null
        }
      }
      if(ticket) await this.runtime('/ticket',{...base,ticket:{ticketId:ticket.ticketId,expiresAt:ticket.expiresAt}})
      else if(entry.status) {
        // Never convert an offline start or an old pre-ticket queue into a new eligible activity.
        await this.runtime('/ticket',{...base,ticket:null});return
      }
    }
    if(!ticket || this.epoch!==epoch)return
    // Re-read completion: it may have arrived while the issue request was in flight.
    const current=(await this.runtime('') as Queue).entries.find(e=>e.key===entry.key && e.actor===identity.actor)
    if(!current?.status)return
    result=await this.request('/api/engagement/tickets/'+ticket.ticketId+'/complete','POST',{status:current.status},identity)
    if(this.epoch!==epoch)return
    await this.runtime('/receipt',{...base,receipt:result.receipt,serverRevision:result.revision,...(result.wardrobe?{wardrobe:{...(result.wardrobe as object),progress:result.progress}}:{})})
  }
  dispose() {this.disposed=true;this.epoch++;clearInterval(this.timer);this.unsubscribe?.()}
}
