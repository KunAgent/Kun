import { createServer as createHttpServer, request } from 'node:http'
import { connect, createServer as createTcpServer, type Server, type Socket } from 'node:net'

export function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

export async function listen(server: Server): Promise<{
  port: number
  close: () => Promise<void>
}> {
  const sockets = new Set<Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing local server port')
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      for (const socket of sockets) socket.destroy()
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

export async function startForwardProxy(): Promise<{
  url: string
  requests: string[]
  tunnels: string[]
  close: () => Promise<void>
}> {
  const requests: string[] = []
  const tunnels: string[] = []
  const upstreamSockets = new Set<Socket>()
  const server = createHttpServer((incoming, outgoing) => {
    requests.push(incoming.url ?? '')
    let target: URL
    try {
      target = new URL(incoming.url!)
    } catch {
      outgoing.writeHead(400).end()
      return
    }
    // Fixtures may forward only to the local origin, never the public network.
    if (target.hostname !== '127.0.0.1') {
      outgoing.writeHead(403).end()
      return
    }
    const upstream = request(target, {
      method: incoming.method,
      headers: incoming.headers
    }, (response) => {
      outgoing.writeHead(response.statusCode!, response.headers)
      response.pipe(outgoing)
    })
    upstream.on('error', () => outgoing.destroy())
    incoming.on('error', () => upstream.destroy())
    outgoing.on('close', () => upstream.destroy())
    incoming.pipe(upstream)
  })
  server.on('connect', (incoming, client, head) => {
    const target = new URL(`http://${incoming.url}`)
    tunnels.push(incoming.url!)
    if (target.hostname !== '127.0.0.1') {
      client.destroy()
      return
    }
    const upstream = connect(Number(target.port), target.hostname)
    upstreamSockets.add(upstream)
    upstream.on('close', () => upstreamSockets.delete(upstream))
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
    client.on('close', () => upstream.destroy())
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      client.pipe(upstream)
      upstream.pipe(client)
    })
  })
  const endpoint = await listen(server)
  return {
    url: `http://127.0.0.1:${endpoint.port}`,
    requests,
    tunnels,
    close: async () => {
      for (const socket of upstreamSockets) socket.destroy()
      await endpoint.close()
    }
  }
}

/** Minimal local FTP server with real control/data sockets and observable commands. */
export async function startFtpServer(options: {
  pac: string
  listing?: string
  separateDataHost?: boolean
}): Promise<{
  url: string
  commands: string[]
  dataConnections: () => number
  close: () => Promise<void>
}> {
  const commands: string[] = []
  const dataServers: Awaited<ReturnType<typeof listen>>[] = []
  let dataConnections = 0
  const server = createTcpServer((control) => {
    control.setEncoding('utf8')
    control.write('220 Local PAC fixture\r\n')
    let buffer = ''
    let queue = Promise.resolve()
    let dataSocket: ReturnType<typeof deferred<Socket>> | undefined
    const reply = (message: string): void => { control.write(`${message}\r\n`) }
    async function handle(line: string): Promise<void> {
      commands.push(line)
      const command = line.split(' ', 1)[0]
      switch (command) {
        case 'USER': reply('331 Password required'); break
        case 'PASS': reply('230 Logged in'); break
        case 'FEAT': reply('211 End'); break
        case 'TYPE':
        case 'STRU':
        case 'OPTS': reply('200 OK'); break
        case 'MDTM': reply(options.listing === undefined ? '213 20260101000000' : '502 MDTM unsupported'); break
        case 'EPSV': reply('502 EPSV unsupported'); break
        case 'PASV': {
          dataSocket = deferred<Socket>()
          const waiting = dataSocket
          const dataServer = await listen(createTcpServer((socket) => {
            dataConnections++
            waiting.resolve(socket)
          }))
          dataServers.push(dataServer)
          // TEST-NET-1 must be rejected before any data connection is attempted.
          const host = options.separateDataHost ? '192,0,2,1' : '127,0,0,1'
          reply(`227 Entering Passive Mode (${host},${dataServer.port >> 8},${dataServer.port & 255})`)
          break
        }
        case 'LIST':
        case 'RETR': {
          if (!dataSocket) throw new Error('Transfer without PASV')
          const socket = await dataSocket.promise
          reply('150 Opening data connection')
          socket.end(command === 'LIST' ? options.listing ?? '' : options.pac, () => {
            reply('226 Transfer complete')
          })
          dataSocket = undefined
          break
        }
        case 'QUIT': control.end('221 Goodbye\r\n'); break
        default: reply(`502 Unsupported ${command}`)
      }
    }
    control.on('data', (chunk: string) => {
      buffer += chunk
      let end: number
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        queue = queue.then(() => handle(line)).catch(() => { control.destroy() })
      }
    })
  })
  const endpoint = await listen(server)
  return {
    url: `pac+ftp://127.0.0.1:${endpoint.port}/proxy.pac`,
    commands,
    dataConnections: () => dataConnections,
    close: async () => {
      await endpoint.close()
      await Promise.all(dataServers.map((dataServer) => dataServer.close()))
    }
  }
}
