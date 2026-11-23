// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ComputerAccessPanel } from './ComputerAccessPanel'
import type { MobileLink } from './useMobileLink'
import i18n from '../../i18n'

vi.mock('../../extensions/protected-user-activation',()=>({runTrustedUserActivation:(_event:unknown,action:()=>void)=>action()}))
let container:HTMLDivElement,root:Root
const pc={id:'mac',installationId:'other',name:'Other Mac',platform:'macos',enabled:true,supported:true,online:true,grantId:'grant'}
beforeEach(async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
  await i18n.changeLanguage('en');container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove()})
const button=(text:string)=>[...container.querySelectorAll('button')].find(b=>b.textContent===text)!
async function render(allowed:boolean,hosting=false,paired=true){
  const device={...pc,grantId:paired?pc.grantId:null}
  const api={status:vi.fn(async()=>({supported:true,online:true,devices:[device]})),refresh:vi.fn(async()=>({supported:true,online:true,devices:[device]})),open:vi.fn(),pair:vi.fn(),enableHost:vi.fn(),close:vi.fn(),confirmClosed:vi.fn()}
  const link={api:{computers:api,confirm:vi.fn(),setScopes:vi.fn(),revoke:vi.fn()},zh:false,signedIn:true,account:{state:{user:{id:'owner'}}},mobileAllowed:true,computerAllowed:allowed,
    computerMembershipState:allowed?'active':'maxRequired',refreshMembership:vi.fn(),state:{computerAccess:hosting,pairings:[],grants:[]}} as unknown as MobileLink
  await act(async()=>root.render(createElement(ComputerAccessPanel,{link,desktop:{value:{enabled:hosting,displays:[]},refresh:vi.fn()} as any,onBack:vi.fn()})))
  return api
}
it('Plus/Pro phone eligibility never unlocks computer discovery or connection',async()=>{
  const api=await render(false)
  expect(api.refresh).not.toHaveBeenCalled();expect(api.status).toHaveBeenCalled()
  expect(container.textContent).toContain('active Max membership')
  expect(button('Refresh').disabled).toBe(true);expect(button('Open desktop').disabled).toBe(true)
  await act(async()=>button('Allow access here').click());expect(button('Turn on').disabled).toBe(true)
})
it('unpaired computers connect directly with progress instead of a request-and-approve step',async()=>{
  const api=await render(true,false,false)
  expect(container.textContent).toContain('Ready to connect')
  expect(container.textContent).not.toContain('Request access')
  let resolve!:()=>void
  api.open.mockImplementation(()=>new Promise<void>(done=>{resolve=done}))
  await act(async()=>button('Open desktop').click())
  expect(api.open).toHaveBeenCalledExactlyOnceWith('mac')
  expect(api.pair).not.toHaveBeenCalled()
  expect(button('Connecting…').disabled).toBe(true)
  await act(async()=>resolve())
  expect(button('Open desktop').disabled).toBe(false)
  expect(container.textContent).not.toContain('Request sent')
})
it('Max can connect, while losing Max still permits turning existing hosting off',async()=>{
  const api=await render(true)
  expect(api.refresh).toHaveBeenCalled();expect(button('Open desktop').disabled).toBe(false)
  await render(false,true);await act(async()=>button('Allow access here').click())
  expect(button('Turn off').disabled).toBe(false)
})
