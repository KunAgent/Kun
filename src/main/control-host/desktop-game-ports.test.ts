import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopAuthority, DesktopEngineDependencies } from '@kun/control-runtime/desktop'
import { DesktopPorts } from './desktop-ports'

describe('trusted native game capture admission', () => {
  it.each([
    { desktop:false, gaming:true, audio:true, quality:'game60', rejected:true },
    { desktop:true, gaming:false, audio:true, quality:'game60', rejected:true },
    { desktop:true, gaming:true, audio:true, quality:'balanced', expected:false },
    { desktop:true, gaming:true, audio:false, quality:'game60', expected:false },
    { desktop:true, gaming:true, audio:true, quality:'game60', expected:true }
  ])('enforces peer role, negotiated quality and local audio consent ($desktop, $gaming, $audio, $quality)', async rule => {
    const start = vi.fn(async () => ({type:'offer',sdp:'v=0'}))
    const authority: DesktopAuthority = { accountId:'owner',deviceId:'controller',authorizationId:'grant',
      purpose:rule.desktop ? 'desktop' : undefined, scopes:['desktop.view'],current:()=>true,emit(){} }
    const deps = { authorizeOrigin:async()=>{},capture:()=>({open:async()=>{},start}) } as unknown as DesktopEngineDependencies
    const ports = new DesktopPorts('host',deps,()=>undefined,()=>authority,()=>true,()=>{},()=>false,()=>rule.gaming,()=>rule.audio)
    const resourceId = randomUUID()
    await ports.call({operation:'authorizeOrigin',authorityId:'grant',origin:{kind:'device',id:'host'}})
    await ports.call({operation:'capture.open',resourceId,fields:{displayId:1},args:[]})
    const result = ports.call({operation:'capture.start',resourceId,args:[[],rule.quality,true]})
    if (rule.rejected) {
      await expect(result).rejects.toThrow('DESKTOP_GAME_UNAVAILABLE')
      expect(start).not.toHaveBeenCalled()
    } else {
      await result
      expect(start).toHaveBeenCalledWith([],rule.quality,rule.expected)
    }
  })
})
