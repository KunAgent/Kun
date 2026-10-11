import type { ArtAccountAccess } from '../art-assets/account-access'
const ORIGIN='https://api-kun-server.com'
export class EngagementHttpError extends Error { constructor(readonly status:number,readonly code='unavailable') {super('engagement_http_'+status)} }
export type Identity={actor:string;credential?:string}
export function engagementClient(account:ArtAccountAccess,fetcher:typeof fetch) {
  return async (path:string,method:string,body:unknown,identity:Identity|null):Promise<Record<string,unknown>>=>{
    if(!path.startsWith('/api/engagement/'))throw new Error('engagement_path')
    for(let attempt=0;attempt<2;attempt++) {
      const headers=new Headers({'Content-Type':'application/json'})
      if(identity?.actor.startsWith('u:')) {
        const token=await account.accessToken(attempt>0)
        const state=await account.getState()
        if(!token || state.user?.id!==identity.actor.slice(2))throw new EngagementHttpError(401)
        headers.set('Authorization','Bearer '+token)
      } else if(identity?.credential) headers.set('X-Kun-Guest',identity.credential)
      const response=await fetcher(ORIGIN+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),
        credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15_000)})
      if(response.status===401 && identity?.actor.startsWith('u:') && attempt===0){await response.body?.cancel();continue}
      if(!response.ok) { const error=await response.json().catch(()=>null) as {error?:string}|null; throw new EngagementHttpError(response.status, error?.error??'unavailable') }
      // No request bodies, credentials or receipt contents are logged.
      return await response.json() as Record<string,unknown>
    }
    throw new EngagementHttpError(401)
  }
}
