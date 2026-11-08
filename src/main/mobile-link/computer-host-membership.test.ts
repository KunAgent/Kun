import { expect, it } from 'vitest'
import type { RemoteApi, AccountEntitlements } from '@kun/remote-protocol'
import { ComputerHostAccess } from './computer-host-access'

const owner='11111111-1111-4111-8111-111111111111'
it('ordinary phone startup can decline computer access without declining the phone transport',async()=>{
  const access=new ComputerHostAccess(), requests:string[]=[]
  let tier:'pro'|'max'='pro'
  const api={entitlements:async()=>({version:1,userId:owner,tier,effectiveTier:tier,status:'active',expiresAt:null,checkedAt:new Date().toISOString(),revision:1,features:{mobileRemote:true,personalAssistant:true}} as AccountEntitlements),
    request:async(path:string)=>{requests.push(path);return path==='/capabilities'?{desktop:{computerAccess:true}}:{ok:true}}} as RemoteApi
  await access.advertise(api,true,false,owner)
  expect(access.active).toBe(false);expect(requests).toEqual([])
  await expect(access.advertise(api,true,true,owner)).rejects.toThrow('vip_computer_remote_required')
  tier='max';await access.advertise(api,true,true,owner);expect(access.current()).toBe(true)
  tier='pro';expect(await access.renew()).toBe(false);expect(access.current()).toBe(false)
  await access.advertise(api,false,true,owner);expect(access.active).toBe(false)
  expect(requests.at(-1)).toBe('/desktop/host')
})
