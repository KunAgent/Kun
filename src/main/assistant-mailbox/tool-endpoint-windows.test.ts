import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { startWindowsToolEndpoint } from './tool-endpoint-windows'

const mocks=vi.hoisted(()=>({connect:undefined as undefined | ((socket:any)=>void)}))
vi.mock('@kun/assistant-agent',async()=>{
 const {EventEmitter:Emitter}=await import('node:events')
 return {WindowsPrivatePipe:class extends Emitter {
  constructor(callback:(socket:any)=>void) {super();mocks.connect=callback}
  listen(_path:string,ready:()=>void){ready()}
  close(){}
 }}
})
class Socket extends EventEmitter {
 destroyed=false; output=''
 setTimeout(){return this}
 destroy(){this.destroyed=true}
 end(value:string){this.output=value}
}
function call(secret:string, route='/tasks', payload='{}') {
 const socket=new Socket();mocks.connect!(socket)
 socket.emit('data',Buffer.from(`POST ${route} HTTP/1.1\r\nAuthorization: Bearer ${secret}\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}\n`))
 return socket
}
it('Windows bridge authenticates and bounds the complete local HTTP request',async()=>{
 const handler=vi.fn(async(_route:string,body:Record<string,unknown>)=>({echo:body}))
 await startWindowsToolEndpoint('pipe','secret',new Set(['/tasks']),handler)
 const unauthorized=call('wrong');expect(unauthorized.output).toContain('401 Unauthorized');expect(handler).not.toHaveBeenCalled()
 const missing=call('secret','/forbidden');expect(missing.output).toContain('404 Not Found')
 const accepted=call('secret','/tasks','{"id":1}');await vi.waitFor(()=>expect(accepted.output).toContain('200 OK'))
 expect(handler).toHaveBeenCalledWith('/tasks',{id:1});expect(accepted.output).toContain('"echo":{"id":1}')
})
