import { timingSafeEqual } from 'node:crypto'
import { WindowsPrivatePipe, type PrivatePipeSocket } from '@kun/assistant-agent'
import type { AssistantToolHandler } from './tool-endpoint'

const MAX_BODY = 64 * 1024
function response(socket: PrivatePipeSocket, status: number, value: unknown) {
  const body = JSON.stringify(value)
  socket.end(`HTTP/1.1 ${status} ${status === 200 ? 'OK' : status === 401 ? 'Unauthorized' : 'Not Found'}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
}
function authorized(actual: string, secret: string) {
  const a=Buffer.from(actual), b=Buffer.from(`Bearer ${secret}`)
  return a.length===b.length && timingSafeEqual(a,b)
}
export async function startWindowsToolEndpoint(path: string, secret: string, routes: ReadonlySet<string>, handle: AssistantToolHandler) {
  const server = new WindowsPrivatePipe(socket => {
    socket.on('error',()=>{})
    socket.setTimeout(70000,()=>socket.destroy())
    socket.on('data',(data:Buffer)=>{
      try {
        const end=data.indexOf('\r\n\r\n');if(end<0 || end>8192) return socket.destroy()
        const lines=data.subarray(0,end).toString('utf8').split('\r\n'), match=/^POST ([^ ]+) HTTP\/1\.[01]$/.exec(lines.shift() ?? '')
        if(!match) return response(socket,404,{ok:false,error:'NOT_FOUND'})
        const headers=new Map<string,string>()
        for(const line of lines) {const at=line.indexOf(':');if(at<1)return socket.destroy();const key=line.slice(0,at).trim().toLowerCase();if(headers.has(key))return socket.destroy();headers.set(key,line.slice(at+1).trim())}
        const route=new URL(match[1],'http://assistant.local').pathname
        if(!routes.has(route))return response(socket,404,{ok:false,error:'NOT_FOUND'})
        if(!authorized(headers.get('authorization') ?? '',secret))return response(socket,401,{ok:false,error:'UNAUTHORIZED'})
        const length=Number(headers.get('content-length'))
        if(!Number.isSafeInteger(length) || length<0 || length>MAX_BODY || data.length!==end+4+length+1 || headers.has('transfer-encoding'))return socket.destroy()
        const body=JSON.parse(data.subarray(end+4,end+4+length).toString('utf8')) as unknown
        if(!body || typeof body!=='object' || Array.isArray(body))throw Error('INVALID_REQUEST')
        Promise.resolve(handle(route,body as Record<string,unknown>)).then(result=>response(socket,200,{ok:true,result}),
          error=>response(socket,200,{ok:false,error:error instanceof Error?error.message:String(error)}))
      } catch(error) {response(socket,200,{ok:false,error:error instanceof Error?error.message:'INVALID_REQUEST'})}
    })
  },'http')
  server.on('error',()=>server.close())
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve)})
  return server
}
