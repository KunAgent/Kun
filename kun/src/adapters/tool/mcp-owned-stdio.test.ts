import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OwnedStdioClientTransport } from './mcp-owned-stdio.js'
import { resumeOwnedProcessAdmission, shutdownOwnedProcesses } from '../../process/owned-process.js'

const directories: string[] = []
afterEach(async () => {
  await shutdownOwnedProcesses({ graceMs: 50, timeoutMs: 4000 })
  resumeOwnedProcessAdmission()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('owned MCP stdio', () => {
  it.skipIf(process.platform !== 'win32')('starts an offline MCP server from a bare npm-style npx command shim', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-mcp-npx-shim-'))
    directories.push(directory)
    // npm cmd-shim's three siblings: the extensionless file is POSIX source,
    // not a PE executable; only the .cmd sibling is valid for this launcher.
    await writeFile(join(directory, 'npx'), '#!/bin/sh\nexec node "$basedir/mcp.cjs" "$@"\n')
    await writeFile(join(directory, 'npx.ps1'), '#!/usr/bin/env pwsh\n& node "$basedir/mcp.cjs" $args\n')
    await writeFile(join(directory, 'npx.cmd'), `@ECHO off\r\n"${process.execPath}" "%~dp0mcp.cjs" %*\r\n`)
    await writeFile(join(directory, 'mcp.cjs'), `
      require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
        const message = JSON.parse(line);
        if (message.id === undefined) return;
        const result = message.method === 'initialize'
          ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'offline-shim', version: '1' } }
          : { tools: [{ name: 'local_echo', inputSchema: { type: 'object' } }] };
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
      });
    `)
    const transport = new OwnedStdioClientTransport({ command: 'npx', cwd: directory,
      env: { PATH: directory, Path: directory, PATHEXT: '.COM;.EXE;.BAT;.CMD', ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe' })
    const messages: unknown[] = []
    transport.onmessage = message => { messages.push(message) }
    try {
      await transport.start()
      await transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' }
      } })
      await vi.waitFor(() => expect(messages).toHaveLength(1))
      expect(messages[0]).toMatchObject({ id: 1, result: { serverInfo: { name: 'offline-shim' } } })
      await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      await transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
      await vi.waitFor(() => expect(messages).toHaveLength(2))
      expect(messages[1]).toMatchObject({ id: 2, result: { tools: [{ name: 'local_echo' }] } })
    } finally { await transport.close() }
  }, 20_000)


  it('roundtrips newline JSON-RPC without breaking chunked UTF-8 and awaits process shutdown', async () => {
    const transport = new OwnedStdioClientTransport({ command: process.execPath, args: ['-e', `
      process.stdin.setEncoding('utf8');
      process.stdin.on('data',line=>{
        const message=JSON.parse(line);
        const output=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{text:'你好'}})+'\\n');
        for(let i=0;i<output.length;i++)process.stdout.write(output.subarray(i,i+1));
      });
    `], stderr: 'pipe' })
    const received = new Promise<unknown>((resolve) => { transport.onmessage = resolve })
    await transport.start()
    const pid = transport.pid!
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' })
    await expect(received).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: { text: '你好' } })
    await transport.close()
    expect(() => process.kill(pid, 0)).toThrow()
  })

  it.skipIf(process.platform === 'win32')('closes a TERM-resistant server and its helper process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-mcp-owned-'))
    directories.push(directory)
    const pidPath = join(directory, 'helper.pid')
    const transport = new OwnedStdioClientTransport({ command: process.execPath, args: ['-e', `
      const child=require('node:child_process').spawn(process.execPath,['-e',
        'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
      require('node:fs').writeFileSync(process.argv[1],String(child.pid));
      process.on('SIGTERM',()=>{});
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'ready'})+'\\n');
      setInterval(()=>{},1000);
    `, pidPath], stderr: 'pipe' })
    const ready = new Promise<void>((resolve) => { transport.onmessage = () => resolve() })
    await transport.start()
    await ready
    const helper = Number(await readFile(pidPath, 'utf8'))
    const server = transport.pid!
    await transport.close()
    expect(() => process.kill(server, 0)).toThrow()
    expect(() => process.kill(helper, 0)).toThrow()
  })

  it('closes a transport while its guarded launch is still pending', async () => {
    const transport = new OwnedStdioClientTransport({ command: process.execPath,
      args: ['-e', 'setInterval(()=>{},1000)'], stderr: 'pipe' })
    const starting = transport.start()
    const closing = transport.close()
    await starting
    await closing
    expect(() => process.kill(transport.pid!, 0)).toThrow()
  })
})
