import { afterEach, describe, expect, it } from 'vitest'
import { spawnOwnedSdkProcess } from './owned-sdk-process.js'
import { resumeOwnedProcessAdmission, shutdownOwnedProcesses } from '../../process/owned-process.js'

afterEach(async () => {
  await shutdownOwnedProcesses({ graceMs: 50, timeoutMs: 4000 })
  resumeOwnedProcessAdmission()
})

describe('owned SDK process facade', () => {
  it('buffers SDK input until guarded launch and emits exit after the process terminates', async () => {
    const child = spawnOwnedSdkProcess({ command: process.execPath, args: ['-e',
      'process.stdin.on("data",data=>{process.stdout.write(data);process.exitCode=0});process.stdin.on("end",()=>{})'],
    env: process.env, signal: new AbortController().signal })
    let output = ''
    child.stdout.on('data', (data: Buffer) => { output += data.toString('utf8') })
    const exited = new Promise<number | null>((resolve, reject) => {
      child.on('exit', resolve)
      child.on('error', reject)
    })
    child.stdin.end('queued input\n')
    await expect(exited).resolves.toBe(0)
    expect(output).toBe('queued input\n')
  })

  it('reports cancellation before launch after the SDK can register its listeners', async () => {
    const controller = new AbortController()
    controller.abort()
    const child = spawnOwnedSdkProcess({ command: process.execPath, args: ['-e', 'process.exit(0)'],
      env: process.env, signal: controller.signal })
    const exited = new Promise<NodeJS.Signals | null>((resolve) => child.on('exit', (_code, signal) => resolve(signal)))
    await expect(exited).resolves.toBe('SIGTERM')
  })
})
